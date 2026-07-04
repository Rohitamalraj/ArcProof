/**
 * Wire-format schema shared by every service (PRD S10, ported from
 * agent/shared/schema.py). Import this, don't redefine it -- it's what lets
 * the orchestrator, specialists and evaluator agree on shape without a
 * runtime negotiation step.
 */
import { z } from "zod";

export const ClaimTypeSchema = z.enum([
  "tvl",
  "price_change",
  "wallet_flow",
  "token_concentration",
  "governance_event",
  "news_incident",
  "compliance_flag",
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const VerificationStatusSchema = z.enum(["pending", "match", "mismatch", "unverifiable"]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const JobStatusSchema = z.enum([
  "pending",
  "in_progress",
  "accepted",
  "partial_accepted",
  "rejected",
  "failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const VerdictSchema = z.enum(["accept", "partial", "reject"]);
export type Verdict = z.infer<typeof VerdictSchema>;

const claimValueSchema = z.union([z.boolean(), z.number(), z.string()]).nullable().optional();

export const ClaimSchema = z.object({
  claim_id: z.string(),
  job_id: z.string(),
  provider_agent_id: z.string(),
  claim_type: ClaimTypeSchema,
  claim_text: z.string(),
  claim_value: claimValueSchema,
  provider_source: z.string(),
  // true if the provider's own data source was a fallback fixture, not a live call
  simulated: z.boolean().default(false),

  verification_status: VerificationStatusSchema.default("pending"),
  verification_source: z.string().nullable().optional(),
  verification_value: claimValueSchema,
  verification_delta: z.number().nullable().optional(),
  verification_note: z.string().nullable().optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const SpecialistResponseSchema = z.object({
  provider_agent_id: z.string(),
  job_id: z.string(),
  claims: z.array(ClaimSchema),
});
export type SpecialistResponse = z.infer<typeof SpecialistResponseSchema>;

export const JobRequestSchema = z.object({
  request_text: z.string(),
  // optional requester-supplied label/hint; if omitted, the orchestrator's LLM
  // infers a fitting one from request_text -- not a fixed enum, any request
  // gets its own category
  template: z.string().nullable().optional(),
  budget_usdc: z.number().positive(),
  // e.g. "aave", "lido" -- DefiLlama slug, also used for price/governance lookups
  protocol_slug: z.string(),
  requester_wallet: z.string().default("requester"),
  // wallet checked by the compliance agent; defaults to a clean demo address
  target_address: z.string().nullable().optional(),
  // demo-only: force a specialist to fabricate a claim
  inject_fault: z.enum(["onchain", "news", "compliance"]).nullable().optional(),
});
export type JobRequest = z.infer<typeof JobRequestSchema>;

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
export type ProviderPayout = z.infer<typeof ProviderPayoutSchema>;

export const JobRecordSchema = z.object({
  job_id: z.string(),
  requester_id: z.string(),
  // requester-supplied or LLM-inferred label -- descriptive, not a fixed category
  template: z.string(),
  request_text: z.string(),
  protocol_slug: z.string(),
  budget_usdc: z.number(),
  status: JobStatusSchema.default("pending"),
  created_at: z.string(),
  subtasks: z.array(z.string()).default([]),
  final_memo: z.string().nullable().optional(),
  overall_verdict: VerdictSchema.nullable().optional(),
  total_paid_usdc: z.number().default(0),
  claims: z.array(ClaimSchema).default([]),
  payouts: z.array(ProviderPayoutSchema).default([]),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const ReputationRecordSchema = z.object({
  provider_agent_id: z.string(),
  total_jobs: z.number().default(0),
  accepted_claims: z.number().default(0),
  mismatched_claims: z.number().default(0),
  unverifiable_claims: z.number().default(0),
  accuracy_score: z.number().default(1.0),
  last_updated: z.string().default(""),
});
export type ReputationRecord = z.infer<typeof ReputationRecordSchema>;
