/**
 * Native ElizaOS orchestrator + specialist builders -- the piece that
 * makes @arcproof/sdk-elizaos a genuine STANDALONE alternative to
 * @arcproof/sdk-langchain, not an add-on that requires it.
 *
 * These build claim-gathering functions that run entirely on ElizaOS's
 * own model API (`runtime.useModel(ModelType.OBJECT_LARGE, ...)`), with
 * zero LangChain dependency. So `@arcproof/sdk` + `@arcproof/sdk-elizaos`
 * alone gives the full orchestrator -> specialists -> evaluator pipeline:
 *   orchestrator (createElizaOrchestrator)   -- picks which specialists a request needs
 *   specialist   (createElizaClaimGatherer)  -- runs its tools, drafts claims
 *   evaluator    (@arcproof/sdk's VerifierRegistry) -- independently verifies, zero LLM
 *
 * How the ElizaOS model runtime reaches these functions: createArcProofAction
 * injects the `runtime` it receives in its handler into the job `context`
 * (context.__elizaRuntime), and these read it back out. That keeps the
 * gatherClaims signature `(context) => Promise<Claim[]>` identical to the
 * LangChain adapter's, so an ArcProof action doesn't care which framework
 * built its gatherer.
 *
 * Design note -- deterministic tool invocation, LLM claim drafting: unlike
 * LangChain's createReactAgent (an LLM tool-*calling* loop where the model
 * chooses which tools to invoke), a specialist here runs all its declared
 * tools, then hands the raw results to one structured-output model call
 * that drafts claims. This is deliberate: it's far more reliable than
 * parsing multi-turn tool-call JSON out of ElizaOS's plain useModel, and
 * for these specialists the tool choice is trivial anyway (the on-chain
 * agent calls all four of its tools every time). The genuinely LLM-shaped
 * work -- deciding how to phrase each claim, copying values verbatim,
 * omitting data points a tool couldn't produce -- still runs through the
 * model, exactly as in the LangChain path.
 */
import { randomUUID } from "node:crypto";
const OBJECT_LARGE = "OBJECT_LARGE"; // ModelType.OBJECT_LARGE
/** Key under which createArcProofAction stashes the ElizaOS runtime in the job context. */
export const ELIZA_RUNTIME_CONTEXT_KEY = "__elizaRuntime";
function runtimeFrom(context) {
    const rt = context[ELIZA_RUNTIME_CONTEXT_KEY];
    if (!rt || typeof rt.useModel !== "function") {
        throw new Error("no ElizaOS runtime in context -- createEliza* gatherers must be run through createArcProofAction " +
            "(which injects runtime), or you must set context." + ELIZA_RUNTIME_CONTEXT_KEY + " yourself.");
    }
    return rt;
}
const CLAIMS_SCHEMA = {
    type: "object",
    properties: {
        claims: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    claim_type: { type: "string" },
                    claim_text: { type: "string" },
                    // claim_value / simulated are strings on purpose (not JSON boolean/
                    // number) -- same defensive convention the LangChain adapter uses,
                    // so a provider that stringifies "false"/"182000000" round-trips
                    // cleanly. @arcproof/sdk's toBool/toNumber coerce them back.
                    claim_value: { type: "string" },
                    provider_source: { type: "string" },
                    simulated: { type: "string" },
                },
                required: ["claim_type", "claim_text", "claim_value", "provider_source"],
            },
        },
    },
    required: ["claims"],
};
/**
 * Wraps a set of tools + a prompt as a `gatherClaims()` function that runs
 * on ElizaOS's own model runtime. Resilient by design: if the model call
 * fails, it logs and returns zero claims rather than throwing --
 * runTrustedJob's hasCheckableClaims guard turns "this provider produced
 * nothing" into a refund, not a false accept.
 */
