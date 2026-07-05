import { AgentBadge } from "@/components/AgentBadge";
import { CLAIM_TYPE_COLORS } from "@/lib/constants";
import type { Claim } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  claims: Claim[];
};

const STATUS_STYLES: Record<Claim["verification_status"], string> = {
  match: "bg-emerald-900/50 text-emerald-200 border border-emerald-700/50",
  mismatch: "bg-red-900/50 text-red-200 border border-red-700/50",
  unverifiable: "bg-zinc-800 text-zinc-300 border border-zinc-700",
};

const STATUS_LABEL: Record<Claim["verification_status"], string> = {
  match: "✓ Match",
  mismatch: "✗ Mismatch",
  unverifiable: "- Unverifiable",
};

export function ClaimTable({ claims }: Props) {
  if (!claims.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-400 backdrop-blur-xl">
        No claims to display.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl">
      <table className="w-full table-fixed">
        <thead className="bg-zinc-900/40 text-left text-xs uppercase tracking-wide text-zinc-400">
          <tr>
            <th className="px-3 py-3">Agent</th>
            <th className="px-3 py-3">Claim Type</th>
            <th className="px-3 py-3">Claim</th>
            <th className="px-3 py-3">Verified By</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Delta</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {claims.map((claim) => {
            const deltaText =
              claim.verification_delta === null
                ? "-"
                : claim.verification_delta === 0
                ? "Δ 0%"
                : `${claim.verification_delta > 0 ? "+" : ""}${claim.verification_delta.toFixed(2)}%`;
            const isUrl = claim.verification_source.startsWith("https://");

            return (
              <tr key={claim.claim_id} className="border-t border-white/10 align-top">
                <td className="px-3 py-3 text-zinc-200">
                  <AgentBadge agentId={claim.provider_agent_id} />
                </td>
                <td className="px-3 py-3">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                      CLAIM_TYPE_COLORS[claim.claim_type] || "bg-zinc-800 text-zinc-300"
                    )}
                  >
                    {claim.claim_type}
                  </span>
                </td>
                <td className="px-3 py-3 text-zinc-100">
                  <p className="leading-relaxed">{claim.claim_text}</p>
                  {claim.simulated ? (
                    <span className="mt-1 inline-flex rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                      simulated
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-xs text-zinc-300">
                  {isUrl ? (
                    <a
                      href={claim.verification_source}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-[#5eead4] underline-offset-2 hover:underline"
                    >
                      {claim.verification_source}
                    </a>
                  ) : (
                    <span className="break-all text-zinc-400">{claim.verification_source || "-"}</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className={cn("inline-flex rounded-full px-2 py-1 text-xs", STATUS_STYLES[claim.verification_status])}>
                    {STATUS_LABEL[claim.verification_status]}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono text-xs text-zinc-400">{deltaText}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
