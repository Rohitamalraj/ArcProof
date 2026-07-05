import Link from "next/link";

import { DocsCallout, DocsH1, DocsH2, DocsH3, DocsInlineCode, DocsLead, DocsLink, DocsP, DocsPre } from "@/components/docs/DocsTypography";

export default function SdkElizaosPage() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full border border-[#5eead4]/30 bg-[#5eead4]/10 px-2.5 py-1 font-mono text-[11px] text-[#5eead4]">
          v0.2.0 · published
        </span>
        <DocsLink href="https://www.npmjs.com/package/@arcproof/sdk-elizaos">npmjs.com/package/@arcproof/sdk-elizaos</DocsLink>
      </div>
      <DocsH1>@arcproof/sdk-elizaos</DocsH1>
      <DocsLead>
        ElizaOS adapter for <Link href="/docs/sdk" className="text-[#5eead4] hover:underline">@arcproof/sdk</Link>: the full
        orchestrator → specialists → evaluator → real-payment flow, as a real ElizaOS <DocsInlineCode>Action</DocsInlineCode>/
        <DocsInlineCode>Plugin</DocsInlineCode>.
      </DocsLead>

      <DocsCallout>
        A standalone alternative to <Link href="/docs/sdk-langchain" className="text-[#5eead4] hover:underline">@arcproof/sdk-langchain</Link>,
        not an add-on. This package ships its own native orchestrator + specialist builders (<DocsInlineCode>createElizaOrchestrator</DocsInlineCode>,{" "}
        <DocsInlineCode>createElizaClaimGatherer</DocsInlineCode>) that run entirely on ElizaOS&apos;s own model API (
        <DocsInlineCode>runtime.useModel</DocsInlineCode>) — zero LangChain dependency. Pick this or sdk-langchain based purely on which
        agent framework your product already runs on; the trust layer underneath is identical either way.
      </DocsCallout>

      <DocsPre>{`orchestrator (createElizaOrchestrator)   -- picks which specialists a request needs
specialist   (createElizaClaimGatherer)  -- runs its tools, drafts claims via runtime.useModel
evaluator    (@arcproof/sdk's VerifierRegistry) -- independently verifies, zero LLM calls`}</DocsPre>

      <DocsH2 id="install">Install</DocsH2>
      <DocsPre title="bash">{`npm install @arcproof/sdk @arcproof/sdk-elizaos @elizaos/core`}</DocsPre>

      <DocsH2 id="usage-a">Usage A — standalone (native ElizaOS, no LangChain)</DocsH2>
      <DocsP>
        Real, working code from <DocsInlineCode>examples/defi-diligence-agent</DocsInlineCode>. Verified live on Arc testnet: orchestrator
        plan → specialists → deterministic verification against live DefiLlama/CoinGecko/Snapshot data → real per-specialist payout,{" "}
        <DocsInlineCode>ACCEPT</DocsInlineCode>.
      </DocsP>
      <DocsPre title="TypeScript">{`import { createElizaClaimGatherer, createElizaOrchestrator, createArcProofAction, type ElizaTool } from "@arcproof/sdk-elizaos";
import { VerifierRegistry, ARC_TESTNET } from "@arcproof/sdk";

// A tool is a plain async fn returning a text result (or an "ERROR: ..." line
// the model is told to skip) -- no LangChain tool() wrapper.
const fetchTvl: ElizaTool = {
  name: "fetch_tvl",
  description: "Fetch a protocol's live TVL in USD.",
  run: async (ctx) => \`tvl_usd=\${await lookUpTvl(ctx.protocolSlug)} source=... simulated=false\`,
};

const onchain = createElizaClaimGatherer({
  agentId: "onchain-agent-v1",
  tools: [fetchTvl /*, ... */],
  claimTypes: ["tvl", "price_change", "wallet_flow", "token_concentration"],
  systemPrompt: "You are the on-chain data specialist. Draft one claim per metric your tools returned; copy values verbatim.",
});

// Orchestrator picks which specialists a given request needs.
const gatherClaims = createElizaOrchestrator({
  specialists: [{ id: "onchain-agent-v1", description: "On-chain data: TVL, price, wallet flow, concentration.", gatherClaims: onchain } /*, news, compliance */],
});

const action = createArcProofAction({
  name: "DEFI_TREASURY_DILIGENCE",
  description: "Independently verifies protocol claims before treasury deployment, paying each specialist only if its claims check out.",
  trustedAgentConfig: { network: ARC_TESTNET, contractAddress, verifiers },
  requester, settler, providerAddresses,
  budgetAmount: 0.3,
  gatherClaims, // createArcProofAction injects runtime.useModel into its context automatically
  buildContext: (message) => ({ protocolSlug: "uniswap", requestText: message.content.text }),
});`}</DocsPre>
      <DocsP>
        <DocsInlineCode>createArcProofAction</DocsInlineCode>&apos;s handler injects the ElizaOS <DocsInlineCode>runtime</DocsInlineCode>{" "}
        it receives into the job context, so the native gatherers reach <DocsInlineCode>runtime.useModel</DocsInlineCode> without you
        wiring anything — the <DocsInlineCode>gatherClaims(context)</DocsInlineCode> signature stays framework-agnostic.
      </DocsP>

      <DocsH2 id="usage-b">Usage B — reuse a LangChain orchestrator</DocsH2>
      <DocsP>
        If your specialists are already built with{" "}
        <Link href="/docs/sdk-langchain" className="text-[#5eead4] hover:underline">
          @arcproof/sdk-langchain
        </Link>
        , pass its orchestrator straight into <DocsInlineCode>createArcProofAction</DocsInlineCode> — ElizaOS never has to know the
        difference. Real, working code from <DocsInlineCode>examples/lending-apr-agent</DocsInlineCode>, verified live.
      </DocsP>
      <DocsPre title="TypeScript">{`import { createArcProofAction, createArcProofPlugin } from "@arcproof/sdk-elizaos";
import { createLangChainOrchestrator } from "@arcproof/sdk-langchain";

const gatherClaims = createLangChainOrchestrator({
  model,
  specialists, // makeSpecialists(model) -- same shared.ts the LangChain-only entrypoint uses
  buildPlanningMessage: (context) => \`Request: \${context.requestText}\\nLoan id: \${context.loanId}\`,
});

const action = createArcProofAction({
  name: "CHECK_TRUE_APR",
  description: "Independently verifies a loan's true APR and borrower eligibility before answering.",
  trustedAgentConfig: { network: ARC_TESTNET, contractAddress, verifiers },
  requester, settler,
  providerAddresses: { "lending-apr-agent-v1": "0x...", "lending-eligibility-agent-v1": "0x..." },
  budgetAmount: 0.06,
  gatherClaims,
  buildContext: (message) => ({ loanId: "loan-001", requestText: message.content.text }),
});

const plugin = createArcProofPlugin({
  name: "arcproof-trust-layer",
  description: "Bonded, independently-verified agent actions with real on-chain payment.",
  actions: [action],
});
// register plugin with your ElizaOS character/project as you would any other plugin`}</DocsPre>

      <DocsH3>Why this doesn&apos;t import types from @elizaos/core</DocsH3>
      <DocsP>
        <DocsInlineCode>@elizaos/core</DocsInlineCode>&apos;s top-level barrel re-exports both <DocsInlineCode>./types</DocsInlineCode>{" "}
        (which defines <DocsInlineCode>Action</DocsInlineCode>/<DocsInlineCode>Plugin</DocsInlineCode> as types) and{" "}
        <DocsInlineCode>./actions</DocsInlineCode> (a same-named runtime export) via <DocsInlineCode>export *</DocsInlineCode>. TypeScript
        silently drops an ambiguous re-exported name rather than erroring, so importing the type directly fails at typecheck time even
        though it genuinely exists (confirmed against <DocsInlineCode>@elizaos/core@1.7.2</DocsInlineCode>&apos;s actual type
        definitions). This package defines structurally-identical local types instead — assignment-compatible with the real ones
        wherever your ElizaOS runtime code expects them.
      </DocsP>

      <DocsH2 id="examples">Worked examples (real, verified live)</DocsH2>
      <DocsP>
        Both worked examples ship an <DocsInlineCode>elizaos-demo.ts</DocsInlineCode> that drives the exact same specialists as their
        LangChain entrypoint through a real <DocsInlineCode>ElizaAction.handler</DocsInlineCode> — proving the two adapters are
        interchangeable, not two different products. See{" "}
        <Link href="/docs/examples" className="text-[#5eead4] hover:underline">
          Examples
        </Link>
        .
      </DocsP>
    </div>
  );
}
