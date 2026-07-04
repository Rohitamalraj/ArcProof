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

const MEDIUM_FEE = { type: "level" as const, config: { feeLevel: "MEDIUM" as const } };

export class CircleWalletError extends Error {}

type CircleClient = ReturnType<
  typeof import("@circle-fin/developer-controlled-wallets").initiateDeveloperControlledWalletsClient
>;

const clientCache = new Map<string, CircleClient>();

async function client(config: CircleConfig): Promise<CircleClient> {
  if (!config.apiKey || !config.entitySecret) {
    throw new CircleWalletError("CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET required -- see README 'Circle Wallets setup'");
  }
  const cacheKey = config.apiKey;
  let c = clientCache.get(cacheKey);
  if (!c) {
    const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
    c = initiateDeveloperControlledWalletsClient({ apiKey: config.apiKey, entitySecret: config.entitySecret });
    clientCache.set(cacheKey, c);
  }
  return c;
}

export async function createWalletSet(config: CircleConfig, name: string): Promise<string> {
  const resp = await (await client(config)).createWalletSet({ name });
  const walletSetId = resp.data!.walletSet!.id;
  console.log(`[circle] created wallet set '${name}' -> ${walletSetId}`);
  return walletSetId;
}

export async function createWallet(
  config: CircleConfig,
  walletSetId: string,
  blockchain: Blockchain
): Promise<{ walletId: string; address: string }> {
  const resp = await (await client(config)).createWallets({ walletSetId, blockchains: [blockchain], count: 1 });
  const w = resp.data!.wallets![0];
  console.log(`[circle] created wallet ${w.id} -> ${w.address} on ${blockchain}`);
  return { walletId: w.id, address: w.address };
}

export async function getBalanceNative(config: CircleConfig, walletId: string): Promise<number> {
  const resp = await (await client(config)).getWalletTokenBalance({ id: walletId });
  const tokenBalances = resp.data?.tokenBalances || [];
  const native = tokenBalances.find((tb: any) => tb.token?.isNative);
  return native ? parseFloat(native.amount) : 0;
}

export interface CircleTxResult {
  txHash: string;
}

async function waitForTxHash(config: CircleConfig, transactionId: string): Promise<string> {
  const resp = await (await client(config)).getTransaction({ id: transactionId, waitForTxHash: true });
  const txHash = resp.data.transaction.txHash;
  if (!txHash) throw new CircleWalletError(`Circle transaction ${transactionId} resolved with no txHash`);
  return txHash;
}

/** Calls a contract function through a Circle-managed wallet, waits for it to mine. */
export async function executeContract(
  config: CircleConfig,
  walletId: string,
  contractAddress: string,
  abiFunctionSignature: string,
  abiParameters: (string | number | boolean)[],
  amountNative = 0
): Promise<CircleTxResult> {
  const resp = await (await client(config)).createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    amount: amountNative ? String(amountNative) : undefined,
    fee: MEDIUM_FEE,
  });
  const transactionId = resp.data!.id!;
  console.log(`[circle] submitted contract execution tx ${transactionId} (wallet ${walletId} -> ${contractAddress})`);
  const txHash = await waitForTxHash(config, transactionId);
  console.log(`[circle] tx ${transactionId} settled on-chain: ${txHash}`);
  return { txHash };
}

/** Simple native-value transfer through a Circle-managed wallet. */
export async function transfer(
  config: CircleConfig,
  walletId: string,
  destinationAddress: string,
  amountNative: number
): Promise<CircleTxResult> {
  const resp = await (await client(config)).createTransaction({
    walletId,
    destinationAddress,
    amount: [String(amountNative)],
    tokenAddress: "",
    fee: MEDIUM_FEE,
  });
  const transactionId = resp.data!.id!;
  console.log(`[circle] submitted transfer tx ${transactionId} (wallet ${walletId} -> ${destinationAddress})`);
  const txHash = await waitForTxHash(config, transactionId);
  console.log(`[circle] tx ${transactionId} settled on-chain: ${txHash}`);
  return { txHash };
}
