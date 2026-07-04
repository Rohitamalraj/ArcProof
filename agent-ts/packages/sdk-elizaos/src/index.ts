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
import { runTrustedJob, type TrustedAgentConfig, type RunJobParams, type SettlementResult, type Claim, type WalletCredential } from "@arcproof/sdk";

export interface ElizaContent {
  text?: string;
  [key: string]: unknown;
}
export interface ElizaMemory {
  content: ElizaContent;
  [key: string]: unknown;
}
export interface ElizaState {
  values: Record<string, unknown>;
  [key: string]: unknown;
}
export interface ElizaActionExample {
  name: string;
  content: ElizaContent;
}
export interface ElizaActionResult {
  text?: string;
  values?: Record<string, unknown>;
  data?: Record<string, unknown>;
  success: boolean;
  error?: string | Error;
}
export type ElizaHandlerCallback = (response: ElizaContent) => Promise<unknown>;
export type ElizaValidator = (runtime: unknown, message: ElizaMemory, state?: ElizaState) => Promise<boolean>;
export type ElizaHandler = (
  runtime: unknown,
  message: ElizaMemory,
  state?: ElizaState,
  options?: unknown,
  callback?: ElizaHandlerCallback,
  responses?: ElizaMemory[]
) => Promise<ElizaActionResult | void | undefined>;

export interface ElizaAction {
  name: string;
  description: string;
  similes?: string[];
  examples?: ElizaActionExample[][];
  validate: ElizaValidator;
  handler: ElizaHandler;
  [key: string]: unknown;
}

export interface ElizaPlugin {
  name: string;
  description: string;
  actions?: ElizaAction[];
  [key: string]: unknown;
}

export interface ArcProofActionOptions {
  /** ElizaOS action name, e.g. "CHECK_TRUE_APR" -- convention is SCREAMING_SNAKE_CASE. */
  name: string;
  description: string;
  similes?: string[];
  examples?: ElizaActionExample[][];
  trustedAgentConfig: TrustedAgentConfig;
  requester: WalletCredential;
  settler: WalletCredential;
  providerAddresses: Record<string, string>;
  budgetAmount: number;
  gatherClaims: (context: Record<string, unknown>) => Promise<Claim[]>;
  /** Extracts job context (e.g. a loan id, an account, a protocol slug) from the incoming message. */
  buildContext: (message: ElizaMemory, state?: ElizaState) => Record<string, unknown>;
  /** Custom trigger condition -- defaults to "always applies" (ElizaOS's own routing/prompting decides whether to invoke this action at all). */
  validate?: ElizaValidator;
  /** Formats the settlement result into the text ElizaOS sends back to the user. */
  formatResponse?: (result: SettlementResult) => string;
}

function defaultFormatResponse(result: SettlementResult): string {
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
export function createArcProofAction(options: ArcProofActionOptions): ElizaAction {
  return {
    name: options.name,
    description: options.description,
    similes: options.similes ?? [],
    examples: options.examples ?? [],
    validate: options.validate ?? (async () => true),
    handler: async (_runtime, message, state, _handlerOptions, callback) => {
      const jobId = randomUUID();
      const context = { jobId, ...options.buildContext(message, state) };

      try {
        const params: RunJobParams = {
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

        if (callback) await callback({ text });
        return { text, success: true, data: { settlement: result as unknown as Record<string, unknown> } };
      } catch (e) {
        const text = `Couldn't complete that verified request: ${e}`;
        if (callback) await callback({ text });
        return { text, success: false, error: e instanceof Error ? e : String(e) };
      }
    },
  };
}

/** Bundles one or more ArcProof actions into a real, installable ElizaOS Plugin. */
export function createArcProofPlugin(options: { name: string; description: string; actions: ElizaAction[] }): ElizaPlugin {
  return {
    name: options.name,
    description: options.description,
    actions: options.actions,
  };
}
