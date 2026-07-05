/**
 * Generic wire schema for the ArcProof trust layer. Deliberately NOT the
 * same as @arcproof/core's schema.ts: that one locks `claim_type` to a
 * fixed 7-value DeFi-diligence enum (tvl, price_change, ...) because it's
 * the wire format for one specific reference app. This SDK is meant for
 * ANY vertical -- a lending platform's "true APR" agent has claim types
 * like `apr_rate`/`processing_fee`/`documentation_charge` that don't
 * exist in that enum at all -- so here `claim_type` is a plain string the
 * caller defines, and verification is pluggable (see verifier.ts) instead
 * of a hardcoded switch.
 */
import { z } from "zod";
export const VerificationStatusSchema = z.enum(["pending", "match", "mismatch", "unverifiable"]);
export const VerdictSchema = z.enum(["accept", "partial", "reject"]);
const claimValueSchema = z.union([z.boolean(), z.number(), z.string()]).nullable().optional();
/** A single, independently-checkable statement a provider agent makes. */
export const ClaimSchema = z.object({
    claim_id: z.string(),
    job_id: z.string(),
    provider_agent_id: z.string(),
    // Any string you define -- not a fixed enum. Register a verifier for
    // each claim_type your agents produce (see VerifierRegistry).
    claim_type: z.string(),
    claim_text: z.string(),
    claim_value: claimValueSchema,
    provider_source: z.string(),
    simulated: z.boolean().default(false),
    verification_status: VerificationStatusSchema.default("pending"),
    verification_source: z.string().nullable().optional(),
    verification_value: claimValueSchema,
    verification_delta: z.number().nullable().optional(),
    verification_note: z.string().nullable().optional(),
});
export const ProviderPayoutSchema = z.object({
    provider_agent_id: z.string(),
    claims_checked: z.number(),
    matches: z.number(),
    mismatches: z.number(),
    unverifiable: z.number(),
    allocated_usdc: z.number(),
    paid_usdc: z.number(),
    fraction_paid: z.number(),
    outcome: z.enum(["full", "partial", "withheld"]),
});
//# sourceMappingURL=schema.js.map