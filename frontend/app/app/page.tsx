"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";

import { ActivityLog } from "@/components/ActivityLog";
import { AgentScene3D } from "@/components/AgentScene3D";
import { AppBackground } from "@/components/AppBackground";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { JobHistoryList, pushHistory, readHistory } from "@/components/JobHistoryList";
import { JobResultPanel } from "@/components/JobResultPanel";
import { LoadingTimeline } from "@/components/LoadingTimeline";
import { TransactionLedger } from "@/components/TransactionLedger";
import { WalletBalances } from "@/components/WalletBalances";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { getConfig, getJob, getJobLogs, submitJob } from "@/lib/api";
import { fmtUsdc } from "@/lib/format";
import { generateJobId, lockBudget, waitForTransaction, WalletError } from "@/lib/wallet";
import { useWalletStore } from "@/lib/walletStore";
import type { JobLogEntry, JobRequest, JobResponse } from "@/lib/types";

const CLEAN_DEMO_ADDRESS = "0x0000000000000000000000000000000000dead";
// Real, publicly-documented OFAC SDN address (Tornado Cash, designated
// 2022-08-08) -- offered so demoing the compliance-catch scene doesn't
// require finding a real sanctioned address yourself.
const SANCTIONED_DEMO_ADDRESS = "0x8589427373d6d84e98730d7795d8f6f8731fda0";

