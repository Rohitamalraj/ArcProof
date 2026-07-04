# ArcProof — Project Status

A working reference for anyone picking this project up: what's actually done,
what's real vs. simulated, and what's left before this is a complete, connected
product. See `README.md` for the pitch/architecture and `HACKATHON.md` for the
original PRD/event context.

Last updated: 2026-07-04 (post Phase 3 SDK build).

## Done

### Planning
- `HACKATHON.md` — full PRD + hackathon reference.
- Core decisions already made and should be treated as settled unless something
  concrete changes them: the evaluator's accept/mismatch/unverifiable decision
  must be deterministic code, not an LLM judgment call; every agent role should
  be able to use a real Circle-managed wallet, not just one. Phase 3 (SDK
  extraction) was deferred until the working system was proven end to end —
  that happened, and Phase 3 is now built (see below); publishing it is the
  one remaining step.

### `frontend/` — Next.js app, now connected to `agent-ts`
- Marketing/landing page (unchanged) plus a real `/app`: job submission form
  (request text, protocol slug, budget, optional template label, optional
  compliance target address with a one-click real OFAC demo address, optional
  fault injection), a live wallet-balance strip (`GET /wallets`), a results
  view (memo + per-claim match/mismatch/unverifiable table + per-specialist
  payout outcome), job history, a job permalink page (`/jobs/[id]`), and a
  reputation dashboard (`/reputation`). Wired to all 5 orchestrator endpoints.
- Fixed a real Turbopack workspace-root misdetection bug along the way (a
  stray `pnpm-lock.yaml` in the home directory made Next resolve
  `frontend/node_modules` from the wrong place) — pinned via
  `turbopack.root` in `next.config.ts`.
- **Real wallet-connect, linked to a real on-chain payment, not decorative.**
  `WalletConnectButton` connects an injected browser wallet (MetaMask etc.),
  adds/switches to Arc Testnet, shows live balance (`lib/wallet.ts`,
  `lib/walletStore.ts`, both real `viem`-backed calls). Submitting a job now
  requires a connected wallet: the frontend generates a `job_id` client-side
  and calls `VeriFiEscrow.lock(bytes32)` **directly from the connected
  wallet** (a real signed contract transaction, budget attached as native
  value) before ever hitting the orchestrator.
- Backend changed to make that real: `agent-ts`'s `JobRequestSchema` now
  accepts an optional `job_id`/`payment_tx_hash`; when present, the
  orchestrator independently re-reads the contract's on-chain state
  (`escrowContract.getJob()`) to verify the lock (status/requester/amount)
  instead of trusting the claim or locking the budget itself. New
  `GET /config` endpoint gives the frontend the real deployed escrow
  contract address instead of hardcoding it.
- Verified for real via the exact browser-wallet code path (a script that
  locks through `viem` the same way the frontend does, then posts
  `job_id`+`payment_tx_hash`): a real, unscripted `rejected` verdict with a
  real partial payout, and confirmed the orchestrator correctly skips its
  own `lock()` call instead of double-locking.

### `agent/` — Python backend (reference implementation, ARCHIVED)
- Built by a teammate. Real 5-service system, real Arc testnet payments, a
  deployed `VeriFiEscrow` contract.
- Marked archived/reference-only at the top of `agent/README.md`. Not
  modified this round beyond that notice — don't build new features here.

### `agent-ts/` — TypeScript backend (primary, working implementation)
- Full parallel port of the same 5-service architecture, framework-agnostic
  core package + Fastify services, real Arc testnet contract, real LangChain.js
  agents, deterministic evaluator (zero LLM calls in the verdict itself).
- **Circle Developer-Controlled Wallets are fully live, not just wired**: real
  entity secret generated + registered with Circle, a real wallet set + one
  real Circle-managed wallet per role (`requester`, `orchestrator`, all 3
  specialists) provisioned and funded (20 USDC each via Circle's own
  authenticated faucet API, `client.requestTestnetTokens`). The deployed
  contract's `settler` was updated on-chain (`setSettler`, owner-only, called
  from the `escrow` role) to the new Circle-managed orchestrator address —
  needed because `release()`/`finalize()`/`refund()` now sign through Circle
  for that role and the contract only lets `settler` call them.
