/**
 * Shared LLM tool-calling loop used by all 3 specialists -- factors out the
 * `createReactAgent` + structured-claims-parsing boilerplate that would
 * otherwise be near-identical across onchainAgent.ts/newsAgent.ts/
 * complianceAgent.ts (mirroring how they share tools.ts/agentSchemas.ts/
 * llm.ts in the Python version too).
 */
import { randomUUID } from "node:crypto";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { StructuredToolInterface } from "@langchain/core/tools";

import type { Claim, ClaimType } from "@arcproof/core";
import { getModel } from "../llm.js";
import { SpecialistClaimsSchema, type ClaimDraft } from "../agentSchemas.js";

export async function runSpecialistAnalysis(
  agentId: string,
  tools: StructuredToolInterface[],
  systemPrompt: string,
  userMsg: string,
  jobId: string,
  // Which claim types this specialist's own tools can actually produce --
  // enforced here in plain code, not via the LLM's own output schema (see
  // agentSchemas.ts's comment on ClaimDraftSchema for why: narrowing the
  // LLM-facing enum traded one Groq tool-calling failure for a different
  // one). A claim with any other claim_type means the LLM hallucinated
  // something its tools never produced (observed live: news-agent-v1
  // inventing a "tvl" claim when asked about governance) -- dropped here,
  // the same "never trust a specialist's own claim on its face" principle
  // the evaluator already applies to claim *values*, applied to claim
  // *type* too.
  allowedClaimTypes: readonly [ClaimType, ...ClaimType[]]
): Promise<Claim[]> {
  // Two distinct transient failure modes observed live, neither a real
  // reasoning failure, both worth one retry before giving up on this call:
  //   1. Groq's tool-calling occasionally rejects a perfectly correct
  //      response with a "tool_use_failed" error -- throws, caught below.
  //   2. Gemini's ReAct loop occasionally finishes without calling any of
  //      its tools at all and returns a clean {claims: []} -- doesn't
  //      throw, so it needs its own check: an empty result is treated as
  //      retry-worthy too, since a specialist asked about a real protocol
  //      almost always has *something* to report.
  const MAX_ATTEMPTS = 2;
  let drafts: ClaimDraft[] = [];
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const agent = createReactAgent({
        llm: getModel(agentId),
        tools,
        responseFormat: SpecialistClaimsSchema,
        prompt: systemPrompt,
      });

      const result = await agent.invoke({ messages: [{ role: "user", content: userMsg }] });
      drafts = (result.structuredResponse as { claims: ClaimDraft[] }).claims;
      lastError = null;
      if (drafts.length > 0 || attempt === MAX_ATTEMPTS) break;
      console.log(`[${agentId}]   ! attempt ${attempt}/${MAX_ATTEMPTS} produced 0 claims with no error -- retrying once`);
    } catch (e) {
      lastError = e;
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[${agentId}]   ! attempt ${attempt}/${MAX_ATTEMPTS} failed (${e}) -- retrying once`);
      }
    }
  }
  if (lastError) {
    console.log(`[${agentId}]   ! LLM agent unavailable after ${MAX_ATTEMPTS} attempts (${lastError}) -- no claims produced this call`);
    drafts = [];
  }

  const allowedSet = new Set<string>(allowedClaimTypes);
  const filtered = drafts.filter((d) => {
    if (allowedSet.has(d.claim_type)) return true;
    console.log(`[${agentId}]   ! dropping out-of-scope claim_type '${d.claim_type}' (not one of: ${allowedClaimTypes.join(", ")})`);
    return false;
  });

  const claims: Claim[] = filtered.map((d) => {
    // d.simulated is the model's literal "true"/"false" string (see
    // agentSchemas.ts) -- coerce back to a real boolean here since the
    // wire-format Claim.simulated is a genuine z.boolean(). Anything other
    // than the exact string "true" defaults to false (matching the
    // schema's own default and the "simulated only if explicitly true"
    // instruction given to the model).
    const simulated = d.simulated.toLowerCase() === "true";
    console.log(`[${agentId}]   ${d.claim_type} claim: ${d.claim_text} (simulated=${simulated})`);
    return {
      claim_id: randomUUID(),
      job_id: jobId,
      provider_agent_id: agentId,
      claim_type: d.claim_type,
      claim_text: d.claim_text,
      claim_value: d.claim_value,
      provider_source: d.provider_source,
      simulated,
      verification_status: "pending",
    };
  });
  return claims;
}
