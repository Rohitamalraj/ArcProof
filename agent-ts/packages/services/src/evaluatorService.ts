/**
 * Evaluator service (PRD S9): thin Fastify wrapper around @arcproof/core's
 * deterministic evaluator.ts. Ported from agent/agents/evaluator.py --
 * except unlike that file, there is no LLM call and no agent loop here at
 * all. The Python version upgraded the evaluator into an LLM agent that
 * "judged" claims; this project deliberately reverts that so verdicts stay
 * rule-based and independently reproducible (see core/src/evaluator.ts's
 * docstring for the full reasoning).
 *
 * Kept as its own real HTTP service (rather than an in-process import from
 * the orchestrator) to match the PRD's 5-independent-services architecture
 * -- the orchestrator calls this over HTTP just like it calls the 3
 * specialists.
 *
 * Run standalone with:
 *   npm run evaluator --workspace=@arcproof/services
 */
import Fastify from "fastify";
import { z } from "zod";

import { ClaimSchema, config, evaluator } from "@arcproof/core";

const app = Fastify({ logger: false });

const EvaluateRequestSchema = z.object({
  job_id: z.string(),
  protocol_slug: z.string(),
  target_address: z.string().nullable().optional(),
  claims: z.array(ClaimSchema),
});

app.post("/evaluate", async (request) => {
  const { job_id, protocol_slug, target_address, claims } = EvaluateRequestSchema.parse(request.body);
  console.log(`[evaluator] job ${job_id}: independently verifying ${claims.length} claims`);

  if (!claims.length) {
    return { claims: [] };
  }

  const evaluated = await evaluator.evaluateClaims(claims, { protocolSlug: protocol_slug, targetAddress: target_address });
  return { claims: evaluated };
});

export { app };

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen({ port: config.EVALUATOR_PORT, host: "127.0.0.1" }).then(() => {
    console.log(`[evaluator] listening on http://127.0.0.1:${config.EVALUATOR_PORT}`);
  });
}