export function createElizaClaimGatherer(options) {
    return async function gatherClaims(context) {
        const jobId = context.jobId ?? randomUUID();
        let drafts = [];
        try {
            const runtime = runtimeFrom(context);
            // Run every tool, collect its text result.
            const toolResults = await Promise.all(options.tools.map(async (t) => {
                try {
                    return `${t.name}: ${await t.run(context)}`;
                }
                catch (e) {
                    return `${t.name}: ERROR: ${e}`;
                }
            }));
            const userMsg = options.buildUserMessage
                ? options.buildUserMessage(context)
                : JSON.stringify(Object.fromEntries(Object.entries(context).filter(([k]) => k !== ELIZA_RUNTIME_CONTEXT_KEY)));
            const claimTypeHint = options.claimTypes?.length
                ? `\n\nUse only these claim_type values: ${options.claimTypes.join(", ")}.`
                : "";
            const prompt = `${options.systemPrompt}${claimTypeHint}\n\n` +
                `Request:\n${userMsg}\n\n` +
                `Data gathered from your tools (copy values verbatim; if a line starts with ERROR, omit that claim):\n` +
                `${toolResults.join("\n")}\n\n` +
                `Return a JSON object with a "claims" array. For claim_value and simulated, write the literal string ` +
                `form (e.g. "182000000", "true", "false") copied verbatim -- never a paraphrase.`;
            const result = (await runtime.useModel(OBJECT_LARGE, { prompt, schema: CLAIMS_SCHEMA, output: "object", temperature: 0 }));
            drafts = Array.isArray(result?.claims) ? result.claims : [];
        }
        catch (e) {
            console.log(`[${options.agentId}]   ! ElizaOS model call failed (${e}) -- no claims produced this call`);
            drafts = [];
        }
        return drafts.map((d) => {
            const simulated = String(d.simulated ?? "false").toLowerCase() === "true";
            // Defensive: `response_format: json_object` guarantees valid JSON but
            // NOT schema adherence, so some models omit claim_text even though the
            // schema marks it required (observed with gpt-oss-20b). Synthesize a
            // readable one from the fields that are present rather than surfacing
            // "undefined" in the memo. claim_value is what verification actually
            // uses, so a missing claim_text is cosmetic, not a correctness issue.
            const claimText = d.claim_text || `${d.claim_type} = ${d.claim_value}`;
            console.log(`[${options.agentId}]   ${d.claim_type} claim: ${claimText} (simulated=${simulated})`);
            return {
                claim_id: randomUUID(),
                job_id: jobId,
                provider_agent_id: options.agentId,
                claim_type: d.claim_type,
                claim_text: claimText,
                claim_value: d.claim_value,
                provider_source: d.provider_source,
                simulated,
                verification_status: "pending",
            };
        });
    };
}
const PLAN_SCHEMA = {
    type: "object",
    properties: {
        specialist_ids: { type: "array", items: { type: "string" } },
        reasoning: { type: "string" },
    },
    required: ["specialist_ids", "reasoning"],
};
/**
 * Builds a `gatherClaims()` that first asks ElizaOS's model which
 * registered specialists this specific request needs, then runs only
 * those and merges their claims -- the ElizaOS-native equivalent of
 * @arcproof/sdk-langchain's createLangChainOrchestrator, with no LangChain
 * dependency. A genuine planning failure propagates (runTrustedJob refunds);
 * a successful-but-empty plan defaults to engaging every specialist.
 */
export function createElizaOrchestrator(options) {
    const specialistIds = options.specialists.map((s) => s.id);
    if (specialistIds.length === 0)
        throw new Error("createElizaOrchestrator: at least one specialist is required");
    return async function gatherClaims(context) {
        const runtime = runtimeFrom(context);
        const systemPrompt = (options.systemPromptPrefix ?? "You are the orchestrator for a bonded, independently-verified agent network. ") +
            "Given a request, decide which specialist agents to engage. Each specialist costs the requester's budget, " +
            "so only pick ones actually relevant to the request:\n\n" +
            options.specialists.map((s) => `- ${s.id}: ${s.description}`).join("\n") +
            `\n\nReturn a JSON object: specialist_ids (array, a subset of the ids above) and reasoning (one sentence).`;
        const userMsg = options.buildPlanningMessage
            ? options.buildPlanningMessage(context)
            : (context.requestText ?? JSON.stringify(context));
        // No try/catch: a genuine planning failure should reach runTrustedJob's refund path.
        const plan = (await runtime.useModel(OBJECT_LARGE, {
            prompt: `${systemPrompt}\n\nRequest:\n${userMsg}`,
            schema: PLAN_SCHEMA,
            output: "object",
            temperature: 0,
        }));
        let selectedIds = (plan.specialist_ids ?? []).filter((id) => specialistIds.includes(id));
        if (!selectedIds.length)
            selectedIds = specialistIds;
        console.log(`[orchestrator] plan: [${selectedIds.join(", ")}] -- ${plan.reasoning ?? ""}`);
        const chosen = options.specialists.filter((s) => selectedIds.includes(s.id));
        const results = await Promise.all(chosen.map((s) => s.gatherClaims(context).catch((e) => {
            console.log(`[orchestrator]   ! ${s.id} threw (${e}) -- treating as zero claims from it`);
            return [];
        })));
        return results.flat();
    };
}
//# sourceMappingURL=elizaAgent.js.map