# Lending "true APR" agent -- @arcproof/sdk worked example

Proves two things about [`@arcproof/sdk`](../../packages/sdk) at once:

1. **It's not tied to the reference app's DeFi-diligence vertical.** A completely different domain (lending platform fee/APR/eligibility diligence), completely different claim types (`apr_rate`, `processing_fee`, `documentation_charge`, `borrower_eligibility_flag`), a completely different data source (a mock lending platform's own records instead of DefiLlama/CoinGecko/Snapshot/OFAC).
2. **The full orchestrator → specialists → evaluator pattern generalizes, not just a single wrapped agent.** Two specialists (`lending-apr-agent-v1`, `lending-eligibility-agent-v1`) sit behind an orchestrator (`createLangChainOrchestrator` from [`@arcproof/sdk-langchain`](../../packages/sdk-langchain)) that decides, per request, which of them actually apply -- ask a pure APR question and only the APR agent gets engaged and paid; ask about eligibility too and both do.

## The scenario

A user asks: *"What is the true APR? Discover the total cost including interest, processing fees, and documentation charges."* Lending platforms often market a headline APR that understates the real cost once fees are amortized in. The APR agent looks up the platform's own terms and computes the true all-in cost; the eligibility agent separately checks whether the borrower's region qualifies for the loan at all. Both get paid only after a deterministic verifier independently recomputes the same facts from the same canonical source -- zero LLM calls in the verification step itself.

## Run it

From `agent-ts/`, with `.env` already set up (reuses the sibling reference app's wallets purely to avoid a fresh faucet round -- see the module docstring in `src/index.ts` for why, and for how you'd swap in your own):

```bash
# Pure APR question -- orchestrator engages only lending-apr-agent-v1
npx tsx examples/lending-apr-agent/src/index.ts loan-001 "What is the true APR? Discover the total cost including interest, processing fees, and documentation charges."

# Eligibility + APR question -- orchestrator engages both specialists
npx tsx examples/lending-apr-agent/src/index.ts loan-003 "Is this borrower eligible for this loan given their region, and what's the true APR including all fees?"

# Fault injection -- the APR agent is told to report the marketed rate as if it were the true APR
npx tsx examples/lending-apr-agent/src/index.ts loan-002 "" --inject-fault

# The SAME specialists/verifiers (shared.ts), composed through @arcproof/sdk-elizaos
# instead of called directly -- proves the two adapters are interchangeable, not
# two different products. Invokes a real ElizaAction's handler with a mock message.
npx tsx examples/lending-apr-agent/src/elizaos-demo.ts
```

Each run deploys a fresh `VeriFiEscrow` instance so this example's jobs never interfere with the reference app's.

## LangChain vs. ElizaOS: same trust layer, different wrapper

`shared.ts` -- the two specialists, the orchestrator's specialist descriptions, and every `VerifierRegistry` entry -- is used **unchanged** by both entrypoints:

- `index.ts` calls `createLangChainOrchestrator(...)` directly and passes it straight into `runTrustedJob`.
- `elizaos-demo.ts` passes that exact same orchestrator as the `gatherClaims` for a real `@arcproof/sdk-elizaos` `Action`, then invokes the action's handler the way an ElizaOS runtime would.

Nothing about the orchestration, verification, or settlement logic differs between the two -- only how a request comes in (a CLI arg vs. an ElizaOS `Memory` message) and how the answer goes out (a console log vs. an ElizaOS reply `Content`). Picking LangChain.js or ElizaOS is purely a question of which agent framework your product is already built on; the trust layer underneath is identical either way.

## What to look at

- `fixtures/loan_offers.json` -- the mock "lending platform" data source, including `borrower_region`/`eligible_regions` (loan-003's borrower is deliberately in an ineligible region, to exercise a genuine `mismatch`-vs-`match` case on that claim type too).
- `src/index.ts`:
  - `computeTrueApr()` / `isEligible()` -- the two independent-fact formulas both the agents' tools and the verifiers use, computed separately so neither trusts the other.
  - The two `SpecialistDescriptor` entries and the `createLangChainOrchestrator(...)` call -- this is the dynamic "which specialists does this request need" planning step.
  - The `VerifierRegistry` registrations for all 4 claim types -- the evaluator, deterministic, zero LLM calls.
  - The `runTrustedJob(...)` call that ties lock → orchestrate → verify → settle together.
