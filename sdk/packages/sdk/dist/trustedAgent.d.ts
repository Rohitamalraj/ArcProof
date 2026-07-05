/**
 * The one high-level helper that ties everything together: lock a
 * budget, gather claims (however you want -- LangChain.js, ElizaOS, a
 * plain function, anything), independently verify them, then settle real
 * payment based on the verdict -- refunding instead if nothing came back
 * checkable, so a provider outage can never leave money silently stuck in
 * escrow (see settlement.ts's hasCheckableClaims doc comment).
 *
 * This is the "bring your own agent" seam: gatherClaims can wrap a
 * LangChain.js agent (see @arcproof/sdk-langchain), an ElizaOS action
 * (see @arcproof/sdk-elizaos), or nothing fancier than a function that
 * calls an API and returns Claim[] -- the trust layer doesn't care how a
 * claim was produced, only that it gets independently checked before any
 * money moves.
 */
import type { Claim, SettlementResult } from "./schema.js";
import type { VerifierRegistry } from "./verifier.js";
import type { NetworkConfig } from "./chain.js";
import type { WalletCredential } from "./escrow.js";
export interface TrustedAgentConfig {
    network: NetworkConfig;
    /** Address of a deployed VeriFiEscrow instance -- see escrow.ts's deployEscrow(). */
    contractAddress: string;
    verifiers: VerifierRegistry;
}
export interface RunJobParams {
    jobId: string;
    budgetAmount: number;
    /** Wallet that locks the budget -- a real signed transaction, real value attached. */
    requester: WalletCredential;
    /** Wallet allowed to release/finalize/refund (must match the address the contract was deployed with as settler). */
    settler: WalletCredential;
    /** provider_agent_id -> on-chain address to pay, for every provider that might appear in gathered claims. */
    providerAddresses: Record<string, string>;
    /** Your claim-gathering step -- call whatever agent(s) you want, return the claims they drafted. */
    gatherClaims: (context: Record<string, unknown>) => Promise<Claim[]>;
    /** Passed through untouched to both gatherClaims and every verifier. */
    context?: Record<string, unknown>;
}
/**
 * Runs one full bonded job: lock -> gather -> verify -> settle (or
 * refund on any failure, including "nothing came back checkable").
 * Every step that moves money is a real, independently-verifiable Arc
 * transaction -- nothing here is a database write standing in for one.
 */
export declare function runTrustedJob(config: TrustedAgentConfig, params: RunJobParams): Promise<SettlementResult>;
