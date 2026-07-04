/**
 * Real Circle Developer-Controlled Wallets integration
 * (@circle-fin/developer-controlled-wallets, Circle's own Node SDK).
 * Adapted from agent-ts's core/src/circleWallet.ts -- same logic, takes
 * {apiKey, entitySecret} as an explicit parameter instead of a fixed
 * config module import, so a published library doesn't dictate where its
 * host app stores credentials.
 *
 * One-time setup (per Circle account, semi-irreversible):
 *   1. generateEntitySecret() locally, once.
 *   2. registerEntitySecretCiphertext({apiKey, entitySecret}) to bind it.
 *   3. Create a wallet set + one wallet per role you want Circle-backed.
 * See this package's README "Circle Wallets setup".
 *
 * Note on the dynamic import below: a static
 * `import { initiateDeveloperControlledWalletsClient } from "..."` fails
 * at runtime under tsx specifically -- a loader-hook resolution quirk
 * with this package's multi-condition `exports` map, not a real missing
 * export (confirmed against the installed package's ESM build directly).
 * A lazy `await import(...)` sidesteps it and has the side benefit of
 * never loading the Circle SDK for callers who don't use it.
 */
import type { Blockchain } from "@circle-fin/developer-controlled-wallets";
export interface CircleConfig {
    apiKey: string;
    entitySecret: string;
}
export declare class CircleWalletError extends Error {
}
export declare function createWalletSet(config: CircleConfig, name: string): Promise<string>;
export declare function createWallet(config: CircleConfig, walletSetId: string, blockchain: Blockchain): Promise<{
    walletId: string;
    address: string;
}>;
export declare function getBalanceNative(config: CircleConfig, walletId: string): Promise<number>;
export interface CircleTxResult {
    txHash: string;
}
/** Calls a contract function through a Circle-managed wallet, waits for it to mine. */
export declare function executeContract(config: CircleConfig, walletId: string, contractAddress: string, abiFunctionSignature: string, abiParameters: (string | number | boolean)[], amountNative?: number): Promise<CircleTxResult>;
/** Simple native-value transfer through a Circle-managed wallet. */
export declare function transfer(config: CircleConfig, walletId: string, destinationAddress: string, amountNative: number): Promise<CircleTxResult>;
