/**
 * Verdict + per-provider payout math, then real on-chain settlement.
 * Ported from agent-ts's core/src/settlement.ts, generalized: that
 * version bakes in one DeFi-specific rule ("a compliance_flag mismatch is
 * a floor on the verdict") which doesn't make sense as a library default
 * -- a lending-APR agent has no compliance_flag claim type at all. Verdict
 * math here is purely a function of match/mismatch counts; if your domain
 * needs a floor rule like that, apply it to the result of
 * computeJobVerdict() yourself (see README for the pattern).
 *
 * Deliberately still 100% deterministic, zero LLM calls -- this is what
 * keeps a verdict auditable and reproducible by anyone re-running the
 * same independent checks, same principle as agent-ts's evaluator.ts.
 */
import type { Claim, ProviderPayout, Verdict, SettlementResult } from "./schema.js";
import * as escrow from "./escrow.js";
import type { NetworkConfig } from "./chain.js";
import type { WalletCredential } from "./escrow.js";

function checkable(claims: Claim[]): Claim[] {
  return claims.filter((c) => c.verification_status === "match" || c.verification_status === "mismatch");
}

/**
 * True if at least one claim can actually be judged match/mismatch. A job
 * with zero checkable claims must NOT be routed through settle() --
 * computeJobVerdict treats "no mismatches" as "accept" regardless of
 * *why* there were none, which would finalize the escrow with the
 * requester's full budget silently withheld forever if you called
 * settle() anyway. Refund instead when this returns false.
 */
export function hasCheckableClaims(claims: Claim[]): boolean {
  return checkable(claims).length > 0;
}

export function computeJobVerdict(claims: Claim[], partialMismatchThreshold = 1): Verdict {
  const checkableClaims = checkable(claims);
  const mismatches = checkableClaims.filter((c) => c.verification_status === "mismatch");

  if (!checkableClaims.length || !mismatches.length) return "accept";
  if (mismatches.length > checkableClaims.length / 2) return "reject";
  if (mismatches.length <= partialMismatchThreshold) return "partial";
  return "reject";
}

export function computeProviderPayout(providerAgentId: string, providerClaims: Claim[], allocatedAmount: number, partialMismatchThreshold = 1): ProviderPayout {
  const checkableClaims = checkable(providerClaims);
  const matches = checkableClaims.filter((c) => c.verification_status === "match").length;
  const mismatches = checkableClaims.filter((c) => c.verification_status === "mismatch").length;
  const unverifiable = providerClaims.filter((c) => c.verification_status === "unverifiable").length;

  let fraction: number;
  let outcome: "full" | "partial" | "withheld";
  if (mismatches === 0) {
    fraction = 1.0;
    outcome = "full";
  } else if (mismatches <= partialMismatchThreshold) {
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
    allocated_usdc: Math.round(allocatedAmount * 1e6) / 1e6,
    paid_usdc: Math.round(allocatedAmount * fraction * 1e6) / 1e6,
    fraction_paid: fraction,
    outcome,
  };
}

/**
 * Computes the verdict/payout math AND executes it as real on-chain
 * transactions: release() per provider that earned something, then
 * finalize() to close the job (any withheld remainder simply stays
 * locked in the contract, enforced by the contract itself).
 */
export async function settle(
  network: NetworkConfig,
  contractAddress: string,
  jobId: string,
  settler: WalletCredential,
  budgetAmount: number,
  claims: Claim[],
  providerAddresses: Record<string, string>
): Promise<SettlementResult> {
  console.log(`[settlement] job ${jobId}: computing verdict over ${claims.length} claims`);
  const overallVerdict = computeJobVerdict(claims);

  const byProvider = new Map<string, Claim[]>();
  for (const c of claims) {
    const list = byProvider.get(c.provider_agent_id) ?? [];
    list.push(c);
    byProvider.set(c.provider_agent_id, list);
  }

  const nProviders = byProvider.size || 1;
  const share = budgetAmount / nProviders;

  const payouts: ProviderPayout[] = [];
  let totalPaid = 0;
  for (const [providerId, providerClaims] of byProvider) {
    const payout = computeProviderPayout(providerId, providerClaims, share);
    payouts.push(payout);

    if (payout.paid_usdc > 0) {
      const providerAddress = providerAddresses[providerId];
      if (!providerAddress) throw new Error(`no address given for provider '${providerId}' in providerAddresses`);
      await escrow.release(network, contractAddress, jobId, settler, providerAddress, payout.paid_usdc, payout.outcome);
      totalPaid += payout.paid_usdc;
    }
    console.log(
      `[settlement] ${providerId}: ${payout.matches} match / ${payout.mismatches} mismatch / ${payout.unverifiable} unverifiable ` +
        `-> ${payout.outcome} (${payout.paid_usdc.toFixed(4)}/${payout.allocated_usdc.toFixed(4)})`
    );
  }

  await escrow.finalize(network, contractAddress, jobId, settler);

  const totalPaidRounded = Math.round(totalPaid * 1e6) / 1e6;
  console.log(`[settlement] job ${jobId}: overall verdict = ${overallVerdict.toUpperCase()}, total paid = ${totalPaidRounded.toFixed(4)}`);

  return { overall_verdict: overallVerdict, total_paid_usdc: totalPaidRounded, payouts, claims };
}
