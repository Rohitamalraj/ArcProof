import { agentDisplayName, fmtUsdc } from "@/lib/format";
import type { JobResponse } from "@/lib/types";

type Row = {
  label: string;
  role: string;
  amount?: string;
  txHash: string;
};

type Props = {
  job: JobResponse;
  explorerBaseUrl: string;
};

/**
 * A permanent, complete ledger of every real on-chain transaction a job
 * touched -- the budget lock, each specialist's nanopayment, each
 * specialist's conditional settlement release (only present when they
 * were actually paid something), and the closing finalize/refund call.
 * Built from the job's own real tx-hash fields (JobRecord/ProviderPayout in
 * agent-ts's schema.ts), not the transient activity log -- this is meant to
 * stay accurate and linkable long after the job finished.
 */
export function TransactionLedger({ job, explorerBaseUrl }: Props) {
  const rows: Row[] = [];

  if (job.lock_tx_hash) {
    rows.push({ label: "Budget locked", role: "requester", amount: `${fmtUsdc(job.budget_usdc)} USDC`, txHash: job.lock_tx_hash });
  }

  for (const payout of job.payouts) {
    if (payout.nanopayment_tx_hash) {
      rows.push({
        label: "Nanopayment (responded)",
        role: agentDisplayName(payout.provider_agent_id),
        txHash: payout.nanopayment_tx_hash,
      });
    }
    if (payout.settlement_tx_hash) {
      rows.push({
        label: `Settlement release (${payout.outcome})`,
        role: agentDisplayName(payout.provider_agent_id),
        amount: `${fmtUsdc(payout.paid_usdc)} USDC`,
        txHash: payout.settlement_tx_hash,
      });
    }
  }

  if (job.finalize_tx_hash) {
    rows.push({ label: "Job finalized", role: "escrow contract", txHash: job.finalize_tx_hash });
  }
  if (job.refund_tx_hash) {
    rows.push({ label: "Refunded", role: "requester", amount: `${fmtUsdc(job.budget_usdc)} USDC`, txHash: job.refund_tx_hash });
  }

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-400 backdrop-blur-xl">
        No on-chain transactions recorded for this job.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl">
      <table className="w-full table-fixed">
        <thead className="bg-zinc-900/40 text-left text-xs uppercase tracking-wide text-zinc-400">
          <tr>
            <th className="px-3 py-3">Action</th>
            <th className="px-3 py-3">Role</th>
            <th className="px-3 py-3">Amount</th>
            <th className="px-3 py-3">Tx Hash</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-white/10">
              <td className="px-3 py-3 text-zinc-100">{row.label}</td>
              <td className="px-3 py-3 text-zinc-300">{row.role}</td>
              <td className="px-3 py-3 font-mono text-xs text-zinc-300">{row.amount || "-"}</td>
              <td className="px-3 py-3">
                <a
                  href={`${explorerBaseUrl}/tx/${row.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-xs text-[#5eead4] underline decoration-dotted underline-offset-2 hover:no-underline"
                >
                  {row.txHash.slice(0, 12)}...{row.txHash.slice(-8)} ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
