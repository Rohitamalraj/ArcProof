# @arcproof/sdk-elizaos

ElizaOS adapter for [`@arcproof/sdk`](../sdk): the full orchestrator → specialists → evaluator → real-payment flow, as a real ElizaOS `Action`/`Plugin`.

**A standalone alternative to [`@arcproof/sdk-langchain`](../sdk-langchain), not an add-on.** This package ships its own native orchestrator + specialist builders (`createElizaOrchestrator`, `createElizaClaimGatherer`) that run entirely on ElizaOS's own model API (`runtime.useModel`) -- **zero LangChain dependency**. So `@arcproof/sdk` + `@arcproof/sdk-elizaos` alone gives you the complete pipeline; you never need `@arcproof/sdk-langchain` unless you specifically want LangChain.

```text
orchestrator (createElizaOrchestrator)   -- picks which specialists a request needs
specialist   (createElizaClaimGatherer)  -- runs its tools, drafts claims via runtime.useModel
evaluator    (@arcproof/sdk's VerifierRegistry) -- independently verifies, zero LLM calls
```

Pick this or `@arcproof/sdk-langchain` based purely on which agent framework your product already runs on -- the trust layer (verification + on-chain payment, in `@arcproof/sdk` core) is identical either way.

## Install

```bash
npm install @arcproof/sdk @arcproof/sdk-elizaos @elizaos/core
```

## Usage A -- standalone (native ElizaOS, no LangChain)

Real, working code from [`examples/defi-diligence-agent`](../../examples/defi-diligence-agent) (`src/shared-native.ts` + `src/elizaos-native.ts`). The three specialists (`onchain-agent-v1`, `news-agent-v1`, `compliance-agent-v1`) are built with this package's own `createElizaClaimGatherer`, and the orchestrator with `createElizaOrchestrator` -- all on `runtime.useModel`, no LangChain anywhere. Verified live on Arc testnet: orchestrator plan → specialists → deterministic verification against live DefiLlama/CoinGecko/Snapshot data → real per-specialist payout, `ACCEPT`.

```ts
import { createElizaClaimGatherer, createElizaOrchestrator, createArcProofAction, type ElizaTool } from "@arcproof/sdk-elizaos";
import { VerifierRegistry, ARC_TESTNET } from "@arcproof/sdk";

// A tool is a plain async fn returning a text result (or an "ERROR: ..." line
// the model is told to skip) -- no LangChain tool() wrapper.
const fetchTvl: ElizaTool = {
  name: "fetch_tvl",
  description: "Fetch a protocol's live TVL in USD.",
  run: async (ctx) => `tvl_usd=${await lookUpTvl(ctx.protocolSlug)} source=... simulated=false`,
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
  trustedAgentConfig: { network: ARC_TESTNET, contractAddress, verifiers /* VerifierRegistry, one entry per claim_type */ },
  requester, settler, providerAddresses,
  budgetAmount: 0.3,
  gatherClaims, // the native ElizaOS orchestrator -- createArcProofAction injects runtime.useModel into its context automatically
  buildContext: (message) => ({ protocolSlug: "uniswap", requestText: message.content.text }),
});
```

`createArcProofAction`'s handler injects the ElizaOS `runtime` it receives into the job context, so the native gatherers reach `runtime.useModel` without you wiring anything -- the `gatherClaims(context)` signature stays framework-agnostic.

## Usage B -- reuse a LangChain orchestrator (if you already have one)

If your specialists are already built with [`@arcproof/sdk-langchain`](../sdk-langchain), you can pass its orchestrator straight into `createArcProofAction` -- ElizaOS never has to know the difference. Real, working code from [`examples/lending-apr-agent`](../../examples/lending-apr-agent) (`src/elizaos-demo.ts` + `src/shared.ts`), verified live.

```ts
import { createArcProofAction, createArcProofPlugin } from "@arcproof/sdk-elizaos";
import { createLangChainOrchestrator } from "@arcproof/sdk-langchain";
import { VerifierRegistry, ARC_TESTNET } from "@arcproof/sdk";
import { getModel, makeSpecialists, makeVerifiers } from "./shared.js"; // same file the LangChain-only entrypoint uses

const model = await getModel();
const specialists = makeSpecialists(model); // lending-apr-agent-v1 + lending-eligibility-agent-v1
const verifiers = makeVerifiers(); // one VerifierRegistry entry per claim_type, deterministic

// The orchestrator IS the gatherClaims the ElizaOS action calls -- no
// separate ElizaOS-specific planning logic needed. Could just as easily be
// a single createLangChainClaimGatherer() instead of a full orchestrator;
// ElizaOS never has to know the difference, it just sees the reply either way.
const gatherClaims = createLangChainOrchestrator({
  model,
  specialists,
  buildPlanningMessage: (context) => `Request: ${context.requestText}\nLoan id: ${context.loanId}`,
});

const action = createArcProofAction({
  name: "CHECK_TRUE_APR",
  description: "Independently verifies a loan's true APR and borrower eligibility before answering, paying each specialist only if their claim checks out.",
  trustedAgentConfig: { network: ARC_TESTNET, contractAddress, verifiers },
  requester, // WalletCredential
  settler, // WalletCredential
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

// register `plugin` with your ElizaOS character/project as you would any other plugin
```

## Why this doesn't import types from `@elizaos/core`

`@elizaos/core`'s top-level barrel (`dist/index.d.ts`) re-exports both `./types` (which defines `Action`/`Plugin` as types) and `./actions` (a same-named runtime export) via `export *`. TypeScript silently drops an ambiguous re-exported name rather than erroring, so `import type { Action } from "@elizaos/core"` fails at typecheck time even though the type genuinely exists in the package (confirmed against `@elizaos/core@1.7.2`'s actual `.d.ts` files).

This package defines structurally-identical local types (`ElizaAction`, `ElizaPlugin`, etc.) instead of depending on that fragile export path. TypeScript's structural typing makes the objects this package builds assignable to the real `Action`/`Plugin` types wherever your actual ElizaOS runtime code expects them -- `@elizaos/core` is still a declared peer dependency because you need the real package installed to run an agent at all.

## Worked examples (real, verified live)

Both ship an `elizaos-demo.ts` that drives the exact same specialists as their LangChain entrypoint through a real `ElizaAction.handler` -- proving the two adapters are interchangeable, not two different products:

- [`examples/defi-diligence-agent`](../../examples/defi-diligence-agent) -- the real `onchain-agent-v1`/`news-agent-v1`/`compliance-agent-v1` DeFi specialists.
- [`examples/lending-apr-agent`](../../examples/lending-apr-agent) -- a different vertical (lending true-APR + eligibility).

## License

MIT
