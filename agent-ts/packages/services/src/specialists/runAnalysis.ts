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
  let drafts: ClaimDraft[] = [];
  try {
    const agent = createReactAgent({
      llm: getModel(agentId),
      tools,
      responseFormat: SpecialistClaimsSchema,
      prompt: systemPrompt,
    });

    const result = await agent.invoke({ messages: [{ role: "user", content: userMsg }] });
    drafts = (result.structuredResponse as { claims: ClaimDraft[] }).claims;
  } catch (e) {
    console.log(`[${agentId}]   ! LLM agent unavailable (${e}) -- no claims produced this call`);
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
