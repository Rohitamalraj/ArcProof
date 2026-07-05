import Link from "next/link";

import { DocsCallout, DocsH1, DocsH2, DocsH3, DocsInlineCode, DocsLead, DocsP, DocsPre, DocsUl } from "@/components/docs/DocsTypography";

export default function ExamplesPage() {
  return (
    <div>
      <DocsH1>Worked Examples</DocsH1>
      <DocsLead>
        Two unrelated verticals, zero changes to <Link href="/docs/sdk" className="text-[#5eead4] hover:underline">@arcproof/sdk</Link>{" "}
        itself — the concrete proof this isn&apos;t locked to DeFi.
      </DocsLead>

      <DocsH2 id="defi-diligence">defi-diligence-agent — the original vertical</DocsH2>
      <DocsP>
        The exact same specialists as the reference apps — <DocsInlineCode>onchain-agent-v1</DocsInlineCode> (TVL, price, wallet flow,
        holder concentration), <DocsInlineCode>news-agent-v1</DocsInlineCode> (governance, security incidents),{" "}
        <DocsInlineCode>compliance-agent-v1</DocsInlineCode> (OFAC sanctions) — the same tools, system prompts, 7 claim types, and
        deterministic verification rules. The only thing that changed is the plumbing: one process through{" "}
        <DocsInlineCode>VerifierRegistry</DocsInlineCode> + <DocsInlineCode>runTrustedJob</DocsInlineCode> instead of 5 Fastify
        microservices.
      </DocsP>
      <DocsPre title="bash">{`# Clean multi-specialist run -- orchestrator engages all 3 real specialists
npx tsx examples/defi-diligence-agent/src/index.ts uniswap "Assess Uniswap before treasury deployment."

# Fault injection -- the on-chain agent reports TVL at 1.5x real; the deterministic
# evaluator independently re-fetches from DefiLlama, catches the ~50% mismatch,
# cuts that specialist's payout to 50% (verdict PARTIAL)
npx tsx examples/defi-diligence-agent/src/index.ts uniswap "Assess Uniswap's on-chain health." "" onchain

# Compliance screening against the real OFAC-sanctioned Tornado Cash address
npx tsx examples/defi-diligence-agent/src/index.ts aave "Assess Aave and screen the counterparty." 0x8589427373d6d84e98730d7795d8f6f8731fda0

# The SAME specialists driven through @arcproof/sdk-elizaos's Action
npx tsx examples/defi-diligence-agent/src/elizaos-demo.ts uniswap "Assess Uniswap before treasury deployment."

# STANDALONE ElizaOS -- sdk + sdk-elizaos only, ZERO @arcproof/sdk-langchain
npx tsx examples/defi-diligence-agent/src/elizaos-native.ts uniswap "Assess Uniswap before treasury deployment."`}</DocsPre>

      <DocsH3>Verified live (real Arc testnet transactions)</DocsH3>
      <DocsUl>
        <li>
          <strong>Clean run</strong>: all 3 specialists engaged, every claim independently re-derived from live DefiLlama/CoinGecko/
          Snapshot/OFAC data, all matched → <DocsInlineCode>ACCEPT</DocsInlineCode>, budget split three ways, real transfers.
        </li>
        <li>
          <strong>Caught lie</strong>: fabricated TVL (1.5x real, delta 50%) correctly flagged <DocsInlineCode>mismatch</DocsInlineCode>{" "}
          while the specialist&apos;s other 3 honest claims still matched → payout cut to 50% →{" "}
          <DocsInlineCode>PARTIAL</DocsInlineCode>.
        </li>
        <li>
          <strong>Refund safety-net</strong>: when every specialist&apos;s LLM call failed (provider quota), zero checkable claims →
          automatic on-chain refund of the full locked budget, no funds stranded.
        </li>
        <li>
          <strong>ElizaOS parity</strong>: the same specialists driven through a real <DocsInlineCode>ElizaAction.handler</DocsInlineCode>{" "}
          produce the same settlement and a natural-language reply.
        </li>
      </DocsUl>

      <DocsH2 id="lending-apr">lending-apr-agent — a completely different vertical</DocsH2>
      <DocsP>
        A lending platform&apos;s &quot;true APR&quot; and borrower-eligibility diligence network — new claim types (
        <DocsInlineCode>apr_rate</DocsInlineCode>, <DocsInlineCode>processing_fee</DocsInlineCode>,{" "}
        <DocsInlineCode>documentation_charge</DocsInlineCode>, <DocsInlineCode>borrower_eligibility_flag</DocsInlineCode>), a new mock
        data source, zero shared code with the reference app&apos;s DeFi vertical. Two specialists sit behind an orchestrator that
        decides per request which apply: ask a pure APR question and only the APR agent gets engaged and paid; ask about eligibility too
        and both do.
      </DocsP>
      <DocsPre title="bash">{`# Pure APR question -- orchestrator engages only lending-apr-agent-v1
npx tsx examples/lending-apr-agent/src/index.ts loan-001 "What is the true APR? Discover the total cost including interest, processing fees, and documentation charges."

# Eligibility + APR question -- orchestrator engages both specialists
npx tsx examples/lending-apr-agent/src/index.ts loan-003 "Is this borrower eligible for this loan given their region, and what's the true APR including all fees?"

# Fault injection -- the APR agent reports the marketed rate as if it were the true APR
npx tsx examples/lending-apr-agent/src/index.ts loan-002 "" --inject-fault

# The SAME specialists/verifiers, composed through @arcproof/sdk-elizaos instead of
# called directly -- proves the two adapters are interchangeable, not two products
npx tsx examples/lending-apr-agent/src/elizaos-demo.ts`}</DocsPre>

      <DocsCallout>
        <DocsInlineCode>shared.ts</DocsInlineCode> — the two specialists, the orchestrator&apos;s specialist descriptions, and every{" "}
        <DocsInlineCode>VerifierRegistry</DocsInlineCode> entry — is used unchanged by both the LangChain-direct entrypoint and the
        ElizaOS entrypoint. Only how a request comes in and how the answer goes out differs; the orchestration, verification, and
        settlement logic underneath is identical.
      </DocsCallout>

      <DocsH2 id="run-locally">Running these yourself</DocsH2>
      <DocsP>
        Both examples deploy a fresh <DocsInlineCode>VeriFiEscrow</DocsInlineCode> instance per run, so they never interfere with the
        reference app or each other. From <DocsInlineCode>agent-ts/</DocsInlineCode>, with <DocsInlineCode>.env</DocsInlineCode> already
        set up:
      </DocsP>
      <DocsPre title="bash">{`cd agent-ts
npm install
npx tsx examples/defi-diligence-agent/src/index.ts uniswap "Assess Uniswap before treasury deployment."`}</DocsPre>
    </div>
  );
}
