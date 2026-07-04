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
    // Defensive re-entrancy guard: MetaMask throws/rejects if
    // eth_requestAccounts is called again while a previous call from the
    // same origin hasn't resolved yet (surfaces as a generic "Failed to
    // connect" from the extension itself). The button already disables
    // itself while status === "connecting", but that's a UI-layer guard --
    // this makes connect() itself safe to call twice in a row regardless
    // of what triggers it (e.g. a click landing during a hydration-mismatch
    // tree regeneration).
    if (get().status === "connecting") {
      return;
    }
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
      // MetaMask (and other injected providers) throw plain Error-like
      // objects with their own real message (e.g. "Already processing
      // eth_requestAccounts", "User rejected the request") -- not just our
      // WalletError class. Surface whatever message is actually there
      // instead of collapsing every non-WalletError into one generic
      // string, so the user (and anyone debugging a report like this one)
      // can see what actually happened.
      const message =
        error instanceof WalletError
          ? error.message
          : error instanceof Error && error.message
          ? error.message
          : "Failed to connect wallet.";
      set({ status: "disconnected", error: message });
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
