import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Claim } from "@arcproof/sdk";
export interface LangChainClaimGathererOptions {
    /** Becomes claim.provider_agent_id on every claim this agent drafts. */
    agentId: string;
    model: BaseChatModel;
    tools: StructuredToolInterface[];
    systemPrompt: string;
    /** Restrict claim_type to this fixed set (z.enum) instead of an open string -- optional. */
    claimTypes?: string[];
    /** Builds the user message from the job context passed into gatherClaims(). Defaults to JSON.stringify(context). */
    buildUserMessage?: (context: Record<string, unknown>) => string;
}
/**
 * Wraps a LangChain.js tool-calling agent as a `gatherClaims()` function.
 * Resilient by design: an LLM call failure (quota, provider outage,
 * malformed generation) logs and produces zero claims rather than
 * throwing -- runTrustedJob()'s hasCheckableClaims() guard already
 * handles "this provider contributed nothing" correctly (refund, not a
 * false accept), so a single flaky provider never has to crash the job.
 */
export declare function createLangChainClaimGatherer(options: LangChainClaimGathererOptions): (context: Record<string, unknown>) => Promise<Claim[]>;
/**
 * Combines several claim gatherers (e.g. one LangChain agent per
 * specialty) into the single gatherClaims() function runTrustedJob()
 * expects -- runs them concurrently, and one gatherer throwing doesn't
 * lose the others' claims.
 */
export declare function combineClaimGatherers(gatherers: Array<(context: Record<string, unknown>) => Promise<Claim[]>>): (context: Record<string, unknown>) => Promise<Claim[]>;
export * from "./orchestrator.js";