- **Basic hardening added and verified at runtime**: per-IP rate limiting
  (`@fastify/rate-limit`, 60 req/min) on all 5 services, CORS
  (`@fastify/cors`) on the orchestrator, and an optional shared-secret
  `X-Api-Key` check on `POST /jobs` (unset by default, zero config for local
  use). Caught and fixed a real bug while verifying this: registering
  Fastify plugins without `await` looked fine but the rate-limit hook never
  actually fired once all 5 services boot concurrently via
  `cli/runDemo.ts`'s `Promise.all` — fixed by awaiting registration before
  routes are defined.
- **Fixed the zero-claims-stuck-in-escrow bug** (see "Known issues" below,
  now resolved): `settlement.ts` exports `hasCheckableClaims()`; the
  orchestrator refunds instead of settling when a job produces none.
- **Fixed a real dotenv/CWD bug**: `npm run <script> --workspace=<pkg>`
  changes cwd to that package's directory, which silently loaded zero env
  vars via the old CWD-relative `import "dotenv/config"` (every wallet
  balance came back empty, no error). `config.ts` now loads `.env` from an
  explicit path resolved from the module's own location, so it works
  regardless of how a script is invoked.
- **All job outcomes proven live with real transactions** through the full
  updated stack (Circle wallets + hardening + frontend), most recently a
  clean accept with real TVL/price matches and a real per-specialist
  settlement release.

## Known issues / lessons learned

- **Free-tier LLM providers are not reliable enough to depend on for a demo.**
  Went through Gemini (20 req/day/key, exhausted mid-testing) → OpenRouter free
  models (rate-limited, and one model had a structured-output compatibility
  bug) → Groq (works, generous free tier, solid tool-calling support). `llm.ts`
  now checks providers in this order: Groq → OpenRouter → Gemini →
  Anthropic → OpenAI. If Groq's limits ever become a problem, the same pattern
  (add a provider branch in `getModel()`) is how to add another one.
- **Zero-claims jobs got stuck money — FIXED.** If every specialist failed to
  produce any claims (e.g. a provider outage), the job used to still get
  marked `accept` (per the rule "0 mismatches = accept") and the requester's
  locked budget stayed withheld in the escrow contract forever, since the job
  never technically failed, it just produced nothing. `settlement.ts` now
  exports `hasCheckableClaims()`; the orchestrator throws (triggering the
  existing refund path) instead of calling `settle()` when this is false.
- **Turning on a role's Circle wallet can silently break contract calls that
  role makes as `msg.sender`.** The deployed `VeriFiEscrow`'s `settler` is
  fixed to whatever address was passed at deploy time. If you later give the
  `orchestrator` role a Circle-managed wallet, `release()`/`finalize()`/
  `refund()` start signing from that *new* address, which the contract will
  reject (`"not settler"`) until you call `setSettler()` (owner-only, i.e.
  the `escrow` role) to update it on-chain. Same principle applies to any
  future role whose Circle wallet needs on-chain permission the contract
  granted to a specific plain address at deploy time.
