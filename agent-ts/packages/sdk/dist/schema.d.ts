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
export declare const VerificationStatusSchema: z.ZodEnum<["pending", "match", "mismatch", "unverifiable"]>;
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export declare const VerdictSchema: z.ZodEnum<["accept", "partial", "reject"]>;
export type Verdict = z.infer<typeof VerdictSchema>;
/** A single, independently-checkable statement a provider agent makes. */
export declare const ClaimSchema: z.ZodObject<{
    claim_id: z.ZodString;
    job_id: z.ZodString;
    provider_agent_id: z.ZodString;
    claim_type: z.ZodString;
    claim_text: z.ZodString;
    claim_value: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodBoolean, z.ZodNumber, z.ZodString]>>>;
    provider_source: z.ZodString;
    simulated: z.ZodDefault<z.ZodBoolean>;
    verification_status: z.ZodDefault<z.ZodEnum<["pending", "match", "mismatch", "unverifiable"]>>;
    verification_source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    verification_value: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodBoolean, z.ZodNumber, z.ZodString]>>>;
    verification_delta: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    verification_note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    claim_id: string;
    job_id: string;
    provider_agent_id: string;
    claim_type: string;
    claim_text: string;
    provider_source: string;
    simulated: boolean;
    verification_status: "match" | "pending" | "mismatch" | "unverifiable";
    claim_value?: string | number | boolean | null | undefined;
    verification_source?: string | null | undefined;
    verification_value?: string | number | boolean | null | undefined;
    verification_delta?: number | null | undefined;
    verification_note?: string | null | undefined;
}, {
    claim_id: string;
    job_id: string;
    provider_agent_id: string;
    claim_type: string;
    claim_text: string;
    provider_source: string;
    claim_value?: string | number | boolean | null | undefined;
    simulated?: boolean | undefined;
    verification_status?: "match" | "pending" | "mismatch" | "unverifiable" | undefined;
    verification_source?: string | null | undefined;
    verification_value?: string | number | boolean | null | undefined;
    verification_delta?: number | null | undefined;
    verification_note?: string | null | undefined;
}>;
export type Claim = z.infer<typeof ClaimSchema>;
export declare const ProviderPayoutSchema: z.ZodObject<{
    provider_agent_id: z.ZodString;
    claims_checked: z.ZodNumber;
    matches: z.ZodNumber;
    mismatches: z.ZodNumber;
    unverifiable: z.ZodNumber;
    allocated_usdc: z.ZodNumber;
    paid_usdc: z.ZodNumber;
    fraction_paid: z.ZodNumber;
    outcome: z.ZodEnum<["full", "partial", "withheld"]>;
}, "strip", z.ZodTypeAny, {
    unverifiable: number;
    provider_agent_id: string;
    claims_checked: number;
    matches: number;
    mismatches: number;
    allocated_usdc: number;
    paid_usdc: number;
    fraction_paid: number;
    outcome: "partial" | "full" | "withheld";
}, {
    unverifiable: number;
    provider_agent_id: string;
    claims_checked: number;
    matches: number;
    mismatches: number;
    allocated_usdc: number;
    paid_usdc: number;
    fraction_paid: number;
    outcome: "partial" | "full" | "withheld";
}>;
export type ProviderPayout = z.infer<typeof ProviderPayoutSchema>;
/** Result of running a job's claims through settle(). */
export interface SettlementResult {
    overall_verdict: Verdict;
    total_paid_usdc: number;
    payouts: ProviderPayout[];
    claims: Claim[];
}
