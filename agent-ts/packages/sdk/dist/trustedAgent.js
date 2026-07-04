import * as escrow from "./escrow.js";
import { settle, hasCheckableClaims } from "./settlement.js";
/**
 * Runs one full bonded job: lock -> gather -> verify -> settle (or
 * refund on any failure, including "nothing came back checkable").
 * Every step that moves money is a real, independently-verifiable Arc
 * transaction -- nothing here is a database write standing in for one.
 */
export async function runTrustedJob(config, params) {
    await escrow.lock(config.network, config.contractAddress, params.jobId, params.requester, params.budgetAmount);
    try {
        const claims = await params.gatherClaims(params.context ?? {});
        const verified = await config.verifiers.verifyClaims(claims, params.context ?? {});
        if (!hasCheckableClaims(verified)) {
            throw new Error(`no checkable claims for job ${params.jobId} (every provider failed or all claims were unverifiable)`);
        }
        return await settle(config.network, config.contractAddress, params.jobId, params.settler, params.budgetAmount, verified, params.providerAddresses);
    }
    catch (e) {
        console.log(`[trusted-agent] job ${params.jobId} failed after budget lock: ${e} -- refunding`);
        await escrow.refund(config.network, config.contractAddress, params.jobId, params.settler);
        throw e;
    }
}
//# sourceMappingURL=trustedAgent.js.map