"use client";

import { useEffect, useMemo, useState } from "react";

type Stage = "awaiting-signature" | "processing";

type Props = {
  isLoading: boolean;
  stage?: Stage;
};

const STEPS = [
  { at: 0, text: "Locking budget on Arc testnet..." },
  { at: 3, text: "On-chain agent analyzing TVL and wallet flows..." },
  { at: 12, text: "News agent scanning incidents and governance..." },
  { at: 22, text: "Compliance agent checking sanctions..." },
  { at: 35, text: "Evaluator independently verifying all claims..." },
  { at: 55, text: "Settlement computing payout..." },
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
      <div className="flex items-center gap-3 rounded-xl border border-violet-800/40 bg-violet-950/20 p-4 backdrop-blur-xl">
        <span className="inline-flex h-8 w-8 shrink-0 animate-spin items-center justify-center rounded-full border-2 border-violet-500/30 border-t-violet-400" />
        <div>
          <p className="text-sm font-medium text-zinc-100">Waiting for wallet signature...</p>
          <p className="mt-0.5 text-xs text-zinc-400">Approve the payment request in your wallet to lock the budget in escrow on Arc testnet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
      <p className="mb-3 text-sm font-medium text-zinc-300">Agents working...</p>
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
                    ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-900/50 text-violet-300"
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
