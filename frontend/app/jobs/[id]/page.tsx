"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ActivityLog } from "@/components/ActivityLog";
import { AgentScene3D } from "@/components/AgentScene3D";
import { AppBackground } from "@/components/AppBackground";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { JobResultPanel } from "@/components/JobResultPanel";
import { TransactionLedger } from "@/components/TransactionLedger";
import { getConfig, getJob, getJobLogs } from "@/lib/api";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = Array.isArray(params.id) ? params.id[0] : params.id;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    enabled: Boolean(jobId),
    refetchInterval: 30000,
  });

  const configQuery = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: 60000 });
  const logsQuery = useQuery({
    queryKey: ["job-logs", jobId],
    queryFn: () => getJobLogs(jobId),
    enabled: Boolean(jobId),
  });

  return (
    <ErrorBoundary>
      <main className="relative min-h-screen px-6 pb-10 pt-28 text-zinc-100">
        <AppBackground />
        <div className="relative z-10 mx-auto max-w-6xl space-y-5">
          <p className="font-mono text-xs text-zinc-500">Job ID: {jobId}</p>

          {isLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-300 backdrop-blur-xl">Loading job...</div>
          ) : null}

          {isError ? (
            <div className="rounded-xl border border-red-800/50 bg-red-950/30 p-5 text-sm text-red-200">
              <p>{error instanceof Error ? error.message : "Failed to load job."}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="rounded-lg border border-red-700/60 px-3 py-1.5 text-xs hover:bg-red-900/30"
                >
                  Retry
                </button>
                <Link href="/app" className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">
                  Back to app
                </Link>
              </div>
            </div>
          ) : null}

          {!isLoading && !isError && !data ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-400 backdrop-blur-xl">
              Job not found. <Link href="/app" className="text-[#5eead4] hover:underline">Return to new job</Link>.
            </div>
          ) : null}

          {data ? (
            <div className="space-y-5">
              <JobResultPanel job={data} explorerBaseUrl={configQuery.data?.arc_explorer_url ?? ""} />
              <div className="space-y-3">
                <h3 className="font-display text-xl text-zinc-100">Transaction Ledger</h3>
                <TransactionLedger job={data} explorerBaseUrl={configQuery.data?.arc_explorer_url ?? ""} />
              </div>
              {logsQuery.data?.length ? (
                <div className="grid gap-5 lg:grid-cols-[1fr_460px]">
                  <ActivityLog logs={logsQuery.data} title="Full Agent Activity Log" />
                  <AgentScene3D logs={logsQuery.data} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </main>
    </ErrorBoundary>
  );
}
