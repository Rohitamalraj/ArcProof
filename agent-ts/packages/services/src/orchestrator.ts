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
 * /jobs to submit work, GET /jobs/:id to poll status, GET /reputation for
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

const app = Fastify({ logger: false });

const SPECIALIST_URLS: Record<string, string> = {
  "onchain-agent-v1": config.ONCHAIN_AGENT_URL,
  "news-agent-v1": config.NEWS_AGENT_URL,
  "compliance-agent-v1": config.COMPLIANCE_AGENT_URL,
};

const ORCHESTRATOR_PRIVATE_KEY = config.WALLETS.orchestrator.privateKey;

async function callSpecialist(name: string, jobReq: { protocol_slug: string; target_address?: string | null; inject_fault?: string | null }, jobId: string): Promise<Claim[]> {
  const url = SPECIALIST_URLS[name];
  console.log(`[orchestrator] -> calling ${name} (${url}/analyze)`);
  const resp = await x402.x402Post(`${url}/analyze`, ORCHESTRATOR_PRIVATE_KEY, {
    job_id: jobId,
    protocol_slug: jobReq.protocol_slug,
    target_address: jobReq.target_address,
    inject_fault: jobReq.inject_fault,
  });
  if (!resp.ok) throw new Error(`specialist ${name} returned ${resp.status}: ${await resp.text()}`);
  const body = (await resp.json()) as { claims: Claim[] };
  return body.claims;
}

app.post("/jobs", async (request, reply) => {
  const jobReq = JobRequestSchema.parse(request.body);
  const jobId = `job_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  console.log(`\n=== NEW JOB ${jobId} -- ${jobReq.protocol_slug} ===`);
  console.log(`[orchestrator] received request: "${jobReq.request_text}" | budget=${jobReq.budget_usdc} USDC | template=${jobReq.template}`);

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

  try {
    await escrowContract.lock(jobId, jobReq.requester_wallet as config.Role, jobReq.budget_usdc);
  } catch (e) {
    job.status = "failed";
    await store.jobStore.save(job);
    return reply.code(402).send({ detail: `could not lock budget in escrow contract: ${e}` });
  }

  try {
    const plan = await planSpecialists(jobReq);
    job.subtasks = plan.specialist_ids;
    if (!jobReq.template) job.template = plan.template_label;

    const allClaims: Claim[] = [];
    for (const name of plan.specialist_ids) {
      try {
        const claims = await callSpecialist(name, jobReq, jobId);
        allClaims.push(...claims);
      } catch (e) {
        console.log(`[orchestrator]   ! ${name} failed: ${e}`);
      }
    }

    job.claims = allClaims;
    job.final_memo = await writeMemo(jobReq, allClaims);

    console.log(`[orchestrator] assembled ${allClaims.length} claims from ${plan.specialist_ids.length} specialists -> handing off to evaluator`);
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

    const settled = await settlement.settle(job);
    await store.jobStore.save(settled);

    console.log(`[orchestrator] job ${jobId} DONE -- verdict=${settled.overall_verdict?.toUpperCase()} paid=${settled.total_paid_usdc.toFixed(4)} USDC`);
    return settled;
  } catch (e) {
    // Budget is already locked in the escrow contract at this point -- any
    // failure past that line must not leave real funds stranded with no
    // job record and no way back to the requester. refund() is a real
    // contract call, same trust model as any release.
    console.log(`[orchestrator] job ${jobId} failed after budget lock: ${e} -- refunding escrow contract -> requester`);
    job.status = "failed";
    try {
      await escrowContract.refund(jobId);
    } catch (refundError) {
      console.log(`[orchestrator]   ! refund ALSO failed: ${refundError} -- funds remain locked in contract, job marked failed`);
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

app.get("/jobs", async () => store.jobStore.listAll());

app.get("/reputation", async () => store.reputationStore.listAll());

app.get("/wallets", async () => {
  const balances = await wallet.ledger.allBalances();
  try {
    balances["escrow-contract"] = await chain.getBalanceUsdc(escrowContract.contractAddress());
  } catch {
    /* contract not deployed yet -- omit rather than fail the whole endpoint */
  }
  return balances;
});

export { app };

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen({ port: config.ORCHESTRATOR_PORT, host: "127.0.0.1" }).then(() => {
    console.log(`[orchestrator] listening on http://127.0.0.1:${config.ORCHESTRATOR_PORT}`);
  });
}
