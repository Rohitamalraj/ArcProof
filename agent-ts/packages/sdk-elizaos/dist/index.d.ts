import { type TrustedAgentConfig, type SettlementResult, type Claim, type WalletCredential } from "@arcproof/sdk";
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
export type ElizaHandler = (runtime: unknown, message: ElizaMemory, state?: ElizaState, options?: unknown, callback?: ElizaHandlerCallback, responses?: ElizaMemory[]) => Promise<ElizaActionResult | void | undefined>;
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
/**
 * Builds a real ElizaOS Action that runs a full bonded job (lock -> gather
 * -> verify -> settle/refund) whenever ElizaOS decides to invoke it.
 * Every payment is a real Arc transaction -- nothing here is simulated
 * just because it's running inside an agent framework instead of a
 * standalone script.
 */
export declare function createArcProofAction(options: ArcProofActionOptions): ElizaAction;
/** Bundles one or more ArcProof actions into a real, installable ElizaOS Plugin. */
export declare function createArcProofPlugin(options: {
    name: string;
    description: string;
    actions: ElizaAction[];
}): ElizaPlugin;
