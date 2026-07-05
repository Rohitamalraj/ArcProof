/**
 * Pluggable, deterministic claim verification -- the generalized form of
 * agent-ts's evaluator.ts. That file has the right idea (independently
 * re-derive each claim from a live source with a fixed rule, zero LLM
 * judgment, so verdicts stay auditable) but hardcodes the rule per one of
 * 7 DeFi claim types. Here, YOU register the rule per claim_type; the
 * registry is domain-agnostic.
 *
 * Every verifier must be a plain function: (claim, context) => verdict.
 * No LLM call belongs in a verifier -- that's the entire point of this
 * project's trust model. If a verifier needs to call an LLM to interpret
 * something, that interpretation belongs in the agent that DRAFTS the
 * claim, not in the code that CHECKS it.
 */
import type { Claim, VerificationStatus } from "./schema.js";
export interface VerificationResult {
    status: VerificationStatus;
    value?: boolean | number | string | null;
    source?: string;
    delta?: number | null;
    note: string;
}
/**
 * Independently re-derives and judges one claim. `context` is whatever
 * job-level data the verifier needs (e.g. a protocol slug, a target
 * address, an account id) -- passed through from verifyClaims() untouched
 * so verifiers can look up their OWN canonical value instead of trusting
 * anything in claim.claim_text (which is provider-controlled).
 */
export type Verifier = (claim: Claim, context: Record<string, unknown>) => Promise<VerificationResult>;
export declare class VerifierRegistry {
    private verifiers;
    /** Registers (or replaces) the verifier for one claim_type. */
    register(claimType: string, verifier: Verifier): this;
    has(claimType: string): boolean;
    /**
     * Runs every claim through its registered verifier, mutating and
     * returning the same claim objects with verification_* fields filled
     * in. A claim_type with no registered verifier -- or whose verifier
     * throws -- becomes "unverifiable" rather than silently passing or
     * failing; settlement.ts already treats unverifiable claims as never
     * counting toward mismatches or payment, so an unregistered claim type
     * costs a provider nothing but also earns them nothing.
     */
    verifyClaims(claims: Claim[], context?: Record<string, unknown>): Promise<Claim[]>;
}
export declare function toNumber(v: unknown): number | null;
export declare function toBool(v: unknown): boolean | null;
/** ±tolerance (default 5%, matching the PRD's documented numeric tolerance) match/mismatch on two numbers. */
export declare function compareNumeric(claimed: number, independent: number, toleranceRatio?: number): {
    status: "match" | "mismatch";
    delta: number;
};
