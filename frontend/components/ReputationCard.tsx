import { agentDisplayName, fmtDate } from "@/lib/format";
import type { ReputationRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  agent_id: string;
  record: ReputationRecord;
};

function accuracyColor(score: number): string {
  if (score >= 0.9) {
    return "text-emerald-400";
  }
  if (score >= 0.7) {
    return "text-amber-400";
  }
  return "text-red-400";
}

export function ReputationCard({ agent_id, record }: Props) {
  const percentage = Math.max(0, Math.min(100, record.accuracy_score * 100));

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20 backdrop-blur-xl transition hover:border-white/20">
      <p className="text-sm text-zinc-400">{agentDisplayName(agent_id)}</p>
      <p className={cn("mt-2 text-3xl font-semibold", accuracyColor(record.accuracy_score))}>{percentage.toFixed(1)}%</p>

      <progress
        className="mt-3 h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-zinc-800 [&::-webkit-progress-value]:bg-violet-500 [&::-moz-progress-bar]:bg-violet-500"
        value={percentage}
        max={100}
      />

      {record.total_jobs === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">No jobs processed yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-zinc-500">Total Jobs</p>
            <p className="text-zinc-100">{record.total_jobs}</p>
          </div>
          <div>
            <p className="text-zinc-500">Verified Claims</p>
            <p className="text-emerald-300">{record.accepted_claims}</p>
          </div>
          <div>
            <p className="text-zinc-500">Failed Claims</p>
            <p className="text-red-300">{record.mismatched_claims}</p>
          </div>
          <div>
            <p className="text-zinc-500">Unverifiable</p>
            <p className="text-zinc-300">{record.unverifiable_claims}</p>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-500">Last updated: {fmtDate(record.last_updated)}</p>
    </div>
  );
}
