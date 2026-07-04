/**
 * Real Circle Developer-Controlled Wallets integration
 * (@circle-fin/developer-controlled-wallets, Circle's own Node SDK) --
 * creates real wallets via Circle's API on Arc testnet (blockchain id
 * "ARC-TESTNET" -- Circle built Arc, so their own wallets product targets
 * it directly) and signs real transactions through Circle's infrastructure
 * instead of a raw private key.
 *
 * Deliberate change from the Python version (agent/payments/circle_wallet.py):
 * that module only ever wired the `requester` role's escrow-lock call
 * through a real Circle wallet, off by default and undocumented. Here,
 * EVERY role (requester, orchestrator, and all 3 specialists) can be
 * Circle-backed independently -- see config.ts's CIRCLE_WALLETS map, keyed
 * by CIRCLE_WALLET_ID_<ROLE> env vars, documented in this package's README
 * from the start. Any role left unconfigured falls back to its plain
 * viem-generated private key (see wallet.ts / escrowContract.ts).
 *
 * One-time setup (see agent-ts/README.md "Circle Wallets setup"):
 *   1. generateEntitySecret() locally, once.
 *   2. registerEntitySecretCiphertext({apiKey, entitySecret}) to bind it to
 *      CIRCLE_API_KEY. Both steps are semi-irreversible per-account actions.
 *   3. Create one wallet set + one wallet per role you want Circle-backed,
 *      save each wallet's id/address into CIRCLE_WALLET_ID_<ROLE> /
 *      CIRCLE_ADDRESS_<ROLE> in .env (see scripts/circle-setup.ts).
 *
 * Note on the dynamic import below: a static
 * `import { initiateDeveloperControlledWalletsClient } from "..."` fails at
 * runtime under tsx specifically (`does not provide an export named ...`),
 * even though the package's ESM build genuinely exports it (confirmed by
 * inspecting dist/developer-controlled-wallets.es.js directly, and by a
 * plain `node -e "import(...)"` repro working fine) -- a tsx loader-hook
 * resolution quirk with this package's multi-condition `exports` map, not a
 * real missing export. A lazy `await import(...)` inside client() sidesteps
 * it (verified working under tsx too) and has the side benefit of never
 * loading the Circle SDK at all for roles that don't use it.
 */
import type { Blockchain } from "@circle-fin/developer-controlled-wallets";

import { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, ARC_EXPLORER_URL } from "./config.js";

export const CIRCLE_BLOCKCHAIN = "ARC-TESTNET" as Blockchain;

// FeeLevel "MEDIUM" wrapped in the SDK's discriminated-union fee shape --
// verified against the installed package's type defs
// (node_modules/@circle-fin/developer-controlled-wallets/dist/types/clients/core.d.ts's
// FeeConfiguration<TFeeLevel>) rather than guessed from the Python SDK's
// flatter `fee_level=...` convention, which this Node SDK does not use.
const MEDIUM_FEE = { type: "level" as const, config: { feeLevel: "MEDIUM" as const } };

export class CircleWalletError extends Error {}

function requireConfig(): void {
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) {
    throw new CircleWalletError(
      "CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET not set in .env -- see agent-ts/README.md 'Circle Wallets setup'"
    );
  }
}

type CircleClient = ReturnType<
  typeof import("@circle-fin/developer-controlled-wallets").initiateDeveloperControlledWalletsClient
>;

let _client: CircleClient | null = null;
async function client(): Promise<CircleClient> {
  requireConfig();
  if (!_client) {
    const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
    _client = initiateDeveloperControlledWalletsClient({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
    });
  }
  return _client;
}

export async function createWalletSet(name: string): Promise<string> {
  const resp = await (await client()).createWalletSet({ name });
  const walletSetId = resp.data!.walletSet!.id;
  console.log(`[circle] created wallet set '${name}' -> ${walletSetId}`);
  return walletSetId;
}

export async function createWallet(walletSetId: string): Promise<{ walletId: string; address: string }> {
  const resp = await (await client()).createWallets({
    walletSetId,
    blockchains: [CIRCLE_BLOCKCHAIN],
    count: 1,
  });
  const w = resp.data!.wallets![0];
  console.log(`[circle] created wallet ${w.id} -> ${w.address} on ${CIRCLE_BLOCKCHAIN}`);
  return { walletId: w.id, address: w.address };
}

export async function getBalanceNative(walletId: string): Promise<number> {
  const resp = await (await client()).getWalletTokenBalance({ id: walletId });
  const tokenBalances = resp.data?.tokenBalances || [];
  const native = tokenBalances.find((tb: any) => tb.token?.isNative);
  return native ? parseFloat(native.amount) : 0;
}

/**
 * Uses the SDK's own built-in polling (`waitForTxHash: true`) rather than a
 * hand-rolled loop -- verified against the installed package's type defs
 * that `getTransaction` supports this directly.
 */
async function waitForTxHash(transactionId: string): Promise<string> {
  const resp = await (await client()).getTransaction({ id: transactionId, waitForTxHash: true });
  const txHash = resp.data.transaction.txHash;
  if (!txHash) throw new CircleWalletError(`Circle transaction ${transactionId} resolved with no txHash`);
  return txHash;
}

export interface CircleTxResult {
  txHash: string;
  explorerUrl: string;
}

/**
 * Calls a contract function through a Circle-managed wallet, waits for it
 * to mine, and returns {txHash, explorerUrl} -- same shape callers already
 * use from chain.ts's OnChainTransfer.
 */
export async function executeContract(
  walletId: string,
  contractAddress: string,
  abiFunctionSignature: string,
  abiParameters: (string | number | boolean)[],
  amountNative = 0
): Promise<CircleTxResult> {
  const resp = await (await client()).createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    amount: amountNative ? String(amountNative) : undefined,
    fee: MEDIUM_FEE,
  });
  const transactionId = resp.data!.id!;
  console.log(`[circle] submitted contract execution tx ${transactionId} (wallet ${walletId} -> ${contractAddress})`);
  const txHash = await waitForTxHash(transactionId);
  console.log(`[circle] tx ${transactionId} settled on-chain: ${txHash}`);
  return { txHash, explorerUrl: `${ARC_EXPLORER_URL}/tx/${txHash}` };
}

/**
 * Simple native-value transfer through a Circle-managed wallet.
 * `tokenAddress: ""` selects the chain's native currency (Arc's USDC) --
 * per the SDK's TokenAddressAndBlockchainInput doc comment: "Blockchain
 * address of the transferred token. Empty for native tokens."
 */
export async function transfer(
  walletId: string,
  destinationAddress: string,
  amountNative: number
): Promise<CircleTxResult> {
  const resp = await (await client()).createTransaction({
    walletId,
    destinationAddress,
    amount: [String(amountNative)],
    tokenAddress: "",
    fee: MEDIUM_FEE,
  });
  const transactionId = resp.data!.id!;
  console.log(`[circle] submitted transfer tx ${transactionId} (wallet ${walletId} -> ${destinationAddress})`);
  const txHash = await waitForTxHash(transactionId);
  console.log(`[circle] tx ${transactionId} settled on-chain: ${txHash}`);
  return { txHash, explorerUrl: `${ARC_EXPLORER_URL}/tx/${txHash}` };
}
