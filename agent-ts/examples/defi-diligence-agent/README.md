# DeFi treasury-diligence agent -- @arcproof/sdk worked example (the ORIGINAL vertical)

The companion to [`examples/lending-apr-agent`](../lending-apr-agent). Where that one proves `@arcproof/sdk` works for a *new* vertical (lending), this one proves it works for the **original** vertical the whole project started as -- DeFi protocol treasury diligence -- using the **exact same specialists** as the reference apps:

- **`onchain-agent-v1`** -- TVL (DefiLlama), 7-day price change (CoinGecko), treasury wallet flow to exchanges (Etherscan/simulated), top-10 holder concentration.
- **`news-agent-v1`** -- most recent closed governance proposal (Snapshot), corroborated security-incident news (GDELT).
- **`compliance-agent-v1`** -- OFAC SDN sanctions screening of a specific wallet address.

Same tools, same system prompts, same 7 claim types, and the same deterministic verification rules (±5% numeric tolerance; exact-boolean for wallet_flow/compliance_flag; substring-match for governance_event; 0/1/2+ domain corroboration for news_incident) as `agent-ts/packages/services` and `agent-ts/packages/core/evaluator.ts`. The **only** thing that changed is the plumbing: these run through `@arcproof/sdk`'s generalized `VerifierRegistry` + `runTrustedJob` (one process, one `npm install`) instead of 5 separate Fastify microservices + a fixed `evaluator.ts` switch. `src/shared.ts` even reuses `@arcproof/core`'s `dataSources` directly, so the live data is literally the same.

## What it proves

Together with `lending-apr-agent`, this shows the SDK is genuinely vertical-agnostic: the same trust layer (orchestrator picks specialists → specialists check and report → deterministic evaluator verifies → per-specialist on-chain payout) drives two completely different domains with zero changes to `@arcproof/sdk` itself.

## Run it

From `agent-ts/` (reuses the reference app's funded `.env` wallets):

```bash
# Clean multi-specialist run -- orchestrator engages all 3 real specialists
npx tsx examples/defi-diligence-agent/src/index.ts uniswap "Assess Uniswap before treasury deployment."

# Fault injection -- the on-chain agent is told to report TVL at 1.5x real;
# the deterministic evaluator independently re-fetches from DefiLlama, catches
# the ~50% mismatch, and cuts that specialist's payout to 50% (verdict PARTIAL)
npx tsx examples/defi-diligence-agent/src/index.ts uniswap "Assess Uniswap's on-chain health." "" onchain

# Compliance screening against the real OFAC-sanctioned Tornado Cash address
npx tsx examples/defi-diligence-agent/src/index.ts aave "Assess Aave and screen the counterparty." 0x8589427373d6d84e98730d7795d8f6f8731fda0

# The SAME specialists/verifiers, driven through @arcproof/sdk-elizaos's Action,
# with the orchestrator/specialists still built by @arcproof/sdk-langchain
npx tsx examples/defi-diligence-agent/src/elizaos-demo.ts uniswap "Assess Uniswap before treasury deployment."

# STANDALONE ElizaOS: the same 3 specialists built with @arcproof/sdk-elizaos's
# OWN native builders -- sdk + sdk-elizaos only, ZERO @arcproof/sdk-langchain
npx tsx examples/defi-diligence-agent/src/elizaos-native.ts uniswap "Assess Uniswap before treasury deployment."
```

Each run deploys a fresh `VeriFiEscrow` instance so this example's jobs never interfere with anything else.

## Three entrypoints, one set of specialists

- `src/index.ts` -- LangChain orchestrator + specialists (`shared.ts`), run directly.
- `src/elizaos-demo.ts` -- the LangChain orchestrator/specialists wrapped in an ElizaOS `Action` (proves an existing LangChain build drops into ElizaOS unchanged).
- `src/elizaos-native.ts` -- the same three specialists rebuilt with `@arcproof/sdk-elizaos`'s **native** `createElizaClaimGatherer`/`createElizaOrchestrator` (`shared-native.ts`), importing **no** `@arcproof/sdk-langchain` and **no** `@langchain/*`. This is the proof that ElizaOS is a genuine standalone alternative to LangChain, not an add-on. (`src/elizaTestRuntime.ts` is a thin test harness implementing `runtime.useModel` via an OpenAI-compatible endpoint -- in a real deployment that's the ElizaOS character's own model plugin.)

All three run the identical `onchain-agent-v1`/`news-agent-v1`/`compliance-agent-v1` specialists and the identical deterministic verifiers; only which package builds the orchestrator/specialists differs.

## Verified live (real Arc testnet transactions)

- **Clean run**: all 3 specialists engaged, every claim independently re-derived from live DefiLlama/CoinGecko/Snapshot/OFAC data, all matched → `ACCEPT`, 0.3 USDC split three ways, real transfers.
- **Caught lie**: fabricated TVL (1.5x real, delta 50%) correctly flagged `mismatch` while the specialist's 3 honest claims still matched → payout cut to 50% → `PARTIAL`.
- **Refund safety-net**: when every specialist's LLM call failed (provider quota), zero checkable claims → automatic on-chain refund of the full locked budget, no funds stranded.
- **ElizaOS parity**: the same specialists driven through a real `ElizaAction.handler` produce the same settlement and a natural-language reply.
