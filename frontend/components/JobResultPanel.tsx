import Link from "next/link";

import { ClaimTable } from "@/components/ClaimTable";
import { SettlementCards } from "@/components/SettlementCards";
import { VerdictBanner } from "@/components/VerdictBanner";
import { fmtDate, fmtUsdc, templateDisplayName } from "@/lib/format";
import type { JobResponse } from "@/lib/types";

type Props = {
  job: JobResponse;
};

export function JobResultPanel({ job }: Props) {
  return (
    <section className="space-y-6">
      <VerdictBanner verdict={job.overall_verdict} total_paid={job.total_paid_usdc} agent_count={job.payouts.length} />

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Research Memo</h3>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-zinc-200">{job.final_memo || "No memo returned."}</p>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-zinc-100">Per-Claim Verification</h3>
        <ClaimTable claims={job.claims} />
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-zinc-100">Settlement</h3>
        <SettlementCards payouts={job.payouts} claims={job.claims} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4 text-xs text-zinc-400">
        <p>
          Job ID: <span className="font-mono text-zinc-300">{job.job_id}</span> · Protocol: {job.protocol_slug} · Template: {templateDisplayName(job.template)} · Budget: {fmtUsdc(job.budget_usdc)} USDC · Created: {fmtDate(job.created_at)}
        </p>
        <Link href={`/jobs/${job.job_id}`} className="mt-2 inline-flex text-sm text-violet-300 hover:underline">
          Permalink →
        </Link>
      </div>
    </section>
  );
}
