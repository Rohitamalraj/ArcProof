/**
 * @arcproof/sdk -- the trust layer for AI agents: make a claim,
 * independently verify it against live data, release real on-chain
 * payment only if it checks out. Bring your own agent (any framework,
 * any vertical) -- see @arcproof/sdk-langchain / @arcproof/sdk-elizaos
 * for adapters, or call runTrustedJob() directly with a plain function.
 */
export * from "./schema.js";
export * from "./verifier.js";
export * from "./settlement.js";
export * from "./trustedAgent.js";
export * as chain from "./chain.js";
export * as circleWallet from "./circleWallet.js";
export * as escrow from "./escrow.js";
export { ARC_TESTNET } from "./chain.js";
export type { NetworkConfig } from "./chain.js";
export type { CircleConfig } from "./circleWallet.js";
export type { WalletCredential, ContractTx, EscrowJob } from "./escrow.js";
