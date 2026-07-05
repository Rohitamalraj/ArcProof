/**
 * Conditional settlement (PRD S9.4/S9.5), ported unchanged from
 * agent/settlement/escrow.py -- this file was already rule-based in the
 * Python version (it only ever consumed claim.verification_status) and
 * stays that way here. What changed is *what sets* verification_status:
 * evaluator.ts is now deterministic code, not an LLM judgment call, which
 * means the whole chain from claim to payout is independently
 * re-derivable and auditable end to end.
 *
 * Verdict thresholds (documented here per the PRD's auditability NFR):
 *   - Per-provider payout: full if 0 mismatches, 50% if exactly 1 mismatch,
 *     withheld (0%) if 2+ mismatches. Same N=1 threshold the PRD suggests
 *     at job level, reapplied per-provider so each specialist is judged on
 *     its own claims (PRD S9.5).
 *   - Job-level verdict: reject if a majority of checkable claims mismatch;
 *     partial if 1..N(=1) mismatch; accept if 0 mismatches. A
 *     compliance_flag mismatch is a floor, not a ceiling -- it prevents a
 *     clean "accept" but doesn't by itself force "reject".
 *   - Unverifiable claims never count toward mismatches or payment.
 *
 * Payouts release through the deployed VeriFiEscrow contract
 * (escrowContract.ts) -- every payout is a real release() contract call
 * mined on Arc testnet, and the job is finalize()d at the end so any
 * withheld remainder is enforced by the contract itself (it simply never
 * leaves the contract), not by application bookkeeping alone.
 * computeJobVerdict/computeProviderPayout never touch payments directly,
 * which is what keeps the verdict math auditable independent of how
 * settlement executes.
 */
import type { Claim, JobRecord, ProviderPayout, Verdict } from "./schema.js";
import * as escrowContract from "./escrowContract.js";
import { reputationStore } from "./store.js";
import type { Role } from "./config.js";

const NUMERIC_CLAIM_TYPES = new Set(["tvl", "price_change", "token_concentration"]);
const PARTIAL_MISMATCH_THRESHOLD = 1; // N in PRD S9.4
void NUMERIC_CLAIM_TYPES; // documented for parity with the Python source; evaluator.ts is what actually branches on this

function checkable(claims: Claim[]): Claim[] {
  return claims.filter((c) => c.verification_status === "match" || c.verification_status === "mismatch");
}

/**
 * True if at least one claim can actually be judged match/mismatch. A job
 * with zero checkable claims (every specialist failed, or every claim came
 * back unverifiable) must NOT be routed through settle() -- computeJobVerdict
 * treats "no mismatches" as "accept" regardless of *why* there were none,
 * which would finalize() the escrow contract with the requester's full
 * budget silently withheld forever (marked "accepted" with nothing to show
 * for it, and no automatic refund since the job never technically failed).
 * Callers should refund instead of settling when this returns false -- see
 * orchestrator.ts's create-job handler.
 */
export function hasCheckableClaims(claims: Claim[]): boolean {
  return checkable(claims).length > 0;
}

export function computeJobVerdict(claims: Claim[]): Verdict {
  const checkableClaims = checkable(claims);
  const mismatches = checkableClaims.filter((c) => c.verification_status === "mismatch");

  let verdict: Verdict;
  if (!checkableClaims.length || !mismatches.length) {
    verdict = "accept";
  } else if (mismatches.length > checkableClaims.length / 2) {
    verdict = "reject";
  } else if (mismatches.length <= PARTIAL_MISMATCH_THRESHOLD) {
    verdict = "partial";
  } else {
    verdict = "reject";
  }

  const complianceMismatch = claims.some((c) => c.claim_type === "compliance_flag" && c.verification_status === "mismatch");
  if (complianceMismatch && verdict === "accept") {
    verdict = "partial"; // floor: a compliance miss can never look like a clean pass
  }
  return verdict;
}

