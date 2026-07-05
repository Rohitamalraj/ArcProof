import Link from "next/link";

import { DocsCallout, DocsH1, DocsH2, DocsInlineCode, DocsLead, DocsLink, DocsP, DocsPre, DocsTable, DocsUl } from "@/components/docs/DocsTypography";

export default function DocsOverviewPage() {
  return (
    <div>
      <DocsH1>ArcProof SDK</DocsH1>
      <DocsLead>
        The trust layer for AI agents: make a claim, independently verify it against live data, release real on-chain payment only if it
        checks out. Bring your own agent — any framework, any vertical.
      </DocsLead>

      <DocsCallout>
        Extracted from ArcProof&apos;s own reference implementation (a DeFi protocol-diligence network) once that system was proven
        working end to end on Arc testnet — real Circle Wallets, a real deployed escrow contract, real x402-shaped payments. Everything
        DeFi-specific was left behind; what remains is domain-agnostic.
      </DocsCallout>

      <DocsH2 id="why">Why this exists</DocsH2>
      <DocsP>
        Payment rails (x402) and agent identity/reputation registries (ERC-8004-style) tell you money moved. They don&apos;t tell you the{" "}
        <em>work</em> was correct. This SDK is the missing verification step: a specialist agent drafts a claim, a deterministic verifier
        you write independently re-derives the same fact from a canonical source, and payment is a real, on-chain-enforced conditional
        release based on whether they agree.
      </DocsP>
      <DocsPre>{`lock budget --> gather claims (any agent) --> verify (your rules) --> release / refund
   (real tx)      (bring your own)          (deterministic,           (real tx, enforced
                                              zero LLM judgment)        by a smart contract)`}</DocsPre>

      <DocsH2 id="packages">Three packages</DocsH2>
      <DocsTable>
        <thead className="bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-400">
          <tr>
            <th className="px-4 py-3">Package</th>
            <th className="px-4 py-3">What it's for</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-white/10">
            <td className="px-4 py-3">
              <Link href="/docs/sdk" className="text-[#5eead4] hover:underline">
                @arcproof/sdk
              </Link>
            </td>
            <td className="px-4 py-3 text-zinc-300">
              The generalized core — <DocsInlineCode>VerifierRegistry</DocsInlineCode>, <DocsInlineCode>runTrustedJob()</DocsInlineCode>,
              escrow/chain/Circle wallet helpers. No framework dependency, no fixed vertical.
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-4 py-3">
              <Link href="/docs/sdk-langchain" className="text-[#5eead4] hover:underline">
                @arcproof/sdk-langchain
              </Link>
            </td>
            <td className="px-4 py-3 text-zinc-300">
              Wraps any LangChain.js tool-calling agent as a claim gatherer, plus an LLM-driven orchestrator that decides which
              specialists a request needs.
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-4 py-3">
              <Link href="/docs/sdk-elizaos" className="text-[#5eead4] hover:underline">
                @arcproof/sdk-elizaos
              </Link>
            </td>
            <td className="px-4 py-3 text-zinc-300">
              A real ElizaOS <DocsInlineCode>Action</DocsInlineCode>/<DocsInlineCode>Plugin</DocsInlineCode> — native orchestrator +
              specialist builders on <DocsInlineCode>runtime.useModel()</DocsInlineCode>, zero LangChain dependency required.
            </td>
          </tr>
        </tbody>
      </DocsTable>

      <DocsH2 id="whats-real">What&apos;s real, not simulated</DocsH2>
      <DocsUl>
        <li>
          <strong>Payments</strong> — real signed transactions on whatever EVM chain you point <DocsInlineCode>NetworkConfig</DocsInlineCode>{" "}
          at (defaults ship for Arc testnet, where USDC is the native gas-equivalent currency).
        </li>
        <li>
          <strong>Escrow</strong> — a real deployed smart contract enforces lock/release/finalize/refund on-chain; withheld funds simply
          never leave the contract, not an application-level promise.
        </li>
        <li>
          <strong>Circle Developer-Controlled Wallets</strong> — pass a <DocsInlineCode>{"{ kind: \"circle\", walletId, circleConfig }"}</DocsInlineCode>{" "}
          credential anywhere a wallet is expected instead of a plain private key.
        </li>
        <li>
          <strong>Verification</strong> — whatever your <DocsInlineCode>Verifier</DocsInlineCode> functions do. The SDK never calls an LLM
          anywhere in the verification path — that&apos;s the entire point.
        </li>
      </DocsUl>

      <DocsH2 id="proven">Proven vertical-agnostic</DocsH2>
      <DocsP>
        Two unrelated, live-verified examples reuse the identical <DocsInlineCode>@arcproof/sdk</DocsInlineCode> core with zero changes to
        the package itself:{" "}
        <Link href="/docs/examples" className="text-[#5eead4] hover:underline">
          defi-diligence-agent and lending-apr-agent
        </Link>
        .
      </DocsP>

      <DocsP>
        Ready to start? Head to the <Link href="/docs/quickstart" className="text-[#5eead4] hover:underline">Quickstart</Link>, or read{" "}
        <Link href="/docs/core-concepts" className="text-[#5eead4] hover:underline">Core Concepts</Link> first for the mental model.
      </DocsP>

      <DocsP>
        Source: <DocsLink href="https://github.com/Rohitamalraj/ArcProof">github.com/Rohitamalraj/ArcProof</DocsLink>
      </DocsP>
    </div>
  );
}
