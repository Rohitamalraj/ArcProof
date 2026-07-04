/**
 * Real LangChain.js agent calls that decide which specialists a job
 * actually needs and write the requester-facing memo prose -- the
 * orchestrator still executes the real x402 payment + HTTP calls, but
 * which specialists get called is the model's call, not a hardcoded dict
 * lookup. Ported from agent/agents/langchain_planner.py.
 *
 * Requires GOOGLE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in .env
 * (see llm.ts). Deliberately no non-LLM fallback anywhere in this project:
 * if a call here fails, orchestrator.ts lets the failure propagate and
 * refunds the requester's locked escrow rather than quietly substituting a
 * fixed-template decision.
 */
import type { JobRequest, Claim } from "@arcproof/core";
import { getModel } from "./llm.js";
import { ALL_SPECIALISTS, SpecialistPlanSchema, type SpecialistPlan } from "./agentSchemas.js";

export async function planSpecialists(jobReq: JobRequest): Promise<SpecialistPlan> {
  const model = getModel("orchestrator");
  const structured = model.withStructuredOutput!(SpecialistPlanSchema, { name: "SpecialistPlan" });

  const systemPrompt =
    "You are the orchestrator for VeriFi Agents, a bonded financial diligence network. " +
    "Given a diligence request, decide which specialist agents to engage. Each specialist " +
    "costs the requester's budget, so only pick ones actually relevant to the request:\n\n" +
    Object.entries(ALL_SPECIALISTS)
      .map(([sid, desc]) => `- ${sid}: ${desc}`)
      .join("\n") +
    "\n\nAlso assign this specific request a short, fitting category label -- requesters " +
    "aren't restricted to a fixed template list, so invent a label that actually describes " +
    "what this request is asking for, don't force it into a generic bucket.";

  const templateHint = jobReq.template ? `\nRequester-supplied template hint: ${jobReq.template}` : "";
  const userMsg = `Request: ${jobReq.request_text}\nProtocol slug: ${jobReq.protocol_slug}\nBudget: ${jobReq.budget_usdc} USDC${templateHint}`;

  const plan = (await structured.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userMsg },
  ])) as SpecialistPlan;

  plan.specialist_ids = plan.specialist_ids.filter((id) => id in ALL_SPECIALISTS);
  if (!plan.specialist_ids.length) plan.specialist_ids = Object.keys(ALL_SPECIALISTS);

  console.log(`[orchestrator] LLM plan: [${plan.specialist_ids.join(", ")}] -- ${plan.reasoning}`);
  console.log(`[orchestrator] LLM category label: '${plan.template_label}'`);
  return plan;
}

export async function writeMemo(jobReq: JobRequest, claims: Claim[]): Promise<string> {
  if (!claims.length) {
    // No claims exist to cite -- this isn't a case where an LLM call adds
    // judgment, the correct memo is fixed regardless of which model you
    // ask. Observed without this guard: the model filled the gap with
    // unsourced training-data "facts" that read exactly like real
    // diligence output despite zero underlying evidence -- exactly the
    // failure mode this project exists to prevent.
    console.log("[orchestrator] no claims gathered -- skipping memo LLM call, returning an explicit no-data notice");
    return (
      `# ${jobReq.protocol_slug} Diligence Memo\n\n` +
      "No claims were successfully gathered for this request (every specialist call " +
      "either failed or returned no data). This memo cannot make any verified " +
      "statements about the protocol. Resubmit the job to try again."
    );
  }

  const model = getModel("orchestrator");
  const systemPrompt =
    "You write concise financial diligence memos from a list of verified claims. " +
    "Cite every claim's source inline. Every factual statement in the memo must " +
    "trace back to one of the claims given -- do not add facts, figures, dates, or " +
    "names from your own general knowledge, even ones you believe to be true. If " +
    "the claims don't cover something, omit it rather than filling the gap. " +
    "End with a one-line risk rating (Low/Medium/High) based only on the claims given.";

  const claimsText = claims.map((c) => `- [${c.claim_type}] ${c.claim_text} (source: ${c.provider_source})`).join("\n");
  const result = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Request: ${jobReq.request_text}\n\nClaims gathered:\n${claimsText}\n\nWrite the memo.` },
  ]);
  return typeof result.content === "string" ? result.content : JSON.stringify(result.content);
}
