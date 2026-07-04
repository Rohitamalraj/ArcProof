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

import type { Claim } from "@arcproof/core";
import { getModel } from "../llm.js";
import { SpecialistClaimsSchema, type ClaimDraft } from "../agentSchemas.js";

export async function runSpecialistAnalysis(
  agentId: string,
  tools: StructuredToolInterface[],
  systemPrompt: string,
  userMsg: string,
  jobId: string
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

  const claims: Claim[] = drafts.map((d) => {
    console.log(`[${agentId}]   ${d.claim_type} claim: ${d.claim_text} (simulated=${d.simulated})`);
    return {
      claim_id: randomUUID(),
      job_id: jobId,
      provider_agent_id: agentId,
      claim_type: d.claim_type,
      claim_text: d.claim_text,
      claim_value: d.claim_value,
      provider_source: d.provider_source,
      simulated: d.simulated,
      verification_status: "pending",
    };
  });
  return claims;
}
