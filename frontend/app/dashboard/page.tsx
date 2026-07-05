"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { AgentBadge } from "@/components/AgentBadge";
import { AppBackground } from "@/components/AppBackground";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReputationCard } from "@/components/ReputationCard";
import { WalletBalances } from "@/components/WalletBalances";
import { getJobs, getReputation } from "@/lib/api";
import { fmtDate, fmtUsdc, templateDisplayName } from "@/lib/format";
import type { JobResponse } from "@/lib/types";

function verdictPill(job: JobResponse): { label: string; classes: string } {
  if (job.status === "failed") {
    return { label: "refunded", classes: "bg-zinc-800 text-zinc-300 border border-zinc-700" };
  }
  if (job.overall_verdict === "accept") {
    return { label: "accept", classes: "bg-emerald-900/40 text-emerald-300 border border-emerald-800/50" };
  }
  if (job.overall_verdict === "partial") {
    return { label: "partial", classes: "bg-amber-900/40 text-amber-300 border border-amber-800/50" };
  }
  return { label: "reject", classes: "bg-red-900/40 text-red-300 border border-red-800/50" };
}

export default function DashboardPage() {
  const jobsQuery = useQuery({ queryKey: ["all-jobs"], queryFn: getJobs, refetchInterval: 30000 });
  const reputationQuery = useQuery({ queryKey: ["reputation"], queryFn: getReputation, refetchInterval: 30000 });

  const jobs = useMemo(() => {
    const list = jobsQuery.data ?? [];
    return [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [jobsQuery.data]);

  const stats = useMemo(() => {
    const totalJobs = jobs.length;
    const totalPaid = jobs.reduce((sum, j) => sum + j.total_paid_usdc, 0);
    const withVerdict = jobs.filter((j) => j.status !== "failed");
    const accepted = withVerdict.filter((j) => j.overall_verdict === "accept").length;
    const acceptRate = withVerdict.length ? (accepted / withVerdict.length) * 100 : 0;
    const refunded = jobs.filter((j) => j.status === "failed").length;
    return { totalJobs, totalPaid, acceptRate, refunded };
  }, [jobs]);

  const reputationEntries = Object.entries(reputationQuery.data || {});

  return (
    <ErrorBoundary>
      <main className="relative min-h-screen px-6 pb-10 pt-28 text-zinc-100">
        <AppBackground image="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/tree-uAia6REvB137CQyHFCf0za3O6h2zKO.png" />
        <div className="relative z-10 mx-auto max-w-6xl space-y-8">
          <header>
            <h1 className="font-display text-4xl tracking-tight text-white">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-400">Network-wide view: every specialist's accuracy, live wallet balances, and every job this orchestrator has processed.</p>
          </header>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Total Jobs</p>
              <p className="mt-2 font-mono text-3xl text-zinc-100">{jobsQuery.isLoading ? "..." : stats.totalJobs}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Total USDC Settled</p>
              <p className="mt-2 font-mono text-3xl text-[#5eead4]">{jobsQuery.isLoading ? "..." : fmtUsdc(stats.totalPaid)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Clean Accept Rate</p>
              <p className="mt-2 font-mono text-3xl text-zinc-100">{jobsQuery.isLoading ? "..." : `${stats.acceptRate.toFixed(0)}%`}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Refunded (no checkable claims)</p>
              <p className="mt-2 font-mono text-3xl text-zinc-100">{jobsQuery.isLoading ? "..." : stats.refunded}</p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl text-zinc-100">Live Wallet Balances</h2>
            <WalletBalances />
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl text-zinc-100">Agent Reputation</h2>
            {reputationQuery.isLoading ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-300 backdrop-blur-xl">Loading reputation...</div>
            ) : reputationEntries.length ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {reputationEntries.map(([agentId, record]) => (
                  <ReputationCard key={agentId} agent_id={agentId} record={record} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-400 backdrop-blur-xl">
                No agents have processed jobs yet.
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-zinc-100">All Jobs</h2>
              <button
                type="button"
                onClick={() => jobsQuery.refetch()}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
              >
                Refresh
              </button>
            </div>

            {jobsQuery.isLoading ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-300 backdrop-blur-xl">Loading jobs...</div>
            ) : jobsQuery.isError ? (
              <div className="rounded-xl border border-red-800/50 bg-red-950/30 p-5 text-sm text-red-200">Failed to load job history.</div>
            ) : !jobs.length ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-400 backdrop-blur-xl">
                No jobs processed yet. <Link href="/app" className="text-[#5eead4] hover:underline">Submit one →</Link>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl">
                <table className="w-full table-fixed">
                  <thead className="bg-zinc-900/40 text-left text-xs uppercase tracking-wide text-zinc-400">
                    <tr>
                      <th className="px-3 py-3">Protocol</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Specialists</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Paid</th>
                      <th className="px-3 py-3">Created</th>
                      <th className="px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {jobs.map((job) => {
                      const pill = verdictPill(job);
                      return (
                        <tr key={job.job_id} className="border-t border-white/10 align-top">
                          <td className="px-3 py-3 text-zinc-100">{job.protocol_slug}</td>
                          <td className="px-3 py-3 text-zinc-400">{templateDisplayName(job.template)}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                              {job.subtasks.map((s) => (
                                <AgentBadge key={s} agentId={s} className="text-xs text-zinc-300" />
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex rounded-full px-2 py-1 text-xs ${pill.classes}`}>{pill.label}</span>
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-zinc-300">{fmtUsdc(job.total_paid_usdc, 2, 6)}</td>
                          <td className="px-3 py-3 text-xs text-zinc-500">{fmtDate(job.created_at)}</td>
                          <td className="px-3 py-3 text-right">
                            <Link href={`/jobs/${job.job_id}`} className="text-[#5eead4] hover:underline">
                              View →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </ErrorBoundary>
  );
}
