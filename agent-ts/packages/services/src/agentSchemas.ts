/**
 * Structured-output schemas for the real LLM agents (specialists +
 * orchestrator planner). Ported from agent/agents/agent_schemas.py --
 * kept separate from @arcproof/core's schema.ts (the wire format every
 * service exchanges over HTTP): these are only the shape an agent's LLM
 * call itself is constrained to, before the server assigns
 * claim_id/job_id/provider_agent_id and turns a draft into a real Claim.
 *
 * Note: unlike the Python version, there is no ClaimVerdict/EvaluationOutput
 * schema here -- this project's evaluator (core's evaluator.ts) is
 * deterministic code, not an LLM call, so it needs no structured-output
 * schema at all.
 */
import { z } from "zod";
import { ClaimTypeSchema } from "@arcproof/core";

export const ClaimDraftSchema = z.object({
  claim_type: ClaimTypeSchema,
  claim_text: z.string().describe("Human-readable statement of the claim, citing the number/fact"),
  // Deliberately a plain, required string -- not z.union([boolean, number,
  // string]) and not even .nullable(): Gemini's function-calling schema
  // translator rejects JSON Schema `anyOf` at this nested position
  // (array-of-objects property) *regardless of branch count*, including
  // the 2-branch [string, null] shape .nullable() produces (observed live:
  // "Invalid JSON payload ... Proto field is not repeating, cannot start
  // list" both times). The model stringifies whatever value it copied from
  // the tool (e.g. "182000000", "true", "-3.4") -- a claim is only drafted
  // when a real value exists (per this schema's own "omit any the tools
  // couldn't produce" instruction), so there's no legitimate null case
  // here anyway. core/src/evaluator.ts's toNumber()/toBool() already
  // coerce from string form.
  claim_value: z
    .string()
    .describe(
      "The exact value returned by the tool used, copied verbatim as a string -- never estimated, never " +
        "paraphrased. Numbers: copy the digits exactly (e.g. \"182000000\", \"-3.4\"). Booleans (a tool result " +
        "like flagged=true/false or touched_exchange=true/false): copy the literal word \"true\" or \"false\" " +
        "lowercase, exactly as the tool printed it -- do NOT write a natural-language paraphrase like \"not " +
        "flagged\" or \"did not touch\", since only the literal true/false string can be checked automatically."
    ),
  provider_source: z.string().describe("The exact source string/URL returned by the tool used"),
  // Same fix as claim_value above, needed for a different provider this
  // time: Groq's tool-calling returned the JSON string "false" for this
  // field instead of the JSON boolean false ("expected boolean, but got
  // string"), failing schema validation and losing the whole claim.
  // Plain string + explicit true/false convention, coerced back to a real
  // boolean in runAnalysis.ts before it reaches the wire schema (which
  // does keep `simulated` a real z.boolean(), since that field isn't
  // touched by either provider's structured-output quirk).
  simulated: z
    .string()
    .default("false")
    .describe(
      "Whether the tool's result explicitly said simulated=true. Write the literal lowercase string \"true\" or " +
        "\"false\" -- not a JSON boolean -- same convention as claim_value above."
    ),
});
export type ClaimDraft = z.infer<typeof ClaimDraftSchema>;

export const SpecialistClaimsSchema = z.object({
  claims: z
    .array(ClaimDraftSchema)
    .describe("One entry per data point actually gathered via a tool call -- omit any the tools couldn't produce"),
});
export type SpecialistClaims = z.infer<typeof SpecialistClaimsSchema>;

export const ALL_SPECIALISTS: Record<string, string> = {
  "onchain-agent-v1": "On-chain data: TVL, 7-day price change, treasury wallet flow to exchanges, token holder concentration.",
  "news-agent-v1": "News/fundamentals: most recent governance proposal outcome, reported security incidents.",
  "compliance-agent-v1": "Compliance/filings: OFAC sanctions screening for a specific wallet address.",
};

export const SpecialistPlanSchema = z.object({
  specialist_ids: z
    .array(z.string())
    .describe("Subset of onchain-agent-v1, news-agent-v1, compliance-agent-v1 to engage"),
  reasoning: z.string().describe("One sentence on why these specialists (and not others) answer the request"),
  template_label: z
    .string()
    .describe(
      "A short (2-5 word) descriptive category for this specific request, e.g. 'Protocol Treasury Diligence', " +
        "'Yield Opportunity Review', 'Sanctions Screening', or something new you invent if the request doesn't fit " +
        "an existing pattern -- this is not a fixed enum, every request gets its own fitting label"
    ),
});
export type SpecialistPlan = z.infer<typeof SpecialistPlanSchema>;