export function computeProviderPayout(providerAgentId: string, providerClaims: Claim[], allocatedUsdc: number): ProviderPayout {
  const checkableClaims = checkable(providerClaims);
  const matches = checkableClaims.filter((c) => c.verification_status === "match").length;
  const mismatches = checkableClaims.filter((c) => c.verification_status === "mismatch").length;
  const unverifiable = providerClaims.filter((c) => c.verification_status === "unverifiable").length;

  let fraction: number;
  let outcome: "full" | "partial" | "withheld";
  if (mismatches === 0) {
    fraction = 1.0;
    outcome = "full";
  } else if (mismatches <= PARTIAL_MISMATCH_THRESHOLD) {
    fraction = 0.5;
    outcome = "partial";
  } else {
    fraction = 0.0;
    outcome = "withheld";
  }

  return {
    provider_agent_id: providerAgentId,
    claims_checked: checkableClaims.length,
    matches,
    mismatches,
    unverifiable,
    allocated_usdc: Math.round(allocatedUsdc * 1e6) / 1e6,
    paid_usdc: Math.round(allocatedUsdc * fraction * 1e6) / 1e6,
    fraction_paid: fraction,
    outcome,
  };
}

export interface SettlementEvent {
  type: "release" | "finalize";
  providerId?: string;
  message: string;
  txHash?: string;
  explorerUrl?: string;
}
export type SettlementEventHandler = (event: SettlementEvent) => void;

/**
 * onEvent is optional so settle() has no hard dependency on how (or
 * whether) a caller surfaces live progress -- the services layer's
 * orchestrator.ts passes a handler that forwards into its per-job log
 * store; the CLI demo runner and the SDK's runTrustedJob() just omit it.
 */
export async function settle(job: JobRecord, onEvent?: SettlementEventHandler): Promise<JobRecord> {
  console.log(`[settlement] job ${job.job_id}: computing verdict over ${job.claims.length} claims`);

  job.overall_verdict = computeJobVerdict(job.claims);

  const byProvider = new Map<string, Claim[]>();
  for (const c of job.claims) {
    const list = byProvider.get(c.provider_agent_id) ?? [];
    list.push(c);
    byProvider.set(c.provider_agent_id, list);
  }

  const nProviders = byProvider.size || 1;
  const share = job.budget_usdc / nProviders;

  const payouts: ProviderPayout[] = [];
  let totalPaid = 0;
  for (const [providerId, providerClaims] of byProvider) {
    const payout = computeProviderPayout(providerId, providerClaims, share);
    payouts.push(payout);

    if (payout.paid_usdc > 0) {
      const releaseTx = await escrowContract.release(job.job_id, providerId as Role, payout.paid_usdc, payout.outcome);
      payout.settlement_tx_hash = releaseTx.txHash;
      totalPaid += payout.paid_usdc;
      onEvent?.({
        type: "release",
        providerId,
        message: `Released ${payout.paid_usdc.toFixed(4)} USDC to ${providerId} (${payout.outcome})`,
        txHash: releaseTx.txHash,
        explorerUrl: releaseTx.explorerUrl,
      });
    }

    await reputationStore.recordJob(providerId, payout.matches, payout.mismatches, payout.unverifiable);
    console.log(
      `[settlement] ${providerId}: ${payout.matches} match / ${payout.mismatches} mismatch / ${payout.unverifiable} unverifiable ` +
        `-> ${payout.outcome} (${payout.paid_usdc.toFixed(4)}/${payout.allocated_usdc.toFixed(4)} USDC)`
    );
  }

  const finalizeTx = await escrowContract.finalize(job.job_id);
  job.finalize_tx_hash = finalizeTx.txHash;
  onEvent?.({ type: "finalize", message: `Job finalized on-chain -- any withheld balance stays in escrow`, txHash: finalizeTx.txHash, explorerUrl: finalizeTx.explorerUrl });

  job.payouts = payouts;
  job.total_paid_usdc = Math.round(totalPaid * 1e6) / 1e6;
  job.status = ({ accept: "accepted", partial: "partial_accepted", reject: "rejected" } as const)[job.overall_verdict];

  console.log(`[settlement] job ${job.job_id}: overall verdict = ${job.overall_verdict.toUpperCase()}, total paid = ${job.total_paid_usdc.toFixed(4)} USDC`);
  return job;
}
