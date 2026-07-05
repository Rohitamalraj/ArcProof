"use client";

import { useEffect, useMemo, useState } from "react";

type Stage = "awaiting-signature" | "processing";

type Props = {
  isLoading: boolean;
  stage?: Stage;
};

// Every specialist and the evaluator is a real LLM tool-calling agent now
// (agent-ts), routinely slower than the old rule-based version -- these
// rough offsets are just a "something is happening" indicator, not a
// guarantee; the real backend timeout is 300s (see lib/constants.ts).
const STEPS = [
  { at: 0, text: "Verifying the on-chain budget lock..." },
  { at: 3, text: "Orchestrator's LLM planner picking specialists..." },
  { at: 8, text: "On-chain agent analyzing TVL, price, and wallet flows..." },
  { at: 20, text: "News agent scanning governance and incidents..." },
  { at: 32, text: "Compliance agent checking sanctions..." },
  { at: 45, text: "Evaluator independently re-deriving every claim..." },
  { at: 65, text: "Settlement releasing per-specialist payouts on-chain..." },
];

export function LoadingTimeline({ isLoading, stage = "processing" }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const timing = isLoading && stage === "processing";

  useEffect(() => {
    if (!timing) {
      return;
    }

    const start = Date.now();
    const bootstrapId = setTimeout(() => {
      setElapsed(0);
    }, 0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);

    return () => {
      clearTimeout(bootstrapId);
      clearInterval(id);
    };
  }, [timing]);

  const activeIndex = useMemo(() => {
    let idx = 0;
    for (let i = 0; i < STEPS.length; i += 1) {
      if (elapsed >= STEPS[i].at) {
        idx = i;
      }
    }
    return idx;
  }, [elapsed]);

  if (!isLoading) {
    return null;
  }

  if (stage === "awaiting-signature") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-[#5eead4]/30 bg-[#5eead4]/10 p-4 backdrop-blur-xl">
        <span className="inline-flex h-8 w-8 shrink-0 animate-spin items-center justify-center rounded-full border-2 border-[#5eead4]/30 border-t-[#5eead4]" />
        <div>
          <p className="text-sm font-medium text-zinc-100">Waiting for wallet signature...</p>
          <p className="mt-0.5 text-xs text-zinc-400">Approve the transaction in your wallet to lock the budget in the VeriFiEscrow contract on Arc testnet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
      <p className="mb-3 text-sm font-medium text-zinc-300">Agents working... ({elapsed}s elapsed)</p>
      <div className="space-y-2">
        {STEPS.map((step, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <div key={step.text} className="flex items-center gap-3 text-sm">
              <span
                className={
                  done
                    ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-900/50 text-emerald-300"
                    : active
                    ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#5eead4]/15 text-[#5eead4]"
                    : "inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-zinc-500"
                }
              >
                {done ? "✓" : "⟳"}
              </span>
              <span className={done || active ? "text-zinc-200" : "text-zinc-500"}>{step.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
