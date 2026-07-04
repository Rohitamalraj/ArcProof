import { create } from "zustand";
import type { Address } from "viem";

import { ARC_CHAIN_ID_HEX } from "@/lib/arc";
import {
  getChainIdHex,
  getNativeBalance,
  getProvider,
  requestAccounts,
  switchOrAddArcNetwork,
  WalletError,
} from "@/lib/wallet";

type WalletStatus = "disconnected" | "connecting" | "connected" | "wrong_network";

type WalletState = {
  status: WalletStatus;
  address: Address | "";
  chainId: string;
  balanceUsdc: number | null;
  error: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  _initListeners: () => void;
};

let listenersInitialized = false;

export const useWalletStore = create<WalletState>((set, get) => ({
  status: "disconnected",
  address: "",
  chainId: "",
  balanceUsdc: null,
  error: "",

  connect: async () => {
    set({ status: "connecting", error: "" });
    try {
      const address = await requestAccounts();
      const chainId = await getChainIdHex();

      if (chainId !== ARC_CHAIN_ID_HEX) {
        set({ status: "wrong_network", address, chainId, error: "" });
        return;
      }

      const balanceUsdc = await getNativeBalance(address);
      set({ status: "connected", address, chainId, balanceUsdc, error: "" });
      get()._initListeners();
    } catch (error) {
      set({
        status: "disconnected",
        error: error instanceof WalletError ? error.message : "Failed to connect wallet.",
      });
    }
  },

  disconnect: () => {
    set({ status: "disconnected", address: "", chainId: "", balanceUsdc: null, error: "" });
  },

  refreshBalance: async () => {
    const { address, status } = get();
    if (!address || status !== "connected") {
      return;
    }
    try {
      const balanceUsdc = await getNativeBalance(address);
      set({ balanceUsdc });
    } catch {
      // Silent -- a stale balance is better than surfacing a transient RPC blip.
    }
  },

  switchNetwork: async () => {
    set({ error: "" });
    try {
      await switchOrAddArcNetwork();
      const chainId = await getChainIdHex();
      const { address } = get();
      if (chainId === ARC_CHAIN_ID_HEX && address) {
        const balanceUsdc = await getNativeBalance(address);
        set({ status: "connected", chainId, balanceUsdc });
      } else {
        set({ chainId });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to switch network." });
    }
  },

  _initListeners: () => {
    if (listenersInitialized) {
      return;
    }
    const provider = getProvider();
    if (!provider) {
      return;
    }
    listenersInitialized = true;

    provider.on("accountsChanged", (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (!accounts || accounts.length === 0) {
        useWalletStore.getState().disconnect();
      } else {
        useWalletStore.setState({ address: accounts[0] as Address });
        useWalletStore.getState().refreshBalance();
      }
    });

    provider.on("chainChanged", (...args: unknown[]) => {
      const chainId = args[0] as string;
      const { address } = useWalletStore.getState();
      if (chainId === ARC_CHAIN_ID_HEX) {
        useWalletStore.setState({ status: "connected", chainId });
        if (address) {
          useWalletStore.getState().refreshBalance();
        }
      } else {
        useWalletStore.setState({ status: "wrong_network", chainId });
      }
    });
  },
}));
