"use client";

import type { JobLogEntry } from "@/lib/types";

const LEVEL_STYLES: Record<JobLogEntry["level"], string> = {
  info: "text-zinc-400",
  success: "text-[#5eead4]",
  warn: "text-amber-300",
  error: "text-red-300",
};

const LEVEL_PREFIX: Record<JobLogEntry["level"], string> = {
  info: "·",
  success: "✓",
  warn: "!",
  error: "✗",
};

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
  } catch {
    return "";
  }
}

type Props = {
  logs: JobLogEntry[];
  live?: boolean;
  title?: string;
};

/**
 * Renders the orchestrator's real, per-job activity log -- every specialist
 * call, every real Arc testnet transaction (nanopayments, lock, per-specialist
 * release, finalize/refund), and every evaluator verdict, each with a
 * clickable explorer link when a real tx hash is attached. This is not a
 * simulated/estimated progress bar: while `live` is true the entries come
 * from polling GET /jobs/:id/logs (see app/app/page.tsx), and after
 * completion the same entries stay visible as a permanent audit trail.
 */
export function ActivityLog({ logs, live, title = "Agent Activity Log" }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{title}</span>
        {live ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#5eead4]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5eead4] shadow-[0_0_6px_2px_rgba(94,234,212,0.4)]" />
            live
          </span>
        ) : (
          <span className="font-mono text-[11px] text-zinc-600">{logs.length} event{logs.length === 1 ? "" : "s"}</span>
        )}
      </div>
      <div className="max-h-96 space-y-1.5 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed">
        {logs.length ? (
          logs.map((entry, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="shrink-0 text-zinc-600">{fmtTime(entry.ts)}</span>
              <span className={`shrink-0 ${LEVEL_STYLES[entry.level]}`}>{LEVEL_PREFIX[entry.level]}</span>
              <span className={`${LEVEL_STYLES[entry.level]} break-words`}>
                {entry.message}
                {entry.txHash && entry.explorerUrl ? (
                  <>
                    {" "}
                    <a
                      href={entry.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-zinc-400 underline decoration-dotted underline-offset-2 hover:text-[#5eead4]"
                    >
                      {entry.txHash.slice(0, 10)}...{entry.txHash.slice(-6)} ↗
                    </a>
                  </>
                ) : null}
              </span>
            </div>
          ))
        ) : (
          <p className="text-zinc-600">{live ? "Waiting for the orchestrator to start..." : "No activity recorded for this job."}</p>
        )}
      </div>
    </div>
  );
}
