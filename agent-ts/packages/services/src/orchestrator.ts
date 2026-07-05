/**
 * Orchestrator service (PRD S6.2): decomposes a job, pays specialists via
 * x402, hands the assembled claims to the (deterministic) evaluator, then
 * triggers settlement. Owns the JobRecord end to end since it's the only
 * role that needs to persist job state across the whole lifecycle. Ported
 * from agent/agents/orchestrator.py.
 *
 * Run standalone with:
 *   npm run orchestrator --workspace=@arcproof/services
 * This is also the one HTTP surface a frontend integrates against: POST
 * /jobs to submit work, GET /jobs/:id to poll status, GET /jobs/:id/logs
 * for live activity while a job is still processing, GET /reputation for
 * the dashboard feed.
 */
import Fastify from "fastify";
import { randomUUID } from "node:crypto";

import {
  JobRequestSchema,
  type JobRecord,
  type Claim,
  config,
  x402,
  wallet,
  chain,
  escrowContract,
  settlement,
  store,
} from "@arcproof/core";
import { planSpecialists, writeMemo } from "./langchainPlanner.js";
import { registerSecurity, checkApiKey } from "./security.js";
import { startJobLog, logEvent, getJobLog } from "./jobLog.js";

const app = Fastify({ logger: false });
await registerSecurity(app, { cors: true });

const SPECIALIST_URLS: Record<string, string> = {
  "onchain-agent-v1": config.ONCHAIN_AGENT_URL,
  "news-agent-v1": config.NEWS_AGENT_URL,
  "compliance-agent-v1": config.COMPLIANCE_AGENT_URL,
};

const ORCHESTRATOR_PRIVATE_KEY = config.WALLETS.orchestrator.privateKey;

function explorerTxUrl(txHash: string): string {
  return `${config.ARC_EXPLORER_URL}/tx/${txHash}`;
}

interface SpecialistCallResult {
  claims: Claim[];
  nanopaymentTxHash: string | null;
}

async function callSpecialist(
  name: string,
  jobReq: { protocol_slug: string; target_address?: string | null; inject_fault?: string | null },
  jobId: string
): Promise<SpecialistCallResult> {
  const url = SPECIALIST_URLS[name];
  console.log(`[orchestrator] -> calling ${name} (${url}/analyze)`);
  const { response, txHash } = await x402.x402Post(`${url}/analyze`, ORCHESTRATOR_PRIVATE_KEY, {
    job_id: jobId,
    protocol_slug: jobReq.protocol_slug,
    target_address: jobReq.target_address,
    inject_fault: jobReq.inject_fault,
  });
  if (!response.ok) throw new Error(`specialist ${name} returned ${response.status}: ${await response.text()}`);
  if (txHash) {
    logEvent(
      jobId,
      "info",
      `Paid ${name} a nanopayment for responding (${config.NANOPAYMENT_USDC} USDC)`,
      { txHash, explorerUrl: explorerTxUrl(txHash) },
      { from: "orchestrator", to: name, kind: "payment" }
    );
  }
  const body = (await response.json()) as { claims: Claim[] };
  return { claims: body.claims, nanopaymentTxHash: txHash };
}

