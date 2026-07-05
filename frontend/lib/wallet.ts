// Thin wrapper around the browser's injected EIP-1193 provider (MetaMask,
// Rabby, Coinbase Wallet, etc), using viem for ABI encoding / balance reads
// so this matches exactly how agent-ts's own backend (chain.ts,
// escrowContract.ts) talks to the same chain and the same contract.
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  formatEther,
  parseEther,
  keccak256,
  toBytes,
  type Address,
} from "viem";

import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_ADD_CHAIN_PARAMS, ARC_CHAIN_ID_HEX, ARC_EXPLORER_URL, VERIFI_ESCROW_LOCK_ABI } from "@/lib/arc";

const arcTestnet = {
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: "Arc Explorer", url: ARC_EXPLORER_URL } },
} as const;

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export class WalletError extends Error {}

/**
 * With more than one wallet extension installed (Coinbase Wallet, Rabby,
 * Phantom, etc. alongside MetaMask), `window.ethereum` is ambiguous --
 * extensions race to set it, so it can end up pointing at a different
 * wallet than the one the user actually meant to use, or at a merged
 * object whose .request() calls one extension's internals in a way that
 * extension doesn't expect. That mismatch is what was throwing "Failed to
 * connect to MetaMask" straight out of the MetaMask extension's own code
 * with no application stack frames involved.
 *
 * Multi-wallet extensions commonly populate window.ethereum.providers
 * with one entry per installed wallet (a pre-EIP-6963 convention several
 * wallets still follow) -- prefer the entry explicitly flagged
 * isMetaMask, so we always connect to the wallet this app is built
 * against instead of whichever extension won the race to install itself
 * as the default.
 */
export function getProvider(): EthereumProvider | null {
  if (typeof window === "undefined") {
    return null;
  }
  const eth = window.ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    return eth.providers.find((p) => p.isMetaMask) ?? eth.providers[0];
  }
  return eth;
}

export function hasInjectedWallet(): boolean {
  return getProvider() !== null;
}

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });

export async function requestAccounts(): Promise<Address> {
  const provider = getProvider();
  if (!provider) {
    throw new WalletError("No wallet found. Install MetaMask or another browser wallet to continue.");
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new WalletError("Wallet connection was rejected.");
  }
  return accounts[0] as Address;
}

/**
 * Read-only, non-prompting check for whether this site is already
 * authorized (MetaMask remembers per-origin authorization across page
 * loads/refreshes) -- unlike requestAccounts()/eth_requestAccounts, this
 * never shows a popup. Used to silently restore a "connected" state on
 * mount instead of making the user click Connect again after every refresh.
 */
export async function getAuthorizedAccounts(): Promise<Address | null> {
  const provider = getProvider();
  if (!provider) return null;
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  return accounts && accounts.length > 0 ? (accounts[0] as Address) : null;
}

export async function getChainIdHex(): Promise<string> {
  const provider = getProvider();
  if (!provider) {
    throw new WalletError("No wallet found.");
  }
  return (await provider.request({ method: "eth_chainId" })) as string;
}

export async function switchOrAddArcNetwork(): Promise<void> {
  const provider = getProvider();
  if (!provider) {
    throw new WalletError("No wallet found.");
  }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === 4902) {
      // Chain not added to the wallet yet.
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [ARC_ADD_CHAIN_PARAMS],
      });
    } else {
      throw error;
    }
  }
}

export async function getNativeBalance(address: Address): Promise<number> {
  const wei = await publicClient.getBalance({ address });
  return parseFloat(formatEther(wei));
}

/** Matches agent-ts orchestrator.ts's own job_id format
 * (`job_${randomUUID().replace(/-/g,"").slice(0,10)}`), so a job created by
 * a connected browser wallet looks identical to one the backend generated. */
export function generateJobId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `job_${hex}`;
}

/** Must match agent-ts's escrowContract.ts jobIdToBytes32() exactly
 * (keccak256 of the UTF-8 job_id string) -- the contract only ever sees
 * this hash, so both sides need to derive the identical value. */
export function jobIdToBytes32(jobId: string): `0x${string}` {
  return keccak256(toBytes(jobId));
}

/** Sends a real VeriFiEscrow.lock(bytes32) contract call from the
 * connected wallet, budget_usdc attached as native value (Arc's USDC is
 * the native gas-equivalent currency). Returns the real tx hash once it's
 * broadcast (not yet mined -- the backend independently re-reads the
 * contract's state before trusting this, same principle as x402). */
export async function lockBudget(fromAddress: Address, contractAddress: Address, jobId: string, amountUsdc: number): Promise<string> {
  const provider = getProvider();
  if (!provider) {
    throw new WalletError("No wallet found.");
  }
  const walletClient = createWalletClient({ account: fromAddress, chain: arcTestnet, transport: custom(provider) });
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: VERIFI_ESCROW_LOCK_ABI,
    functionName: "lock",
    args: [jobIdToBytes32(jobId)],
    value: parseEther(amountUsdc.toString()),
  });
  return txHash;
}

export async function waitForTransaction(txHash: `0x${string}`): Promise<void> {
  await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
}
