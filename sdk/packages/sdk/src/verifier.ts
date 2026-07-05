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

export class VerifierRegistry {
  private verifiers = new Map<string, Verifier>();

  /** Registers (or replaces) the verifier for one claim_type. */
  register(claimType: string, verifier: Verifier): this {
    this.verifiers.set(claimType, verifier);
    return this;
  }

  has(claimType: string): boolean {
    return this.verifiers.has(claimType);
  }

  /**
   * Runs every claim through its registered verifier, mutating and
   * returning the same claim objects with verification_* fields filled
   * in. A claim_type with no registered verifier -- or whose verifier
   * throws -- becomes "unverifiable" rather than silently passing or
   * failing; settlement.ts already treats unverifiable claims as never
   * counting toward mismatches or payment, so an unregistered claim type
   * costs a provider nothing but also earns them nothing.
   */
  async verifyClaims(claims: Claim[], context: Record<string, unknown> = {}): Promise<Claim[]> {
    for (const claim of claims) {
      const verifier = this.verifiers.get(claim.claim_type);
      if (!verifier) {
        claim.verification_status = "unverifiable";
        claim.verification_note = `no verifier registered for claim_type '${claim.claim_type}'`;
        continue;
      }
      try {
        const result = await verifier(claim, context);
        claim.verification_status = result.status;
        claim.verification_value = result.value ?? null;
        claim.verification_source = result.source ?? null;
        claim.verification_delta = result.delta ?? null;
        claim.verification_note = result.note;
      } catch (e) {
        claim.verification_status = "unverifiable";
        claim.verification_note = `verifier for '${claim.claim_type}' threw: ${e}`;
      }
    }
    return claims;
  }
}

// --- Small, reusable comparison helpers for writing your own verifiers ---
// (the same primitives agent-ts's evaluator.ts uses internally, exported
// here so a verifier doesn't have to reimplement type coercion by hand)

export function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
  }
  return null;
}

/** ±tolerance (default 5%, matching the PRD's documented numeric tolerance) match/mismatch on two numbers. */
export function compareNumeric(
  claimed: number,
  independent: number,
  toleranceRatio = 0.05
): { status: "match" | "mismatch"; delta: number } {
  const deltaPct = independent !== 0 ? ((claimed - independent) / Math.abs(independent)) * 100 : claimed === 0 ? 0 : 100;
  const withinTolerance = Math.abs(deltaPct) <= toleranceRatio * 100;
  return { status: withinTolerance ? "match" : "mismatch", delta: Math.round(deltaPct * 100) / 100 };
}
