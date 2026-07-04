"use client";

import { useQuery } from "@tanstack/react-query";

import { agentDisplayName } from "@/lib/format";
import { getWallets } from "@/lib/api";

export function WalletBalances() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["wallets"],
    queryFn: getWallets,
    refetchInterval: 15000,
  });

  if (isLoading || isError || !data) {
    return null;
  }

  const entries = Object.entries(data);
  if (!entries.length) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
      <p className="mb-3 text-xs uppercase tracking-wide text-zinc-500">Live Arc Testnet Balances</p>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {entries.map(([role, balance]) => (
          <div key={role} className="flex items-baseline gap-2">
            <span className="text-zinc-500">{agentDisplayName(role)}</span>
            <span className="font-mono text-zinc-200">{balance.toFixed(4)} USDC</span>
          </div>
        ))}
      </div>
    </div>
  );
}
