"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { AppBackground } from "@/components/AppBackground";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { JobResultPanel } from "@/components/JobResultPanel";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { getJob } from "@/lib/api";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = Array.isArray(params.id) ? params.id[0] : params.id;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    enabled: Boolean(jobId),
    refetchInterval: 30000,
  });

  return (
    <ErrorBoundary>
      <main className="relative min-h-screen px-6 py-10 text-zinc-100">
        <AppBackground />
        <div className="relative z-10 mx-auto max-w-6xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/app" className="inline-flex text-sm text-violet-300 hover:underline">
              ← New Job
            </Link>
            <WalletConnectButton />
          </div>

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
              Job not found. <Link href="/app" className="text-violet-300 hover:underline">Return to new job</Link>.
            </div>
          ) : null}

          {data ? <JobResultPanel job={data} /> : null}
        </div>
      </main>
    </ErrorBoundary>
  );
}
