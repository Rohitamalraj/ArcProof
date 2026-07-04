/**
 * ElizaOS plugin adapter for @arcproof/sdk: exposes a bonded,
 * independently-verified, real-payment flow as an ElizaOS Action.
 *
 * Shapes below (ElizaAction/ElizaPlugin/etc.) are structurally verified
 * against @elizaos/core@1.7.2's actual dist/types/*.d.ts definitions
 * (Action, Plugin, Handler, Validator, Memory, State, Content,
 * ActionResult, ActionExample), not guessed from memory -- but
 * deliberately NOT imported from "@elizaos/core" directly: that
 * package's top-level barrel (dist/index.d.ts) re-exports both
 * ./types (which defines `Action`/`Plugin` as types) and ./actions
 * (which defines a same-named runtime export), and TypeScript silently
 * drops an ambiguous `export *` name rather than erroring -- confirmed
 * live (`Module has no exported member 'Action'` etc. even though the
 * type genuinely exists in the package). Defining structurally-identical
 * local types sidesteps that import ambiguity entirely; TypeScript's
 * structural typing makes the object this module builds assignable to
 * the real Plugin/Action types wherever a consumer's actual ElizaOS
 * runtime code expects them.
 *
 * The action's handler calls runTrustedJob() under the hood: lock a real
 * budget, run your gatherClaims() step (any framework -- often
 * @arcproof/sdk-langchain wrapping the same LangChain.js agent this
 * ElizaOS character already uses for its model calls), independently
 * verify every claim, then release/refund real on-chain payment based on
 * the verdict. ElizaOS only ever sees the natural-language in and out;
 * the trust mechanics are identical to the LangChain.js-only path.
 */
import { randomUUID } from "node:crypto";
import { runTrustedJob } from "@arcproof/sdk";
import { ELIZA_RUNTIME_CONTEXT_KEY } from "./elizaAgent.js";
export * from "./elizaAgent.js";
function defaultFormatResponse(result) {
    const lines = [`Verdict: ${result.overall_verdict.toUpperCase()} (paid ${result.total_paid_usdc.toFixed(4)})`, ""];
    for (const c of result.claims) {
        lines.push(`- [${c.claim_type}] ${c.claim_text} -> ${c.verification_status}${c.verification_note ? ` (${c.verification_note})` : ""}`);
    }
    return lines.join("\n");
}
/**
 * Builds a real ElizaOS Action that runs a full bonded job (lock -> gather
 * -> verify -> settle/refund) whenever ElizaOS decides to invoke it.
 * Every payment is a real Arc transaction -- nothing here is simulated
 * just because it's running inside an agent framework instead of a
 * standalone script.
 */
export function createArcProofAction(options) {
    return {
        name: options.name,
        description: options.description,
        similes: options.similes ?? [],
        examples: options.examples ?? [],
        validate: options.validate ?? (async () => true),
        handler: async (runtime, message, state, _handlerOptions, callback) => {
            const jobId = randomUUID();
            // Inject the ElizaOS runtime into the job context so native
            // createEliza* gatherers can reach runtime.useModel without changing
            // the framework-agnostic gatherClaims(context) signature. A LangChain
            // gatherer simply ignores this key; an ElizaOS-native one reads it.
            const context = { jobId, [ELIZA_RUNTIME_CONTEXT_KEY]: runtime, ...options.buildContext(message, state) };
            try {
                const params = {
                    jobId,
                    budgetAmount: options.budgetAmount,
                    requester: options.requester,
                    settler: options.settler,
                    providerAddresses: options.providerAddresses,
                    gatherClaims: options.gatherClaims,
                    context,
                };
                const result = await runTrustedJob(options.trustedAgentConfig, params);
                const text = (options.formatResponse ?? defaultFormatResponse)(result);
                if (callback)
                    await callback({ text });
                return { text, success: true, data: { settlement: result } };
            }
            catch (e) {
                const text = `Couldn't complete that verified request: ${e}`;
                if (callback)
                    await callback({ text });
                return { text, success: false, error: e instanceof Error ? e : String(e) };
            }
        },
    };
}
/** Bundles one or more ArcProof actions into a real, installable ElizaOS Plugin. */
export function createArcProofPlugin(options) {
    return {
        name: options.name,
        description: options.description,
        actions: options.actions,
    };
}
//# sourceMappingURL=index.js.map