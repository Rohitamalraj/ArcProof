import { cn } from "@/lib/utils";
import { fmtUsdc } from "@/lib/format";

type Props = {
  verdict: "accept" | "partial" | "reject";
  total_paid: number;
  agent_count: number;
};

const CONFIG = {
  accept: {
    label: "All Claims Verified - Full Payment Released",
    icon: "✓",
    classes: "border-emerald-800/50 bg-emerald-950/40 text-emerald-200",
  },
  partial: {
    label: "Partial Verification - Proportional Payment",
    icon: "⚠",
    classes: "border-amber-800/50 bg-amber-950/30 text-amber-200",
  },
  reject: {
    label: "Claims Failed - Payment Withheld",
    icon: "✗",
    classes: "border-red-800/50 bg-red-950/30 text-red-200",
  },
} as const;

export function VerdictBanner({ verdict, total_paid, agent_count }: Props) {
  const item = CONFIG[verdict];
  return (
    <div className={cn("rounded-2xl border p-4 shadow-lg shadow-black/20 backdrop-blur-xl", item.classes)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">
          {item.icon} {item.label}
        </p>
        <p className="font-mono text-sm text-white/90">
          Total paid: {fmtUsdc(total_paid, 2, 6)} USDC across {agent_count} specialists
        </p>
      </div>
    </div>
  );
}
