import type { Claim } from "@arcproof/sdk";
/** The one ElizaOS runtime method these builders need. `@elizaos/core`'s
 * IAgentRuntime satisfies this structurally -- kept as a minimal local
 * type for the same import-ambiguity reason documented in index.ts. */
export interface ElizaModelRuntime {
    useModel: (modelType: string, params: {
        prompt: string;
        schema?: unknown;
        output?: "object" | "array" | "enum";
        temperature?: number;
    }) => Promise<unknown>;
}
/** Key under which createArcProofAction stashes the ElizaOS runtime in the job context. */
export declare const ELIZA_RUNTIME_CONTEXT_KEY = "__elizaRuntime";
/** A plain data-fetching tool -- returns a text result (same "tool output"
 * convention as the LangChain adapter: state the value, or an "ERROR: ..."
 * line the model is told to treat as "skip that data point"). */
export interface ElizaTool {
    name: string;
    description: string;
    run: (context: Record<string, unknown>) => Promise<string>;
}
export interface ElizaClaimGathererOptions {
    /** Becomes claim.provider_agent_id on every claim this specialist drafts. */
    agentId: string;
    tools: ElizaTool[];
    /** Restrict claim_type to this set (documented in the prompt) -- optional. */
    claimTypes?: string[];
    systemPrompt: string;
    /** Builds the request line from the job context. Defaults to JSON.stringify(context minus the runtime). */
    buildUserMessage?: (context: Record<string, unknown>) => string;
}
/**
 * Wraps a set of tools + a prompt as a `gatherClaims()` function that runs
 * on ElizaOS's own model runtime. Resilient by design: if the model call
 * fails, it logs and returns zero claims rather than throwing --
 * runTrustedJob's hasCheckableClaims guard turns "this provider produced
 * nothing" into a refund, not a false accept.
 */
export declare function createElizaClaimGatherer(options: ElizaClaimGathererOptions): (context: Record<string, unknown>) => Promise<Claim[]>;
export interface ElizaSpecialistDescriptor {
    id: string;
    description: string;
    gatherClaims: (context: Record<string, unknown>) => Promise<Claim[]>;
}
export interface ElizaOrchestratorOptions {
    specialists: ElizaSpecialistDescriptor[];
    buildPlanningMessage?: (context: Record<string, unknown>) => string;
    systemPromptPrefix?: string;
}
/**
 * Builds a `gatherClaims()` that first asks ElizaOS's model which
 * registered specialists this specific request needs, then runs only
 * those and merges their claims -- the ElizaOS-native equivalent of
 * @arcproof/sdk-langchain's createLangChainOrchestrator, with no LangChain
 * dependency. A genuine planning failure propagates (runTrustedJob refunds);
 * a successful-but-empty plan defaults to engaging every specialist.
 */
export declare function createElizaOrchestrator(options: ElizaOrchestratorOptions): (context: Record<string, unknown>) => Promise<Claim[]>;
