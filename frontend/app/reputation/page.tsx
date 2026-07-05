"use client";

import { useQuery } from "@tanstack/react-query";

import { AppBackground } from "@/components/AppBackground";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReputationCard } from "@/components/ReputationCard";
import { getReputation } from "@/lib/api";

export default function ReputationPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["reputation"],
    queryFn: getReputation,
    refetchInterval: 30000,
  });

  const entries = Object.entries(data || {});

  return (
    <ErrorBoundary>
      <main className="relative min-h-screen px-6 pb-10 pt-28 text-zinc-100">
        <AppBackground image="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Upscaled%20Image%20%2812%29-ng3RrNnsPMJ5CrtOjcPTmhHg01W11q.png" />
        <div className="relative z-10 mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="font-display text-4xl tracking-tight text-white">Agent Reputation</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Accuracy = verified claims ÷ (verified + failed). Unverifiable claims excluded.
            </p>
            {isFetching && !isLoading ? <p className="mt-2 text-xs text-zinc-500">Refreshing...</p> : null}
          </header>

          {isLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-300 backdrop-blur-xl">Loading reputation...</div>
          ) : null}

          {isError ? (
            <div className="rounded-xl border border-red-800/50 bg-red-950/30 p-5 text-sm text-red-200">
              <p>{error instanceof Error ? error.message : "Failed to load reputation."}</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-3 rounded-lg border border-red-700/60 px-3 py-1.5 text-xs hover:bg-red-900/30"
              >
                Retry
              </button>
            </div>
          ) : null}

          {!isLoading && !isError ? (
            entries.length ? (
              <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {entries.map(([agentId, record]) => (
                  <ReputationCard key={agentId} agent_id={agentId} record={record} />
                ))}
              </section>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-400 backdrop-blur-xl">
                No agents have processed jobs yet.
              </div>
            )
          ) : null}
        </div>
      </main>
    </ErrorBoundary>
  );
}
