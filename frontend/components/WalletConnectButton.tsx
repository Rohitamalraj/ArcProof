"use client";

import { useEffect, useRef, useState } from "react";

import { ARC_ADD_CHAIN_PARAMS, ARC_CHAIN_ID, ARC_EXPLORER_URL, ARC_RPC_URL, explorerAddressUrl } from "@/lib/arc";
import { hasInjectedWallet } from "@/lib/wallet";
import { useWalletStore } from "@/lib/walletStore";

function truncate(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const MANUAL_FIELDS: [string, string][] = [
  ["Network name", ARC_ADD_CHAIN_PARAMS.chainName],
  ["RPC URL", ARC_RPC_URL],
  ["Chain ID", String(ARC_CHAIN_ID)],
  ["Currency symbol", ARC_ADD_CHAIN_PARAMS.nativeCurrency.symbol],
  ["Block explorer", ARC_EXPLORER_URL],
];

export function WalletConnectButton() {
  const { status, address, balanceUsdc, error, connect, disconnect, switchNetwork } = useWalletStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showManual, setShowManual] = useState(false);
  // hasInjectedWallet() depends on `window`, which doesn't exist during SSR --
  // calling it directly in the render body means the server always renders
  // "Install Wallet" while the client's first paint (browser extensions
  // inject window.ethereum before React even runs) can immediately see
  // "Connect Wallet" instead, a text mismatch React's hydration diff catches
  // and reports. Deferring the real check to an effect keeps the first
  // client render identical to the server's, then updates after mount --
  // no mismatch, just a one-frame flash of the SSR-safe default.
  const [walletDetected, setWalletDetected] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setWalletDetected(hasInjectedWallet());
  }, []);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (status === "connected") {
    return (
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-full border border-emerald-800/60 bg-emerald-950/50 px-3 py-1.5 text-xs font-medium text-emerald-300 backdrop-blur-md transition hover:border-emerald-700/70 hover:bg-emerald-950/70"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]" />
          {balanceUsdc !== null ? `${balanceUsdc.toFixed(4)} USDC` : "..."}
          <span className="text-emerald-500/70">|</span>
          <span className="font-mono">{truncate(address)}</span>
        </button>

        {menuOpen ? (
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-white/10 bg-[#13131a]/95 p-2 text-xs shadow-2xl backdrop-blur-xl">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">Arc Testnet</p>
            <button
              type="button"
              onClick={copyAddress}
              className="w-full rounded-lg px-2 py-2 text-left text-zinc-200 hover:bg-white/5"
            >
              {copied ? "Copied!" : "Copy address"}
            </button>
            <a
              href={explorerAddressUrl(address)}
              target="_blank"
              rel="noreferrer"
              className="block w-full rounded-lg px-2 py-2 text-left text-zinc-200 hover:bg-white/5"
            >
              View on Arcscan ↗
            </a>
            <button
              type="button"
              onClick={() => {
                disconnect();
                setMenuOpen(false);
              }}
              className="w-full rounded-lg px-2 py-2 text-left text-red-300 hover:bg-red-950/40"
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (status === "wrong_network") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={switchNetwork}
          className="inline-flex items-center gap-2 rounded-full border border-amber-800/60 bg-amber-950/50 px-3 py-1.5 text-xs font-medium text-amber-300 backdrop-blur-md transition hover:bg-amber-950/70"
        >
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          Switch to Arc Testnet
        </button>

        <div className="max-w-[260px] text-right text-[10px] text-amber-300/80">
          {error ? <p className="text-amber-300">{error}</p> : null}
          <button type="button" onClick={() => setShowManual((v) => !v)} className="underline">
            {showManual ? "Hide manual instructions" : "Wallet not responding? Add it manually"}
          </button>
        </div>

        {showManual ? (
          <div className="w-64 rounded-xl border border-white/10 bg-[#13131a]/95 p-3 text-left text-[10px] text-zinc-300 shadow-2xl backdrop-blur-xl">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">Add this network manually</p>
            {MANUAL_FIELDS.map(([label, value]) => (
              <div key={label} className="mb-1 flex flex-col">
                <span className="text-zinc-500">{label}</span>
                <span className="break-all font-mono text-zinc-200">{value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={connect}
        disabled={status === "connecting"}
        className="inline-flex items-center gap-2 rounded-full border border-violet-700/60 bg-violet-950/50 px-3 py-1.5 text-xs font-medium text-violet-200 backdrop-blur-md transition hover:bg-violet-900/60 disabled:cursor-wait disabled:opacity-70"
      >
        <span className="h-2 w-2 rounded-full bg-violet-400" />
        {status === "connecting" ? "Connecting..." : walletDetected ? "Connect Wallet" : "Install Wallet"}
      </button>
      {error ? <span className="max-w-[220px] text-right text-[10px] text-red-400">{error}</span> : null}
    </div>
  );
}
