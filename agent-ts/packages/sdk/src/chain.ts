/**
 * Real on-chain payment primitives against Arc testnet (or any EVM chain
 * you point it at). Adapted from agent-ts's core/src/chain.ts -- that
 * version is already fully generic (raw private keys/addresses/amounts in,
 * no role coupling), the only change here is taking network config as an
 * explicit parameter instead of importing a fixed .env-loaded module. A
 * published library shouldn't assume where or how its host app stores
 * config.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseEther,
  formatEther,
  getAddress,
  type Hash,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface NetworkConfig {
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
  /** Native currency symbol/decimals -- Arc's native token IS USDC at 18 decimals. */
  nativeCurrency?: { name: string; symbol: string; decimals: number };
}

export const ARC_TESTNET: NetworkConfig = {
  rpcUrl: "https://rpc.testnet.arc.network",
  chainId: 5042002,
  explorerUrl: "https://testnet.arcscan.app",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
};

export function chainFor(network: NetworkConfig): Chain {
  return defineChain({
    id: network.chainId,
    name: `chain-${network.chainId}`,
    nativeCurrency: network.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
    blockExplorers: { default: { name: "Explorer", url: network.explorerUrl } },
  });
}

export class OnChainTransferFailed extends Error {}

export interface OnChainTransfer {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountNative: number;
  blockNumber: number;
  explorerUrl: string;
}

export function explorerLink(network: NetworkConfig, txHash: string): string {
  const normalized = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return `${network.explorerUrl}/tx/${normalized}`;
}

export async function isConnected(network: NetworkConfig): Promise<boolean> {
  const client = createPublicClient({ chain: chainFor(network), transport: http(network.rpcUrl) });
  try {
    await client.getChainId();
    return true;
  } catch {
    return false;
  }
}

/** Real, live balance read -- not cached, not tracked locally. */
export async function getBalance(network: NetworkConfig, address: string): Promise<number> {
  const client = createPublicClient({ chain: chainFor(network), transport: http(network.rpcUrl) });
  const wei = await client.getBalance({ address: getAddress(address) });
  return parseFloat(formatEther(wei));
}

/**
 * Sign and broadcast a real transaction, then wait for it to mine. Throws
 * OnChainTransferFailed if the transaction reverts or times out --
 * callers should not treat a payment as having happened until this
 * resolves, since a receipt with status "success" is the only real proof.
 */
export async function transfer(
  network: NetworkConfig,
  fromPrivateKey: string,
  toAddress: string,
  amountNative: number,
  memo = ""
): Promise<OnChainTransfer> {
  const chain = chainFor(network);
  const account = privateKeyToAccount(fromPrivateKey as `0x${string}`);
  const toChecksum = getAddress(toAddress);
  const valueWei = parseEther(amountNative.toString());

  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });

  let txHash: Hash;
  try {
    txHash = await walletClient.sendTransaction({ to: toChecksum, value: valueWei });
  } catch (e) {
    throw new OnChainTransferFailed(`failed to broadcast transfer: ${e}`);
  }

  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
  } catch (e) {
    throw new OnChainTransferFailed(`transaction ${txHash} did not confirm: ${e}`);
  }

  const result: OnChainTransfer = {
    txHash,
    fromAddress: account.address,
    toAddress: toChecksum,
    amountNative,
    blockNumber: Number(receipt.blockNumber),
    explorerUrl: explorerLink(network, txHash),
  };

  if (receipt.status !== "success") {
    throw new OnChainTransferFailed(`transaction ${result.txHash} reverted on-chain`);
  }

  console.log(
    `[chain] ${account.address.slice(0, 10)}.. -> ${toChecksum.slice(0, 10)}.. : ` +
      `${amountNative.toFixed(6)} | block ${result.blockNumber} | ${result.txHash} (${memo})`
  );
  return result;
}

/**
 * Independently re-derive a payment fact from the chain itself, rather
 * than trusting a caller's word for it -- the same "don't trust the
 * claim, re-derive it" principle this SDK applies to agent claims,
 * applied here to payment claims.
 */
export async function verifyTransfer(
  network: NetworkConfig,
  txHash: string,
  expectedFrom: string,
  expectedTo: string,
  minAmountNative: number
): Promise<boolean> {
  const client = createPublicClient({ chain: chainFor(network), transport: http(network.rpcUrl) });
  try {
    const hash = (txHash.startsWith("0x") ? txHash : `0x${txHash}`) as Hash;
    const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
    if (!receipt || receipt.status !== "success") return false;
    if (tx.from.toLowerCase() !== expectedFrom.toLowerCase()) return false;
    if (!tx.to || tx.to.toLowerCase() !== expectedTo.toLowerCase()) return false;
    const amount = parseFloat(formatEther(tx.value));
    return amount + 1e-9 >= minAmountNative;
  } catch {
    return false;
  }
}
