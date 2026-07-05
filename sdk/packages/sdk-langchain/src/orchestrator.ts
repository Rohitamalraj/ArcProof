/**
 * Orchestrator layer: an LLM decides WHICH of your registered specialists
 * a specific request actually needs, then only those specialists' own
 * gatherClaims() functions run. This is the piece createLangChainClaimGatherer
 * alone doesn't provide -- that wraps ONE specialist; this is the dynamic
 * "orchestrator assigns specialists" step sitting above it, generalized
 * from the reference apps' langchainPlanner.ts (planSpecialists()).
 *
 * Full picture, matching the reference apps' architecture exactly:
 *   orchestrator (this file)  -- decides which specialists to engage
 *   specialist   (createLangChainClaimGatherer)  -- checks and drafts claims
 *   evaluator    (@arcproof/sdk's VerifierRegistry)  -- independently verifies
 *
 * Deliberately no fallback that hides a genuine planning failure: if the
 * structured-output call itself throws, this lets it propagate --
 * runTrustedJob's existing catch block already refunds the locked budget
 * rather than silently engaging every specialist and hoping for the best.
 * The one defensive guard kept from the reference apps is different in
 * kind: if the call SUCCEEDS but returns zero valid specialist ids (a
 * degenerate answer, not a failure), default to engaging all of them --
 * matching langchainPlanner.ts's `if (!plan.specialist_ids.length) ...`
 * line exactly.
 */
import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Claim } from "@arcproof/sdk";

export interface SpecialistDescriptor {
  /** Becomes claim.provider_agent_id on every claim this specialist drafts (via its own gatherClaims). */
  id: string;
  /** Shown to the planning LLM -- what this specialist checks, so it can decide when to engage it. */
  description: string;
  gatherClaims: (context: Record<string, unknown>) => Promise<Claim[]>;
}

export interface OrchestratorPlan {
  specialist_ids: string[];
  reasoning: string;
}

function planSchema(specialistIds: string[]) {
  return z.object({
    specialist_ids: z
      .array(z.enum(specialistIds as [string, ...string[]]))
      .describe("Subset of the available specialists actually relevant to this specific request -- each one costs the requester's budget"),
    reasoning: z.string().describe("One sentence on why these specialists (and not others) answer the request"),
  });
}

export interface LangChainOrchestratorOptions {
  model: BaseChatModel;
  specialists: SpecialistDescriptor[];
  /** Builds the planning call's user message from job context. Defaults to context.requestText, else JSON.stringify(context). */
  buildPlanningMessage?: (context: Record<string, unknown>) => string;
  /** Prepended to the auto-generated "given a request, decide which specialists to engage" instructions. */
  systemPromptPrefix?: string;
}

/**
 * Builds a gatherClaims()-compatible function that first asks an LLM which
 * registered specialists are relevant to this specific request, then runs
 * only those specialists and merges their claims. Drop the result straight
 * into runTrustedJob's `gatherClaims` parameter -- this replaces manually
 * calling combineClaimGatherers() with every specialist unconditionally.
 */
export function createLangChainOrchestrator(options: LangChainOrchestratorOptions): (context: Record<string, unknown>) => Promise<Claim[]> {
  const specialistIds = options.specialists.map((s) => s.id);
  if (specialistIds.length === 0) throw new Error("createLangChainOrchestrator: at least one specialist is required");
  const schema = planSchema(specialistIds);

  return async function gatherClaims(context: Record<string, unknown>): Promise<Claim[]> {
    const systemPrompt =
      (options.systemPromptPrefix ?? "You are the orchestrator for a bonded, independently-verified agent network. ") +
      "Given a request, decide which specialist agents to engage. Each specialist costs the requester's budget, " +
      "so only pick ones actually relevant to the request:\n\n" +
      options.specialists.map((s) => `- ${s.id}: ${s.description}`).join("\n");

    const userMsg = options.buildPlanningMessage
      ? options.buildPlanningMessage(context)
      : ((context.requestText as string | undefined) ?? JSON.stringify(context));

    // No try/catch here on purpose -- a genuine planning failure should
    // propagate to runTrustedJob's refund path, not be papered over.
    const structured = (options.model as unknown as { withStructuredOutput: (s: typeof schema, o: { name: string }) => { invoke: (m: unknown[]) => Promise<OrchestratorPlan> } }).withStructuredOutput(
      schema,
      { name: "OrchestratorPlan" }
    );
    const plan = await structured.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ]);

    let selectedIds = plan.specialist_ids.filter((id) => specialistIds.includes(id));
    if (!selectedIds.length) selectedIds = specialistIds; // degenerate-but-successful answer -- engage everyone rather than nobody

    console.log(`[orchestrator] plan: [${selectedIds.join(", ")}] -- ${plan.reasoning}`);

    const chosen = options.specialists.filter((s) => selectedIds.includes(s.id));
    const results = await Promise.all(
      chosen.map((s) =>
        s.gatherClaims(context).catch((e) => {
          console.log(`[orchestrator]   ! ${s.id} threw (${e}) -- treating as zero claims from it`);
          return [] as Claim[];
        })
      )
    );
    return results.flat();
  };
}
