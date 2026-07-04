/**
 * Real on-chain payment primitives against Arc testnet, ported from
 * agent/payments/chain.py.
 *
 * Arc's docs (docs.arc.io/arc/references/contract-addresses) are explicit
 * that USDC is the *native* gas-equivalent currency on Arc: "native gas
 * token uses 18 decimals; ERC-20 interface uses 6 decimals" and the ERC-20
 * address (0x3600...) is described as an "optional" view over that same
 * balance. That means moving USDC on Arc is a standard native-value
 * transfer -- sign it, broadcast it, wait for the receipt. No ERC-20
 * approve/transfer call, no token contract, and critically: no Circle
 * account or entity-secret registration needed to hold or move funds -- any
 * keypair generated locally works the moment it's funded via the public,
 * signup-free faucet at faucet.circle.com.
 *
 * RPC (https://rpc.testnet.arc.network) and chain id (5042002) are public
 * per docs.arc.io/arc/references/connect-to-arc -- no API key.
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
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ARC_RPC_URL, ARC_CHAIN_ID, ARC_EXPLORER_URL } from "./config.js";

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: "Arc Explorer", url: ARC_EXPLORER_URL } },
});

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });

export class OnChainTransferFailed extends Error {}

export interface OnChainTransfer {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountUsdc: number;
  blockNumber: number;
  explorerUrl: string;
}

export async function isConnected(): Promise<boolean> {
  try {
    await publicClient.getChainId();
    return true;
  } catch {
    return false;
  }
}

export function explorerLink(txHash: string): string {
  const normalized = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return `${ARC_EXPLORER_URL}/tx/${normalized}`;
}

/** Real, live balance read from Arc -- not cached, not tracked locally. */
export async function getBalanceUsdc(address: string): Promise<number> {
  const wei = await publicClient.getBalance({ address: getAddress(address) });
  return parseFloat(formatEther(wei));
}

/**
 * Sign and broadcast a real transaction on Arc testnet, then wait for it to
 * mine. Throws OnChainTransferFailed if the transaction reverts or times
 * out -- callers should not treat a payment as having happened until this
 * resolves, since a receipt with status "success" is the only real proof.
 */
export async function transfer(
  fromPrivateKey: string,
  toAddress: string,
  amountUsdc: number,
  memo = ""
): Promise<OnChainTransfer> {
  const account = privateKeyToAccount(fromPrivateKey as `0x${string}`);
  const toChecksum = getAddress(toAddress);
  const valueWei = parseEther(amountUsdc.toString());

  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC_URL) });

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
    amountUsdc,
    blockNumber: Number(receipt.blockNumber),
    explorerUrl: explorerLink(txHash),
  };

  if (receipt.status !== "success") {
    throw new OnChainTransferFailed(`transaction ${result.txHash} reverted on-chain`);
  }

  console.log(
    `[chain] ${account.address.slice(0, 10)}.. -> ${toChecksum.slice(0, 10)}.. : ` +
      `${amountUsdc.toFixed(6)} USDC | block ${result.blockNumber} | ${result.txHash} (${memo})`
  );
  return result;
}

/**
 * Independently re-derive a payment fact from the chain itself, rather than
 * trusting a caller's word for it -- same principle the evaluator applies
 * to specialist claims, applied here to payment claims.
 */
export async function verifyTransfer(
  txHash: string,
  expectedFrom: string,
  expectedTo: string,
  minAmountUsdc: number
): Promise<boolean> {
  try {
    const hash = (txHash.startsWith("0x") ? txHash : `0x${txHash}`) as Hash;
    const [receipt, tx] = await Promise.all([
      publicClient.getTransactionReceipt({ hash }),
      publicClient.getTransaction({ hash }),
    ]);
    if (!receipt || receipt.status !== "success") return false;
    if (tx.from.toLowerCase() !== expectedFrom.toLowerCase()) return false;
    if (!tx.to || tx.to.toLowerCase() !== expectedTo.toLowerCase()) return false;
    const amount = parseFloat(formatEther(tx.value));
    return amount + 1e-9 >= minAmountUsdc;
  } catch {
    return false;
  }
}

export type { Address };
