"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HISTORY_KEY } from "@/lib/constants";
import { fmtDate, fmtUsdc } from "@/lib/format";
import type { JobHistoryItem } from "@/lib/types";

function verdictPill(verdict: JobHistoryItem["overall_verdict"]): string {
  if (verdict === "accept") {
    return "bg-emerald-900/40 text-emerald-300 border border-emerald-800/50";
  }
  if (verdict === "partial") {
    return "bg-amber-900/40 text-amber-300 border border-amber-800/50";
  }
  return "bg-red-900/40 text-red-300 border border-red-800/50";
}

export function readHistory(): JobHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(HISTORY_KEY);
  if (!raw) {
    return [];
  }
  try {
    const data = JSON.parse(raw) as JobHistoryItem[];
    if (!Array.isArray(data)) {
      return [];
    }
    return data;
  } catch {
    return [];
  }
}

export function pushHistory(item: JobHistoryItem): JobHistoryItem[] {
  const existing = readHistory().filter((entry) => entry.job_id !== item.job_id);
  const next = [item, ...existing].slice(0, 10);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }
  return next;
}

export function JobHistoryList() {
  const [rows, setRows] = useState<JobHistoryItem[]>(() => readHistory());

  const refresh = useCallback(() => {
    setRows(readHistory());
  }, []);

  useEffect(() => {
    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const topFive = useMemo(() => rows.slice(0, 5), [rows]);

  const clear = () => {
    window.localStorage.removeItem(HISTORY_KEY);
    setRows([]);
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-zinc-100">Recent Jobs</h3>
        <button
          type="button"
          onClick={clear}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Clear history
        </button>
      </div>

      {!topFive.length ? (
        <p className="text-sm text-zinc-400">No recent jobs yet.</p>
      ) : (
        <div className="space-y-2">
          {topFive.map((job) => (
            <div key={job.job_id} className="grid grid-cols-5 items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
              <p className="text-zinc-200">{job.protocol_slug}</p>
              <span className={`inline-flex w-fit rounded-full px-2 py-1 text-xs ${verdictPill(job.overall_verdict)}`}>
                {job.overall_verdict}
              </span>
              <p className="font-mono text-zinc-300">{fmtUsdc(job.total_paid_usdc, 2, 6)}</p>
              <p className="text-zinc-500">{fmtDate(job.created_at)}</p>
              <Link href={`/jobs/${job.job_id}`} className="text-right text-[#5eead4] hover:underline">
                View →
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
