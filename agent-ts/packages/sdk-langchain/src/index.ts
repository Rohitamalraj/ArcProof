/**
 * LangChain.js adapter for @arcproof/sdk: turns a LangChain.js
 * tool-calling agent into a `gatherClaims()` function runTrustedJob() can
 * call directly. The agent decides which tools to call and drafts
 * claims; this module only handles the LangChain-specific plumbing
 * (structured output schema, resilience, coercion into real Claim
 * objects) -- verification and payment stay entirely in @arcproof/sdk.
 *
 * The claim_value/simulated fields are deliberately typed as plain
 * strings with an explicit convention (not z.boolean()/z.union([...]))
 * in the structured-output schema below -- this sidesteps two real,
 * independently-observed provider incompatibilities: Gemini's function-
 * calling schema translator rejects `anyOf` unions nested inside
 * array-of-object properties (any branch count, including 2-branch
 * .nullable()), and Groq has been observed returning the JSON string
 * "false" for a z.boolean() field ("expected boolean, but got string").
 * A plain string field with a documented convention, coerced back to the
 * real type in JS, avoids both without depending on either provider
 * fixing their schema translation.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Claim } from "@arcproof/sdk";

function claimDraftSchema(claimTypes?: string[]) {
  return z.object({
    claims: z.array(
      z.object({
        claim_type: claimTypes && claimTypes.length > 0 ? z.enum(claimTypes as [string, ...string[]]) : z.string(),
        claim_text: z.string().describe("Human-readable statement of the claim, citing the number/fact"),
        claim_value: z
          .string()
          .describe(
            'The exact value returned by a tool, copied verbatim as a string -- e.g. "182000000", "-3.4", "true". ' +
              "Never estimated, never paraphrased."
          ),
        provider_source: z.string().describe("The exact source string/URL a tool returned"),
        simulated: z
          .string()
          .default("false")
          .describe('Literal lowercase "true" or "false" -- whether the underlying data was simulated/estimated rather than live.'),
      })
    ).describe("One entry per data point actually gathered -- omit any you couldn't produce, never invent one"),
  });
}

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
export function createLangChainClaimGatherer(options: LangChainClaimGathererOptions): (context: Record<string, unknown>) => Promise<Claim[]> {
  const schema = claimDraftSchema(options.claimTypes);

  return async function gatherClaims(context: Record<string, unknown>): Promise<Claim[]> {
    const jobId = (context.jobId as string | undefined) ?? randomUUID();
    let drafts: Array<{ claim_type: string; claim_text: string; claim_value: string; provider_source: string; simulated: string }> = [];

    try {
      const agent = createReactAgent({
        llm: options.model,
        tools: options.tools,
        responseFormat: schema,
        prompt: options.systemPrompt,
      });
      const userMsg = options.buildUserMessage ? options.buildUserMessage(context) : JSON.stringify(context);
      const result = await agent.invoke({ messages: [{ role: "user", content: userMsg }] });
      drafts = (result.structuredResponse as { claims: typeof drafts }).claims;
    } catch (e) {
      console.log(`[${options.agentId}]   ! LLM agent unavailable (${e}) -- no claims produced this call`);
      drafts = [];
    }

    return drafts.map((d) => {
      const simulated = d.simulated?.toLowerCase() === "true";
      console.log(`[${options.agentId}]   ${d.claim_type} claim: ${d.claim_text} (simulated=${simulated})`);
      return {
        claim_id: randomUUID(),
        job_id: jobId,
        provider_agent_id: options.agentId,
        claim_type: d.claim_type,
        claim_text: d.claim_text,
        claim_value: d.claim_value,
        provider_source: d.provider_source,
        simulated,
        verification_status: "pending" as const,
      };
    });
  };
}

/**
 * Combines several claim gatherers (e.g. one LangChain agent per
 * specialty) into the single gatherClaims() function runTrustedJob()
 * expects -- runs them concurrently, and one gatherer throwing doesn't
 * lose the others' claims.
 */
export function combineClaimGatherers(
  gatherers: Array<(context: Record<string, unknown>) => Promise<Claim[]>>
): (context: Record<string, unknown>) => Promise<Claim[]> {
  return async function gatherClaims(context: Record<string, unknown>): Promise<Claim[]> {
    const results = await Promise.all(
      gatherers.map((g) =>
        g(context).catch((e) => {
          console.log(`[combine-gatherers]   ! a gatherer threw (${e}) -- treating as zero claims from it`);
          return [] as Claim[];
        })
      )
    );
    return results.flat();
  };
}

export * from "./orchestrator.js";
