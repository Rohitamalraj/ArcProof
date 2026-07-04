import { agentDisplayName, fmtUsdc } from "@/lib/format";
import type { Claim, Payout } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  payouts: Payout[];
  claims?: Claim[];
};

const OUTCOME_CONFIG = {
  full: { label: "Full Payment", classes: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50" },
  partial: { label: "Partial Payment", classes: "bg-amber-900/40 text-amber-300 border-amber-800/50" },
  withheld: { label: "Withheld", classes: "bg-red-900/40 text-red-300 border-red-800/50" },
} as const;

export function SettlementCards({ payouts, claims = [] }: Props) {
  if (!payouts.length) {
    return <p className="text-sm text-zinc-400">No settlement data available.</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {payouts.map((payout) => {
        const config = OUTCOME_CONFIG[payout.outcome];
        const agentClaims = claims.filter((c) => c.provider_agent_id === payout.provider_agent_id);
        const allSimulated = agentClaims.length > 0 && agentClaims.every((c) => c.simulated);

        return (
          <div key={payout.provider_agent_id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-xl">
            <p className="text-sm text-zinc-400">{agentDisplayName(payout.provider_agent_id)}</p>
            <p className="mt-2 font-mono text-2xl text-zinc-100">{fmtUsdc(payout.paid_usdc, 6, 6)} USDC paid</p>
            <p className="mt-1 text-xs text-zinc-400">of {fmtUsdc(payout.allocated_usdc)} allocated</p>
            <span className={cn("mt-3 inline-flex rounded-full border px-2 py-1 text-xs", config.classes)}>{config.label}</span>
            <p className="mt-3 text-xs text-zinc-300">
              {payout.matches} match / {payout.mismatches} mismatch / {payout.unverifiable} unverifiable
            </p>
            {allSimulated ? <p className="mt-2 text-xs text-zinc-500">Note: some claims used simulated data</p> : null}
          </div>
        );
      })}
    </div>
  );
}
