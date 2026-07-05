import * as escrow from "./escrow.js";
function checkable(claims) {
    return claims.filter((c) => c.verification_status === "match" || c.verification_status === "mismatch");
}
/**
 * True if at least one claim can actually be judged match/mismatch. A job
 * with zero checkable claims must NOT be routed through settle() --
 * computeJobVerdict treats "no mismatches" as "accept" regardless of
 * *why* there were none, which would finalize the escrow with the
 * requester's full budget silently withheld forever if you called
 * settle() anyway. Refund instead when this returns false.
 */
export function hasCheckableClaims(claims) {
    return checkable(claims).length > 0;
}
export function computeJobVerdict(claims, partialMismatchThreshold = 1) {
    const checkableClaims = checkable(claims);
    const mismatches = checkableClaims.filter((c) => c.verification_status === "mismatch");
    if (!checkableClaims.length || !mismatches.length)
        return "accept";
    if (mismatches.length > checkableClaims.length / 2)
        return "reject";
    if (mismatches.length <= partialMismatchThreshold)
        return "partial";
    return "reject";
}
export function computeProviderPayout(providerAgentId, providerClaims, allocatedAmount, partialMismatchThreshold = 1) {
    const checkableClaims = checkable(providerClaims);
    const matches = checkableClaims.filter((c) => c.verification_status === "match").length;
    const mismatches = checkableClaims.filter((c) => c.verification_status === "mismatch").length;
    const unverifiable = providerClaims.filter((c) => c.verification_status === "unverifiable").length;
    let fraction;
    let outcome;
    if (mismatches === 0) {
        fraction = 1.0;
        outcome = "full";
    }
    else if (mismatches <= partialMismatchThreshold) {
        fraction = 0.5;
        outcome = "partial";
    }
    else {
        fraction = 0.0;
        outcome = "withheld";
    }
    return {
        provider_agent_id: providerAgentId,
        claims_checked: checkableClaims.length,
        matches,
        mismatches,
        unverifiable,
        allocated_usdc: Math.round(allocatedAmount * 1e6) / 1e6,
        paid_usdc: Math.round(allocatedAmount * fraction * 1e6) / 1e6,
        fraction_paid: fraction,
        outcome,
    };
}
/**
 * Computes the verdict/payout math AND executes it as real on-chain
 * transactions: release() per provider that earned something, then
 * finalize() to close the job (any withheld remainder simply stays
 * locked in the contract, enforced by the contract itself).
 */
export async function settle(network, contractAddress, jobId, settler, budgetAmount, claims, providerAddresses) {
    console.log(`[settlement] job ${jobId}: computing verdict over ${claims.length} claims`);
    const overallVerdict = computeJobVerdict(claims);
    const byProvider = new Map();
    for (const c of claims) {
        const list = byProvider.get(c.provider_agent_id) ?? [];
        list.push(c);
        byProvider.set(c.provider_agent_id, list);
    }
    const nProviders = byProvider.size || 1;
    const share = budgetAmount / nProviders;
    const payouts = [];
    let totalPaid = 0;
    for (const [providerId, providerClaims] of byProvider) {
        const payout = computeProviderPayout(providerId, providerClaims, share);
        payouts.push(payout);
        if (payout.paid_usdc > 0) {
            const providerAddress = providerAddresses[providerId];
            if (!providerAddress)
                throw new Error(`no address given for provider '${providerId}' in providerAddresses`);
            await escrow.release(network, contractAddress, jobId, settler, providerAddress, payout.paid_usdc, payout.outcome);
            totalPaid += payout.paid_usdc;
        }
        console.log(`[settlement] ${providerId}: ${payout.matches} match / ${payout.mismatches} mismatch / ${payout.unverifiable} unverifiable ` +
            `-> ${payout.outcome} (${payout.paid_usdc.toFixed(4)}/${payout.allocated_usdc.toFixed(4)})`);
    }
    await escrow.finalize(network, contractAddress, jobId, settler);
    const totalPaidRounded = Math.round(totalPaid * 1e6) / 1e6;
    console.log(`[settlement] job ${jobId}: overall verdict = ${overallVerdict.toUpperCase()}, total paid = ${totalPaidRounded.toFixed(4)}`);
    return { overall_verdict: overallVerdict, total_paid_usdc: totalPaidRounded, payouts, claims };
}
//# sourceMappingURL=settlement.js.map