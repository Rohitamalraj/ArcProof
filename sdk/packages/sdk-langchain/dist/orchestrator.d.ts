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
export declare function createLangChainOrchestrator(options: LangChainOrchestratorOptions): (context: Record<string, unknown>) => Promise<Claim[]>;
