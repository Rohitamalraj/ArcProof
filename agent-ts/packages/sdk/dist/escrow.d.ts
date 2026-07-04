import { type NetworkConfig } from "./chain.js";
import type { CircleConfig } from "./circleWallet.js";
export type WalletCredential = {
    kind: "plain";
    privateKey: string;
} | {
    kind: "circle";
    walletId: string;
    circleConfig: CircleConfig;
};
export declare class EscrowError extends Error {
}
export interface ContractTx {
    txHash: string;
    blockNumber: number;
    explorerUrl: string;
}
export interface EscrowJob {
    requester: string;
    lockedAmount: number;
    releasedAmount: number;
    status: "none" | "locked" | "settled" | "refunded";
}
export declare function jobIdToBytes32(jobId: string): `0x${string}`;
/** Deploys a fresh VeriFiEscrow instance. `settlerAddress` is the only address allowed to release/finalize/refund. */
export declare function deployEscrow(network: NetworkConfig, deployerPrivateKey: string, settlerAddress: string): Promise<string>;
/** Requester locks a job's budget into the contract (a real payable call). */
export declare function lock(network: NetworkConfig, contractAddress: string, jobId: string, requester: WalletCredential, amountNative: number): Promise<ContractTx>;
/** Settler releases one provider's payout for a job. */
export declare function release(network: NetworkConfig, contractAddress: string, jobId: string, settler: WalletCredential, providerAddress: string, amountNative: number, outcome: string): Promise<ContractTx>;
/** Settler closes a job; any unreleased balance stays withheld in the contract. */
export declare function finalize(network: NetworkConfig, contractAddress: string, jobId: string, settler: WalletCredential): Promise<ContractTx>;
/** Settler refunds a job's full remaining locked balance to the requester. */
export declare function refund(network: NetworkConfig, contractAddress: string, jobId: string, settler: WalletCredential): Promise<ContractTx>;
export declare function getJob(network: NetworkConfig, contractAddress: string, jobId: string): Promise<EscrowJob>;
