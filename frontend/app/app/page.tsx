"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppBackground } from "@/components/AppBackground";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { JobHistoryList, pushHistory, readHistory } from "@/components/JobHistoryList";
import { JobResultPanel } from "@/components/JobResultPanel";
import { LoadingTimeline } from "@/components/LoadingTimeline";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { getConfig, getJob, submitJob } from "@/lib/api";
import { TEMPLATE_LABELS } from "@/lib/constants";
import { fmtUsdc } from "@/lib/format";
import { sendBudgetPayment, WalletError } from "@/lib/wallet";
import { useWalletStore } from "@/lib/walletStore";
import type { JobRequest, JobResponse } from "@/lib/types";

const DEFAULT_FORM: JobRequest = {
  protocol_slug: "aave",
  request_text: "Assess Aave before treasury deployment.",
  template: "protocol_treasury_diligence",
  budget_usdc: 0.1,
};

export default function AppPage() {
  const queryClient = useQueryClient();
  const wallet = useWalletStore();
  const configQuery = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: 60000 });
  const [form, setForm] = useState<JobRequest>(DEFAULT_FORM);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [timedOut, setTimedOut] = useState(false);
  const [paymentStage, setPaymentStage] = useState<"idle" | "awaiting-signature" | "processing">("idle");
  const [lastKnownJobId, setLastKnownJobId] = useState<string>(() => readHistory()[0]?.job_id || "");

  const submitMutation = useMutation({
    mutationFn: submitJob,
    onSuccess: (data) => {
      setJob(data);
      setLastKnownJobId(data.job_id);
      pushHistory({
        job_id: data.job_id,
        protocol_slug: data.protocol_slug,
        overall_verdict: data.overall_verdict,
        total_paid_usdc: data.total_paid_usdc,
        created_at: data.created_at,
      });
      queryClient.invalidateQueries({ queryKey: ["reputation"] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Request failed";
      if (msg.includes("timeout:")) {
        setTimedOut(true);
        setError(msg.replace("timeout: ", ""));
        return;
      }
      setError(msg);
    },
    onSettled: () => {
      setPaymentStage("idle");
      wallet.refreshBalance();
    },
  });

  const walletReady = wallet.status === "connected";
  const canSubmit =
    form.request_text.trim().length >= 10 &&
    form.protocol_slug.trim().length >= 2 &&
    walletReady &&
    Boolean(configQuery.data);
  const isBusy = paymentStage !== "idle" || submitMutation.isPending;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || isBusy) {
      return;
    }
    const config = configQuery.data;
    if (!config) {
      setError("Could not reach the orchestrator for network config. Is the backend running on :8000?");
      return;
    }

    setError("");
    setTimedOut(false);
    setPaymentStage("awaiting-signature");

    let txHash: string;
    try {
      txHash = await sendBudgetPayment(wallet.address, config.escrow_address, form.budget_usdc);
    } catch (err) {
      setPaymentStage("idle");
      const code = (err as { code?: number })?.code;
      if (code === 4001) {
        setError("Payment cancelled in wallet.");
      } else if (err instanceof WalletError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Payment failed.");
      }
      return;
    }

    setPaymentStage("processing");
    submitMutation.mutate({ ...form, requester_wallet: wallet.address, payment_tx_hash: txHash });
  };

  const statusCheckLabel = useMemo(() => {
    if (!lastKnownJobId) {
      return "Check Status";
    }
    return `Check Status (${lastKnownJobId})`;
  }, [lastKnownJobId]);

  const checkStatus = async () => {
    if (!lastKnownJobId) {
      setError("No known job ID to check yet.");
      return;
    }
    try {
      setError("");
      const latest = await getJob(lastKnownJobId);
      setJob(latest);
      setTimedOut(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status check failed");
    }
  };

  return (
    <ErrorBoundary>
      <main className="relative min-h-screen px-6 py-10 text-zinc-100">
        <AppBackground />
        <div className="relative z-10 mx-auto max-w-6xl space-y-8">
          <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-xl shadow-black/20 backdrop-blur-xl">
            <div>
              <h1 className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-2xl font-semibold text-transparent">VeriFi Agents</h1>
              <p className="mt-1 text-sm text-zinc-400">AI specialists verify claims. Payment releases only on match.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Arc Testnet
              </span>
              <WalletConnectButton />
            </div>
          </header>

          <section className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl ring-1 ring-white/[0.03]">
            <h2 className="text-xl font-semibold">Protocol Diligence</h2>
            <p className="mt-1 text-sm text-zinc-400">Submit a protocol request for multi-agent verification and conditional settlement.</p>

            {!walletReady ? (
              <div className="mt-4 rounded-xl border border-violet-800/40 bg-violet-950/20 p-3 text-xs text-violet-200">
                {wallet.status === "wrong_network"
                  ? "Switch your wallet to Arc Testnet (top right) before submitting a job."
                  : "Connect a wallet (top right) to pay the job budget and submit a diligence request."}
              </div>
            ) : null}

            <form className="mt-6 space-y-5" onSubmit={submit}>
              <div className="space-y-2">
                <label htmlFor="protocol_slug" className="text-sm font-medium text-zinc-300">
                  Protocol Slug
                </label>
                <input
                  id="protocol_slug"
                  value={form.protocol_slug}
                  onChange={(e) => setForm((prev) => ({ ...prev, protocol_slug: e.target.value.trim().toLowerCase() }))}
                  placeholder="e.g. aave, uniswap, compound"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring"
                  required
                />
                <p className="text-xs text-zinc-500">DefiLlama slug - lowercase, no spaces.</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="request_text" className="text-sm font-medium text-zinc-300">
                  Diligence Request
                </label>
                <textarea
                  id="request_text"
                  value={form.request_text}
                  onChange={(e) => setForm((prev) => ({ ...prev, request_text: e.target.value }))}
                  placeholder="e.g. Assess Aave before treasury deployment."
                  rows={3}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring"
                  minLength={10}
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="template" className="text-sm font-medium text-zinc-300">
                  Job Template
                </label>
                <select
                  id="template"
                  value={form.template}
                  onChange={(e) => setForm((prev) => ({ ...prev, template: e.target.value }))}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none ring-violet-500/50 focus:ring"
                >
                  {Object.entries(TEMPLATE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="budget" className="text-sm font-medium text-zinc-300">
                    Budget
                  </label>
                  <span className="font-mono text-sm text-zinc-200">{fmtUsdc(form.budget_usdc)} USDC</span>
                </div>
                <input
                  id="budget"
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={form.budget_usdc}
                  onChange={(e) => setForm((prev) => ({ ...prev, budget_usdc: Number(e.target.value) }))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-violet-500"
                />
              </div>

              {isBusy ? (
                <LoadingTimeline isLoading stage={paymentStage === "awaiting-signature" ? "awaiting-signature" : "processing"} />
              ) : (
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-950/50 hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-900/40 disabled:text-zinc-500 disabled:shadow-none"
                >
                  {walletReady ? `Pay ${fmtUsdc(form.budget_usdc)} USDC & Run Diligence →` : "Connect Wallet to Continue"}
                </button>
              )}

              {timedOut ? (
                <div className="rounded-xl border border-amber-800/50 bg-amber-950/25 p-4 text-sm text-amber-200">
                  <p>Agents are still working. This job may take a moment longer.</p>
                  <button
                    type="button"
                    onClick={checkStatus}
                    className="mt-3 rounded-lg border border-amber-700/60 px-3 py-1.5 text-xs hover:bg-amber-900/30"
                  >
                    {statusCheckLabel}
                  </button>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200">
                  <p>{error}</p>
                  {submitMutation.variables ? (
                    <button
                      type="button"
                      onClick={() => submitMutation.mutate(submitMutation.variables!)}
                      className="mt-3 rounded-lg border border-red-700/60 px-3 py-1.5 text-xs hover:bg-red-900/30"
                    >
                      Retry (same payment)
                    </button>
                  ) : null}
                </div>
              ) : null}
            </form>
          </section>

          {job ? (
            <section className="space-y-5">
              <JobResultPanel job={job} />
              <Link href="/reputation" className="inline-flex text-sm text-violet-300 hover:underline">
                View Agent Reputation →
              </Link>
              <JobHistoryList />
            </section>
          ) : null}
        </div>
      </main>
    </ErrorBoundary>
  );
}
