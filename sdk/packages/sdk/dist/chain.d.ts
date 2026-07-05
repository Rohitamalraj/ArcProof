/**
 * Real on-chain payment primitives against Arc testnet (or any EVM chain
 * you point it at). Adapted from agent-ts's core/src/chain.ts -- that
 * version is already fully generic (raw private keys/addresses/amounts in,
 * no role coupling), the only change here is taking network config as an
 * explicit parameter instead of importing a fixed .env-loaded module. A
 * published library shouldn't assume where or how its host app stores
 * config.
 */
import { type Chain } from "viem";
export interface NetworkConfig {
    rpcUrl: string;
    chainId: number;
    explorerUrl: string;
    /** Native currency symbol/decimals -- Arc's native token IS USDC at 18 decimals. */
    nativeCurrency?: {
        name: string;
        symbol: string;
        decimals: number;
    };
}
export declare const ARC_TESTNET: NetworkConfig;
export declare function chainFor(network: NetworkConfig): Chain;
export declare class OnChainTransferFailed extends Error {
}
export interface OnChainTransfer {
    txHash: string;
    fromAddress: string;
    toAddress: string;
    amountNative: number;
    blockNumber: number;
    explorerUrl: string;
}
export declare function explorerLink(network: NetworkConfig, txHash: string): string;
export declare function isConnected(network: NetworkConfig): Promise<boolean>;
/** Real, live balance read -- not cached, not tracked locally. */
export declare function getBalance(network: NetworkConfig, address: string): Promise<number>;
/**
 * Sign and broadcast a real transaction, then wait for it to mine. Throws
 * OnChainTransferFailed if the transaction reverts or times out --
 * callers should not treat a payment as having happened until this
 * resolves, since a receipt with status "success" is the only real proof.
 */
export declare function transfer(network: NetworkConfig, fromPrivateKey: string, toAddress: string, amountNative: number, memo?: string): Promise<OnChainTransfer>;
/**
 * Independently re-derive a payment fact from the chain itself, rather
 * than trusting a caller's word for it -- the same "don't trust the
 * claim, re-derive it" principle this SDK applies to agent claims,
 * applied here to payment claims.
 */
export declare function verifyTransfer(network: NetworkConfig, txHash: string, expectedFrom: string, expectedTo: string, minAmountNative: number): Promise<boolean>;
