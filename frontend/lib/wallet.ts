// Thin wrapper around the browser's injected EIP-1193 provider
// (MetaMask, Rabby, Coinbase Wallet, etc). No wagmi/viem/ethers dependency
// -- Arc testnet only needs a native value transfer + a network add/switch,
// both plain JSON-RPC calls.
import { ARC_ADD_CHAIN_PARAMS, ARC_CHAIN_ID_HEX } from "@/lib/arc";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export class WalletError extends Error {}

export function getProvider(): EthereumProvider | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.ethereum || null;
}

export function hasInjectedWallet(): boolean {
  return getProvider() !== null;
}

export async function requestAccounts(): Promise<string> {
  const provider = getProvider();
  if (!provider) {
    throw new WalletError("No wallet found. Install MetaMask or another browser wallet to continue.");
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new WalletError("Wallet connection was rejected.");
  }
  return accounts[0];
}

export async function getChainId(): Promise<string> {
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
    // 4902: chain not added to the wallet yet.
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [ARC_ADD_CHAIN_PARAMS],
      });
    } else {
      throw error;
    }
  }
}

export async function getNativeBalance(address: string): Promise<number> {
  const provider = getProvider();
  if (!provider) {
    throw new WalletError("No wallet found.");
  }
  const hexWei = (await provider.request({
    method: "eth_getBalance",
    params: [address, "latest"],
  })) as string;
  return weiHexToUsdc(hexWei);
}

const WEI_PER_USDC = BigInt("1000000000000000000"); // 1e18, native token is 18 decimals
const WEI_PER_MICRO_USDC = BigInt("1000000000000"); // 1e18 / 1e6

function weiHexToUsdc(hexWei: string): number {
  const wei = BigInt(hexWei);
  const whole = wei / WEI_PER_USDC;
  const fraction = wei % WEI_PER_USDC;
  return Number(whole) + Number(fraction) / 1e18;
}

function usdcToWeiHex(amountUsdc: number): string {
  // Native token is 18 decimals; work in integer micro-units first to
  // avoid floating point drift on the amount before scaling up.
  const micros = BigInt(Math.round(amountUsdc * 1_000_000));
  const wei = micros * WEI_PER_MICRO_USDC;
  return `0x${wei.toString(16)}`;
}

/** Sends a real native-value transfer (matches how agent/payments/chain.py
 * reads tx.value -- must stay a plain value transfer, not an ERC-20 call). */
export async function sendBudgetPayment(from: string, to: string, amountUsdc: number): Promise<string> {
  const provider = getProvider();
  if (!provider) {
    throw new WalletError("No wallet found.");
  }
  const txHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to,
        value: usdcToWeiHex(amountUsdc),
      },
    ],
  })) as string;
  return txHash;
}
