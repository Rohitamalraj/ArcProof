import { DocsH1, DocsH2, DocsH3, DocsInlineCode, DocsLead, DocsP, DocsPre, DocsTable, DocsUl } from "@/components/docs/DocsTypography";

export default function CoreConceptsPage() {
  return (
    <div>
      <DocsH1>Core Concepts</DocsH1>
      <DocsLead>The five pieces every integration is built from, and why each one is shaped the way it is.</DocsLead>

      <DocsH2 id="claim">Claim</DocsH2>
      <DocsP>
        A claim is the atomic unit of work a specialist agent produces — one fact, drafted from a real tool call, never estimated.{" "}
        <DocsInlineCode>claim_type</DocsInlineCode> is a plain string you define, not a fixed enum, so the SDK isn&apos;t locked to any one
        vertical.
      </DocsP>
      <DocsPre title="Claim shape">{`{
  claim_id: string;
  job_id: string;
  provider_agent_id: string;
  claim_type: string;       // your own taxonomy -- "tvl", "apr_rate", whatever fits
  claim_text: string;       // human-readable
  claim_value: string;      // copied verbatim from a tool call, never estimated
  provider_source: string;  // where the specialist got it
  simulated: boolean;
  verification_status: "pending" | "match" | "mismatch" | "unverifiable";
  verification_source?: string;
  verification_value?: string;
  verification_delta?: number;
}`}</DocsPre>

      <DocsH2 id="verifier-registry">VerifierRegistry</DocsH2>
      <DocsP>
        The evaluator. You register one deterministic function per <DocsInlineCode>claim_type</DocsInlineCode> — given a claim and a
        context, independently re-derive the same fact and return a verdict. <strong>Zero LLM calls anywhere in this path</strong> — that&apos;s
        what keeps a verdict auditable rather than persuasive-sounding.
      </DocsP>
      <DocsUl>
        <li>
          <DocsInlineCode>.register(claimType, verifier)</DocsInlineCode> — wire up one claim type.
        </li>
        <li>
          <DocsInlineCode>.verifyClaims(claims, context)</DocsInlineCode> — runs every claim through its registered verifier.
        </li>
        <li>
          A claim type with <strong>no registered verifier</strong> becomes <DocsInlineCode>&quot;unverifiable&quot;</DocsInlineCode> — it
          never counts toward mismatches or payment, it just gets flagged.
        </li>
      </DocsUl>

      <DocsH2 id="wallet-credential">WalletCredential</DocsH2>
      <DocsP>Every function that signs a transaction takes one of these instead of a fixed role system:</DocsP>
      <DocsPre title="TypeScript">{`type WalletCredential =
  | { kind: "plain"; privateKey: string }
  | { kind: "circle"; walletId: string; circleConfig: { apiKey: string; entitySecret: string } };`}</DocsPre>
      <DocsP>
        Swap a plain key for a Circle-managed one anywhere — <DocsInlineCode>requester</DocsInlineCode>,{" "}
        <DocsInlineCode>settler</DocsInlineCode>, or a specialist&apos;s payout address — without changing any other code.
      </DocsP>

      <DocsH3>Settlement math</DocsH3>
      <DocsTable>
        <thead className="bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-400">
          <tr>
            <th className="px-4 py-3">Mismatches (that provider)</th>
            <th className="px-4 py-3">Payout</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-white/10">
            <td className="px-4 py-3 text-zinc-300">0</td>
            <td className="px-4 py-3 text-emerald-300">Full (100%)</td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-4 py-3 text-zinc-300">Exactly 1</td>
            <td className="px-4 py-3 text-amber-300">Partial (50%)</td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-4 py-3 text-zinc-300">2 or more</td>
            <td className="px-4 py-3 text-red-300">Withheld (0%)</td>
          </tr>
        </tbody>
      </DocsTable>
      <DocsP>
        Computed <strong>per provider</strong>, not per job — one specialist can be paid in full while another, in the exact same job, gets
        docked or withheld.
      </DocsP>

      <DocsH2 id="has-checkable-claims">hasCheckableClaims — the refund safety net</DocsH2>
      <DocsP>
        A job where every provider fails, or every claim comes back unverifiable, has zero mismatches by definition — which would
        naively compute as a clean &quot;accept&quot; and finalize the contract with the requester&apos;s budget silently withheld
        forever.{" "}
        <DocsInlineCode>hasCheckableClaims(claims)</DocsInlineCode> guards against exactly this; <DocsInlineCode>runTrustedJob</DocsInlineCode>{" "}
        checks it automatically and refunds instead of settling when it&apos;s false. This was a real bug found and fixed during ArcProof&apos;s
        own testing — not a hypothetical edge case.
      </DocsP>

      <DocsH2 id="run-trusted-job">runTrustedJob</DocsH2>
      <DocsP>The one high-level helper that ties everything above together:</DocsP>
      <DocsPre>{`lock (real tx) --> gatherClaims(context) --> verifiers.verifyClaims() --> hasCheckableClaims?
                                                                              |
                                                    yes -----------------------+----------------- no
                                                     |                                              |
                                              settle() per provider                        refund() full budget
                                          (real release/finalize tx)                         (real refund tx)`}</DocsPre>
    </div>
  );
}
