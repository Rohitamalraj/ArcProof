export class VerifierRegistry {
    verifiers = new Map();
    /** Registers (or replaces) the verifier for one claim_type. */
    register(claimType, verifier) {
        this.verifiers.set(claimType, verifier);
        return this;
    }
    has(claimType) {
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
    async verifyClaims(claims, context = {}) {
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
            }
            catch (e) {
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
export function toNumber(v) {
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
export function toBool(v) {
    if (typeof v === "boolean")
        return v;
    if (typeof v === "string") {
        if (v.toLowerCase() === "true")
            return true;
        if (v.toLowerCase() === "false")
            return false;
    }
    return null;
}
/** ±tolerance (default 5%, matching the PRD's documented numeric tolerance) match/mismatch on two numbers. */
export function compareNumeric(claimed, independent, toleranceRatio = 0.05) {
    const deltaPct = independent !== 0 ? ((claimed - independent) / Math.abs(independent)) * 100 : claimed === 0 ? 0 : 100;
    const withinTolerance = Math.abs(deltaPct) <= toleranceRatio * 100;
    return { status: withinTolerance ? "match" : "mismatch", delta: Math.round(deltaPct * 100) / 100 };
}
//# sourceMappingURL=verifier.js.map