app.post("/jobs", async (request, reply) => {
  if (!checkApiKey(request, reply)) return;
  const jobReq = JobRequestSchema.parse(request.body);
  // A connected browser wallet that already called VeriFiEscrow.lock()
  // itself supplies the same job_id it locked under; otherwise generate a
  // fresh one and lock it ourselves (the CLI / no-wallet-connected path).
  const jobId = jobReq.job_id || `job_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  startJobLog(jobId);
  console.log(`\n=== NEW JOB ${jobId} -- ${jobReq.protocol_slug} ===`);
  console.log(`[orchestrator] received request: "${jobReq.request_text}" | budget=${jobReq.budget_usdc} USDC | template=${jobReq.template}`);
  logEvent(jobId, "info", `Job received: "${jobReq.request_text}"`, undefined, { from: "requester", to: "orchestrator", kind: "system" });

  const job: JobRecord = {
    job_id: jobId,
    requester_id: jobReq.requester_wallet,
    template: jobReq.template || "unclassified", // replaced with the LLM's inferred label below once planSpecialists() runs
    request_text: jobReq.request_text,
    protocol_slug: jobReq.protocol_slug,
    budget_usdc: jobReq.budget_usdc,
    status: "in_progress",
    created_at: new Date().toISOString(),
    subtasks: [],
    total_paid_usdc: 0,
    claims: [],
    payouts: [],
  };

  if (jobReq.payment_tx_hash) {
    // Requester already locked for real via their own connected wallet --
    // don't trust the claim, independently re-derive it from the contract
    // itself (getJob is a plain view call, same "verify, don't trust"
    // principle x402 already applies to specialist nanopayments).
    let onChain;
    try {
      onChain = await escrowContract.getJob(jobId);
    } catch (e) {
      job.status = "failed";
      await store.jobStore.save(job);
      logEvent(jobId, "error", `Could not read escrow contract state: ${e}`);
      return reply.code(402).send({ detail: `could not read escrow contract state for job ${jobId}: ${e}` });
    }
    const requesterMatches = onChain.requester.toLowerCase() === jobReq.requester_wallet.toLowerCase();
    const lockedEnough = onChain.lockedUsdc + 1e-9 >= jobReq.budget_usdc;
    if (onChain.status !== "locked" || !requesterMatches || !lockedEnough) {
      job.status = "failed";
      await store.jobStore.save(job);
      logEvent(jobId, "error", `Budget lock could not be independently verified on-chain`);
      return reply.code(402).send({
        detail: `job ${jobId} is not verifiably locked on-chain for ${jobReq.budget_usdc} USDC from ${jobReq.requester_wallet} (contract says: status=${onChain.status}, requester=${onChain.requester}, locked=${onChain.lockedUsdc})`,
      });
    }
    job.lock_tx_hash = jobReq.payment_tx_hash;
    console.log(`[orchestrator] budget verified on-chain: ${jobReq.requester_wallet.slice(0, 10)}.. locked ${onChain.lockedUsdc.toFixed(6)} USDC (tx ${jobReq.payment_tx_hash})`);
    logEvent(
      jobId,
      "success",
      `Budget lock independently verified on-chain (${onChain.lockedUsdc.toFixed(4)} USDC)`,
      { txHash: jobReq.payment_tx_hash, explorerUrl: explorerTxUrl(jobReq.payment_tx_hash) },
      { from: "requester", to: "escrow", kind: "payment" }
    );
  } else {
    try {
      const lockTx = await escrowContract.lock(jobId, jobReq.requester_wallet as config.Role, jobReq.budget_usdc);
      job.lock_tx_hash = lockTx.txHash;
      logEvent(
        jobId,
        "success",
        `Locked ${jobReq.budget_usdc} USDC in escrow`,
        { txHash: lockTx.txHash, explorerUrl: lockTx.explorerUrl },
        { from: "requester", to: "escrow", kind: "payment" }
      );
    } catch (e) {
      job.status = "failed";
      await store.jobStore.save(job);
      logEvent(jobId, "error", `Could not lock budget in escrow contract: ${e}`);
      return reply.code(402).send({ detail: `could not lock budget in escrow contract: ${e}` });
    }
  }

  try {
    logEvent(jobId, "info", `Orchestrator's LLM planner is choosing which specialists to engage...`);
    const plan = await planSpecialists(jobReq);
    job.subtasks = plan.specialist_ids;
    if (!jobReq.template) job.template = plan.template_label;
    logEvent(jobId, "info", `Plan: ${plan.specialist_ids.join(", ")} -- ${plan.reasoning}`);

    const allClaims: Claim[] = [];
    const nanopaymentTxByProvider: Record<string, string> = {};
    for (const name of plan.specialist_ids) {
      logEvent(jobId, "info", `Calling ${name}...`, undefined, { from: "orchestrator", to: name, kind: "call" });
      try {
        const { claims, nanopaymentTxHash } = await callSpecialist(name, jobReq, jobId);
        allClaims.push(...claims);
        if (nanopaymentTxHash) nanopaymentTxByProvider[name] = nanopaymentTxHash;
        logEvent(
          jobId,
          "success",
          `${name} responded with ${claims.length} claim${claims.length === 1 ? "" : "s"}`,
          undefined,
          { from: name, to: "orchestrator", kind: "response" }
        );
      } catch (e) {
        console.log(`[orchestrator]   ! ${name} failed: ${e}`);
        logEvent(jobId, "warn", `${name} failed to respond: ${e}`, undefined, { from: name, to: "orchestrator", kind: "response" });
      }
    }

    job.claims = allClaims;
    logEvent(jobId, "info", `Writing the diligence memo...`);
    job.final_memo = await writeMemo(jobReq, allClaims);

    console.log(`[orchestrator] assembled ${allClaims.length} claims from ${plan.specialist_ids.length} specialists -> handing off to evaluator`);
    logEvent(
      jobId,
      "info",
      `Assembled ${allClaims.length} claim${allClaims.length === 1 ? "" : "s"} -- handing off to the evaluator for independent verification`,
      undefined,
      { from: "orchestrator", to: "evaluator-v1", kind: "call" }
    );
    const evalResp = await fetch(`${config.EVALUATOR_URL}/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        protocol_slug: jobReq.protocol_slug,
        target_address: jobReq.target_address,
        claims: allClaims,
      }),
    });
    if (!evalResp.ok) throw new Error(`evaluator returned ${evalResp.status}: ${await evalResp.text()}`);
    const evalBody = (await evalResp.json()) as { claims: Claim[] };
    job.claims = evalBody.claims;

    for (const c of job.claims) {
      const level = c.verification_status === "match" ? "success" : c.verification_status === "mismatch" ? "error" : "warn";
      const icon = c.verification_status === "match" ? "MATCH" : c.verification_status === "mismatch" ? "MISMATCH" : "UNVERIFIABLE";
      logEvent(
        jobId,
        level,
        `[${c.claim_type}] ${icon} -- ${c.claim_text}${c.verification_note ? ` (${c.verification_note})` : ""}`,
        undefined,
        { from: "evaluator-v1", to: c.provider_agent_id, kind: "verdict" }
      );
    }

    if (!settlement.hasCheckableClaims(job.claims)) {
      // Every specialist failed, or every claim came back unverifiable --
      // computeJobVerdict would call this a clean "accept" (0 mismatches),
      // which finalize()s the contract with the full budget withheld
      // forever instead of refunded. Throw so the catch block below runs
      // the existing refund path instead of settling.
      throw new Error(`no checkable claims for job ${jobId} (every specialist failed or all claims were unverifiable) -- refunding rather than auto-accepting`);
    }

    logEvent(jobId, "info", `Settling per-specialist payouts on-chain...`);
    const settled = await settlement.settle(job, (event) => {
      const actors =
        event.type === "release"
          ? { from: "escrow", to: event.providerId, kind: "settlement" as const }
          : { from: "orchestrator", to: "escrow", kind: "system" as const };
      logEvent(jobId, "success", event.message, { txHash: event.txHash, explorerUrl: event.explorerUrl }, actors);
    });

    // Fold each specialist's earlier nanopayment tx hash into its final
    // payout record now that settle() has produced the payouts array.
    for (const payout of settled.payouts) {
      const tx = nanopaymentTxByProvider[payout.provider_agent_id];
      if (tx) payout.nanopayment_tx_hash = tx;
    }

    await store.jobStore.save(settled);

    console.log(`[orchestrator] job ${jobId} DONE -- verdict=${settled.overall_verdict?.toUpperCase()} paid=${settled.total_paid_usdc.toFixed(4)} USDC`);
    logEvent(jobId, "success", `Job complete -- verdict ${settled.overall_verdict?.toUpperCase()}, ${settled.total_paid_usdc.toFixed(4)} USDC paid`);
    return settled;
  } catch (e) {
    // Budget is already locked in the escrow contract at this point -- any
    // failure past that line must not leave real funds stranded with no
    // job record and no way back to the requester. refund() is a real
    // contract call, same trust model as any release.
    console.log(`[orchestrator] job ${jobId} failed after budget lock: ${e} -- refunding escrow contract -> requester`);
    logEvent(jobId, "warn", `Job failed after budget lock: ${e} -- refunding escrow contract`);
    job.status = "failed";
    try {
      const refundTx = await escrowContract.refund(jobId);
      job.refund_tx_hash = refundTx.txHash;
      logEvent(
        jobId,
        "success",
        `Refunded full locked budget back to the requester`,
        { txHash: refundTx.txHash, explorerUrl: refundTx.explorerUrl },
        { from: "escrow", to: "requester", kind: "payment" }
      );
    } catch (refundError) {
      console.log(`[orchestrator]   ! refund ALSO failed: ${refundError} -- funds remain locked in contract, job marked failed`);
      logEvent(jobId, "error", `Refund ALSO failed: ${refundError} -- funds remain locked in the contract`);
    }
    await store.jobStore.save(job);
    return reply.code(500).send({ detail: `job failed after budget was locked; escrow contract refunded to requester where possible: ${e}` });
  }
});

app.get("/jobs/:jobId", async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const job = store.jobStore.get(jobId);
  if (!job) return reply.code(404).send({ detail: "job not found" });
  return job;
});

app.get("/jobs/:jobId/logs", async (request) => {
  const { jobId } = request.params as { jobId: string };
  return { logs: getJobLog(jobId) };
});

app.get("/jobs", async () => store.jobStore.listAll());

app.get("/reputation", async () => store.reputationStore.listAll());

app.get("/wallets", async () => {
  const plain = await wallet.ledger.allBalances();
  const balances: Record<string, number> = {};
  for (const [role, bal] of Object.entries(plain)) {
    const circleEntry = config.CIRCLE_WALLETS[role as config.Role];
    if (circleEntry) {
      // This role signs its contract calls through the Circle wallet now
      // (see escrowContract.ts) -- that's the balance that actually moves.
      balances[`${role}-circle`] = await chain.getBalanceUsdc(circleEntry.address);
    } else {
      balances[role] = bal;
    }
  }
  try {
    balances["escrow-contract"] = await chain.getBalanceUsdc(escrowContract.contractAddress());
  } catch {
    /* contract not deployed yet -- omit rather than fail the whole endpoint */
  }
  return balances;
});

app.get("/config", async () => ({
  arc_chain_id: config.ARC_CHAIN_ID,
  arc_rpc_url: config.ARC_RPC_URL,
  arc_explorer_url: config.ARC_EXPLORER_URL,
  escrow_contract_address: escrowContract.contractAddress(),
  nanopayment_usdc: config.NANOPAYMENT_USDC,
}));

export { app };

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen({ port: config.ORCHESTRATOR_PORT, host: "127.0.0.1" }).then(() => {
    console.log(`[orchestrator] listening on http://127.0.0.1:${config.ORCHESTRATOR_PORT}`);
  });
}