- **Balance displays only ever read the plain eth_account wallets — FIXED.**
  `cli/runDemo.ts`'s `checkRealBalances()` and the orchestrator's
  `GET /wallets` both called `wallet.ledger.allBalances()`, which only knows
  about the plain per-role keys -- once a role has a Circle wallet, that's
  no longer the balance actually being spent, but it kept showing (and
  gating the demo's "enough funds?" check on) the now-irrelevant plain
  balance instead. Both now show `<role> (circle)` / `<role>-circle` with
  the real Circle-managed balance for any role that has one configured.
- **Gemini's function-calling schema rejects `anyOf` unions** nested inside
  array-of-object tool/response schemas — affects any zod schema using
  `z.union([...])` or even `.nullable()` on a field inside an array item
  passed as a tool or structured-output schema. Worked around in
  `agentSchemas.ts` by making `claim_value` a plain required string. Keep this
  in mind if adding new structured-output fields.

## What's left, in priority order

Items 1–5 from the previous round are done (frontend connected, backend
decision documented, Circle Wallets live, zero-claims fixed, basic
auth/rate-limiting in and verified), the wallet-connect + on-chain-verified
job flow is done and proven live, and the three follow-ups below are now
closed too:

- ~~`API_KEY`/`FRONTEND_ORIGIN` unset by default~~ — **done.** Both are set
  for real in `agent-ts/.env` (`API_KEY`, a random 24-byte secret;
  `FRONTEND_ORIGIN=http://localhost:3000`), matched by
  `NEXT_PUBLIC_API_KEY` in `frontend/.env.local`. Verified live: `POST /jobs`
  401s without the header and succeeds with it; CORS preflight from a
  different origin gets back `Access-Control-Allow-Origin:
  http://localhost:3000` (i.e. any other origin's browser rejects the
  mismatched response) instead of reflecting the caller's origin.
- ~~No UI affordance for "wrong network" recovery~~ — **done.**
  `WalletConnectButton` now shows a "wallet not responding? add it
  manually" toggle in the wrong-network state, revealing the exact network
  name/RPC URL/chain ID/currency/explorer to paste into the wallet's own
  "Add Network" form if the programmatic `wallet_addEthereumChain` call
  gets ignored or silently fails.
- **Circle wallets only provisioned for `requester` + 3 specialists +
  `orchestrator`, not `escrow`** — not a gap, by design: `escrow` is the
  contract deployer/owner, which needs a fixed plain address `setSettler()`
  can trust; nothing to fix here.

What's actually left:

1. ~~Phase 3: extract the reusable core into an actual published SDK
   package~~ — **built, not yet published.** Three new packages under
   `agent-ts/packages/`:
   - `@arcproof/sdk` — the generalized trust layer. `claim_type` is a
     plain string (not the reference app's fixed 7-value DeFi enum), a
     `VerifierRegistry` replaces the hardcoded evaluator switch (register
     your own deterministic verifier per claim_type — zero LLM calls,
     same auditability principle, any domain), `escrow.ts`/`chain.ts`/
     `circleWallet.ts` take a `WalletCredential` directly instead of a
     fixed 6-role env-based lookup, and `runTrustedJob()` ties
     lock → gather → verify → settle/refund into one call. The
     `hasCheckableClaims` stuck-funds guard and the `waitForTransactionReceipt`
     fix (see below) are both ported in from day one.
   - `@arcproof/sdk-langchain` — wraps any LangChain.js tool-calling agent
     as a `gatherClaims()` function. Carries forward both known
     structured-output workarounds (Gemini's `anyOf`-union rejection,
     Groq's boolean-as-string quirk) by convention from the start.
     Also exports `createLangChainOrchestrator()` — the piece the first
     SDK pass was missing: an LLM that decides *which* of several
     registered specialists a specific request actually needs (ported
     from the reference apps' `orchestrator.ts`/`langchainPlanner.ts`
     `planSpecialists()`), so the full three-layer pattern (orchestrator
     assigns specialists → specialists check and report → evaluator
     independently verifies) is a first-class SDK capability, not
     something every integrator re-derives themselves. No silent fallback
     on a genuine planning failure — same "agent or refund" rule as
     everywhere else; only a *successful-but-empty* plan defaults to
     engaging every specialist.
   - `@arcproof/sdk-elizaos` — a real ElizaOS `Action`/`Plugin`, built
     against `@elizaos/core@1.7.2`'s actual type definitions. Deliberately
     does *not* import types from `@elizaos/core` (that package's barrel
     export has an internal `Action` name collision between `./types` and
     `./actions` that TypeScript silently resolves by dropping the
     ambiguous export) — uses structurally-identical local types instead,
     which are assignment-compatible with the real ones. Its `gatherClaims`
     accepts a full `createLangChainOrchestrator(...)` exactly like a single
     specialist would — verified live (see `elizaos-demo.ts` below): same
     orchestrator, same two specialists, same verifiers, invoked through a
     real `ElizaAction.handler(...)` call instead of directly, real
     transactions throughout, correct `ActionResult`. LangChain.js and
     ElizaOS are two interchangeable wrappers around one identical trust
     layer, not two different products — an integrator picks whichever
     framework their product already uses.
   - `examples/lending-apr-agent` — the proof this isn't DeFi-locked, and
     that the orchestrator layer genuinely selects dynamically rather than
     just running everything: **two** specialists
     (`lending-apr-agent-v1` for true-APR/fees, `lending-eligibility-agent-v1`
     for borrower-region eligibility — new claim types, a mock
     lending-platform data source, nothing shared with the reference
     app's vertical) sitting behind `createLangChainOrchestrator`.
     Verified live: a pure APR question engages only the APR agent (real
     contract deploy, real lock, real claims, real independent
     recomputation, real payout, `ACCEPT`); a request that also asks about
     eligibility engages both agents, each paid from its own share, verdict
     still `ACCEPT` with the eligibility agent's `false` (ineligible-region)
     claim independently confirmed as a genuine `match`, not a rubber
     stamp. The safety-net path (an LLM failure produces zero checkable
     claims → automatic refund, no stuck funds) is also proven live. The
     catch-a-lie scenario is proven at the verifier-logic level (a
     fabricated APR claim is correctly flagged `mismatch`, delta -20%) —
     the live end-to-end run of that exact fault-injection prompt hit the
     same free-tier Groq flakiness documented above (malformed
     function-call generation, not a schema or SDK bug) repeatedly; the
     mechanism is proven correct independent of that. Specialists/verifiers
     live in `src/shared.ts`, imported unchanged by both `src/index.ts`
     (LangChain.js orchestrator called directly) and `src/elizaos-demo.ts`
     (the same orchestrator composed through a real ElizaAction) — the
     point being that neither entrypoint reimplements the trust logic.
   - **Found + fixed a real bug while building this**: `agent-ts/packages/core/src/escrowContract.ts`'s
     Circle-wallet branches called `publicClient.getTransactionReceipt()`
     (one-shot) instead of `waitForTransactionReceipt()` (polls) — Circle
     confirming a tx hash exists doesn't guarantee the public RPC node has
     indexed a receipt for it yet, so a genuinely successful release() was
     spuriously throwing `TransactionReceiptNotFoundError` and failing the
     whole job. Fixed in all 4 functions (lock/release/finalize/refund),
     verified with a real job that failed before the fix and succeeded
     cleanly after it. The SDK's own `escrow.ts` was written with this fix
     from the start.
   - **Not done yet**: actually publishing to the public npm registry.
     All three packages pass `npm publish --dry-run` cleanly (correct
     files, correct metadata) and the `@arcproof` scope is unclaimed
     (`registry.npmjs.org/@arcproof/sdk` → 404), but the publish itself
     needs whoever owns/creates the `@arcproof` npm account or
     organization to run `npm login` then `npm publish` per package
     (`sdk` first, then `sdk-langchain`/`sdk-elizaos`) from inside each
     package directory — not something to do without the account owner
     present.

## Where to look for more detail

- `agent-ts/packages/sdk/README.md`, `sdk-langchain/README.md`,
  `sdk-elizaos/README.md` — SDK usage, API surface, Circle Wallets setup.
- `agent-ts/examples/lending-apr-agent/README.md` — the non-DeFi worked example.
- `agent-ts/README.md` — architecture, exact verification/tolerance rules,
  Circle Wallets setup, running instructions, project layout.
- `agent/README.md` — same, for the Python reference implementation.
- `README.md` — top-level pitch, architecture diagram, repo map.