const DEFAULT_FORM: JobRequest = {
  protocol_slug: "uniswap",
  request_text: "Assess Uniswap before treasury deployment.",
  budget_usdc: 0.3,
  target_address: CLEAN_DEMO_ADDRESS,
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
  const [liveLogs, setLiveLogs] = useState<JobLogEntry[]>([]);
  const [pollingJobId, setPollingJobId] = useState<string>("");

  // The orchestrator's POST /jobs is one long synchronous call that only
  // resolves once the whole job is done -- this is the only way to see real
  // agent/transaction activity before that. job_id is already known
  // client-side (generateJobId() below runs before submission), so polling
  // can start the moment the request goes out.
  useEffect(() => {
    if (!pollingJobId) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const logs = await getJobLogs(pollingJobId);
      if (!cancelled && logs.length) {
        setLiveLogs(logs);
      }
    };
    poll();
    const id = setInterval(poll, 1200);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollingJobId]);

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
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
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
    onSettled: (_data, _error, variables) => {
      setPaymentStage("idle");
      setPollingJobId("");
      wallet.refreshBalance();
      // One last fetch past the job's own resolution -- guarantees the
      // permanent, post-completion log includes every entry (the
      // orchestrator writes its final "job complete"/refund lines
      // synchronously before returning the response), even if this landed
      // between two poll ticks.
      if (variables?.job_id) {
        getJobLogs(variables.job_id).then((logs) => {
          if (logs.length) setLiveLogs(logs);
        });
      }
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
    const cfg = configQuery.data;
    if (!cfg) {
      setError("Could not reach the orchestrator for network config. Is agent-ts running on :8000?");
      return;
    }

    setError("");
    setTimedOut(false);
    setLiveLogs([]);
    setPaymentStage("awaiting-signature");

    const jobId = generateJobId();
    let txHash: string;
    try {
      txHash = await lockBudget(wallet.address as Address, cfg.escrow_contract_address as Address, jobId, form.budget_usdc);
      await waitForTransaction(txHash as `0x${string}`);
    } catch (err) {
      setPaymentStage("idle");
      const code = (err as { code?: number })?.code;
      if (code === 4001) {
        setError("Transaction cancelled in wallet.");
      } else if (err instanceof WalletError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Locking the budget on-chain failed.");
      }
      return;
    }

    setPaymentStage("processing");
    setPollingJobId(jobId);
    submitMutation.mutate({ ...form, requester_wallet: wallet.address, job_id: jobId, payment_tx_hash: txHash });
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
      const logs = await getJobLogs(lastKnownJobId);
      if (logs.length) setLiveLogs(logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status check failed");
    }
  };

  return (
    <ErrorBoundary>
      <main className="relative min-h-screen px-6 pb-10 pt-28 text-zinc-100">
        <AppBackground video="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/bg-hero-0BnFGdr81Ifnj3WbBZoNt1KE4D5DMT.mp4" />
        <div className="relative z-10 mx-auto max-w-6xl space-y-8">
          <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-xl shadow-black/20 backdrop-blur-xl">
            <p className="text-sm text-zinc-400">AI specialists verify claims. Payment releases only on match.</p>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Arc Testnet
              </span>
              <WalletConnectButton />
            </div>
          </header>

          <WalletBalances />

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl ring-1 ring-white/[0.03]">
            <h2 className="font-display text-2xl tracking-tight">Protocol Diligence</h2>
            <p className="mt-1 text-sm text-zinc-400">Submit a protocol request for multi-agent verification and conditional settlement.</p>

            {!walletReady ? (
              <div className="mt-4 rounded-xl border border-[#5eead4]/30 bg-[#5eead4]/10 p-3 text-xs text-[#5eead4]">
                {wallet.status === "wrong_network"
                  ? "Switch your wallet to Arc Testnet (top right) before submitting a job."
                  : "Connect a wallet (top right) to sign the real on-chain budget lock and submit a diligence request."}
              </div>
            ) : null}

            <form className="mt-6 space-y-5" onSubmit={submit}>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="protocol_slug" className="text-sm font-medium text-zinc-300">
                    Protocol Slug
                  </label>
                  <input
                    id="protocol_slug"
                    value={form.protocol_slug}
                    onChange={(e) => setForm((prev) => ({ ...prev, protocol_slug: e.target.value.trim().toLowerCase() }))}
                    placeholder="e.g. aave, uniswap, compound"
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none ring-[#5eead4]/50 focus:ring"
                    required
                  />
                  <p className="text-xs text-zinc-500">DefiLlama slug - lowercase, no spaces.</p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="template" className="text-sm font-medium text-zinc-300">
                    Category label <span className="text-zinc-500">(optional)</span>
                  </label>
                  <input
                    id="template"
                    value={form.template || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, template: e.target.value || undefined }))}
                    placeholder="Leave blank to let the orchestrator's LLM infer one"
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none ring-[#5eead4]/50 focus:ring"
                  />
                </div>
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
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none ring-[#5eead4]/50 focus:ring"
                  minLength={10}
                  required
                />
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="target_address" className="text-sm font-medium text-zinc-300">
                    Compliance target address <span className="text-zinc-500">(optional)</span>
                  </label>
                  <input
                    id="target_address"
                    value={form.target_address || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, target_address: e.target.value || undefined }))}
                    placeholder={CLEAN_DEMO_ADDRESS}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs outline-none ring-[#5eead4]/50 focus:ring"
                  />
                  <p className="text-xs text-zinc-500">
                    Try the real OFAC-sanctioned demo address:{" "}
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, target_address: SANCTIONED_DEMO_ADDRESS }))}
                      className="font-mono text-[#5eead4] hover:underline"
                    >
                      {SANCTIONED_DEMO_ADDRESS}
                    </button>
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="inject_fault" className="text-sm font-medium text-zinc-300">
                    Inject a fault <span className="text-zinc-500">(demo only)</span>
                  </label>
                  <select
                    id="inject_fault"
                    value={form.inject_fault || ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        inject_fault: (e.target.value || undefined) as JobRequest["inject_fault"],
                      }))
                    }
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none ring-[#5eead4]/50 focus:ring"
                  >
                    <option value="">None - clean run</option>
                    <option value="onchain">On-chain agent lies about TVL</option>
                    <option value="news">News agent fabricates governance outcome</option>
                    <option value="compliance">Compliance agent lies about sanctions</option>
                  </select>
                  <p className="text-xs text-zinc-500">Forces that specialist to fabricate a claim so you can watch the evaluator catch it live.</p>
                </div>
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
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-[#5eead4]"
                />
              </div>

              {isBusy ? (
                paymentStage === "awaiting-signature" ? (
                  <LoadingTimeline isLoading />
                ) : (
                  <div className="rounded-xl border border-[#5eead4]/30 bg-[#5eead4]/10 p-3 text-xs text-[#5eead4]">
                    Agents are working -- live activity and the agent network are shown below.
                  </div>
                )
              ) : (
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background shadow-lg shadow-black/30 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:bg-foreground/20 disabled:text-muted-foreground disabled:shadow-none"
                >
                  {walletReady ? `Lock ${fmtUsdc(form.budget_usdc)} USDC & Run Diligence →` : "Connect Wallet to Continue"}
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
                <div className="space-y-3">
                  <div className="rounded-xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200">
                    <p>{error}</p>
                    {submitMutation.variables ? (
                      <button
                        type="button"
                        onClick={() => submitMutation.mutate(submitMutation.variables!)}
                        className="mt-3 rounded-lg border border-red-700/60 px-3 py-1.5 text-xs hover:bg-red-900/30"
                      >
                        Retry (same on-chain lock)
                      </button>
                    ) : null}
                  </div>
                  {!job && liveLogs.length ? (
                    <div className="grid gap-5 lg:grid-cols-[1fr_460px]">
                      <ActivityLog logs={liveLogs} title="What happened" />
                      <AgentScene3D logs={liveLogs} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </form>
          </section>

          {isBusy && paymentStage === "processing" ? (
            <section className="grid gap-5 lg:grid-cols-[1fr_460px]">
              <ActivityLog logs={liveLogs} live title="Agents working..." />
              <AgentScene3D logs={liveLogs} />
            </section>
          ) : null}

          {job ? (
            <section className="space-y-5">
              <JobResultPanel job={job} explorerBaseUrl={configQuery.data?.arc_explorer_url ?? ""} />
              <div className="space-y-3">
                <h3 className="font-display text-xl text-zinc-100">Transaction Ledger</h3>
                <TransactionLedger job={job} explorerBaseUrl={configQuery.data?.arc_explorer_url ?? ""} />
              </div>
              {liveLogs.length ? (
                <div className="grid gap-5 lg:grid-cols-[1fr_460px]">
                  <ActivityLog logs={liveLogs} title="Full Agent Activity Log" />
                  <AgentScene3D logs={liveLogs} />
                </div>
              ) : null}
              <Link href="/reputation" className="inline-flex text-sm text-[#5eead4] hover:underline">
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
