# ArcProof — Project Status

A working reference for anyone picking this project up: what's actually done,
what's real vs. simulated, and what's left before this is a complete, connected
product. See `README.md` for the pitch/architecture and `HACKATHON.md` for the
original PRD/event context.

Last updated: 2026-07-04.

## Done

### Planning
- `HACKATHON.md` — full PRD + hackathon reference.
- Core decisions already made and should be treated as settled unless something
  concrete changes them: the evaluator's accept/mismatch/unverifiable decision
  must be deterministic code, not an LLM judgment call; every agent role should
  be able to use a real Circle-managed wallet, not just one; the eventual SDK
  extraction (Phase 3) is intentionally deferred until the working system is
  proven and connected end to end.

### `frontend/` — Next.js landing page
- Full marketing/landing page built, themed off the MetaMask/COMPUTE reference
  template (fonts, animations, backgrounds, real hosted assets).
- Builds clean, pushed to GitHub.
- **Not done**: `/app` is a placeholder. No job-submission form, no per-claim
  results view, no reputation dashboard UI. Not connected to any backend.

### `agent/` — Python backend (reference implementation)
- Built by a teammate. Real 5-service system (orchestrator, 3 specialists,
  evaluator), real Arc testnet payments, a deployed `VeriFiEscrow` contract.
- Known gaps, not yet fixed here: the evaluator is LLM-judgment based (not
  deterministic), and Circle Wallets are only wired for the `requester` role,
  off by default and undocumented.
- Not modified this round — kept as-is.

### `agent-ts/` — TypeScript backend (primary, working implementation)
- Full parallel port of the same 5-service architecture, framework-agnostic
  core package + Fastify services, real Arc testnet contract (freshly
  deployed), real funded wallets, real LangChain.js agents.
- Both corrective fixes are in and proven: the evaluator (`core/src/evaluator.ts`)
  is deterministic code with zero LLM calls; Circle Wallets support is wired
  for every role (code ready, not yet switched on — see below).
- **All three job outcomes proven live with real transactions**: a clean
  accept (real TVL/price matches), a safe refund-on-failure (proven repeatedly
  under real provider outages), and a full reject (a real injected compliance
  lie caught by the evaluator, plus an unplanned bonus: an organic LLM
  hallucination on a different specialist also caught) — with correct
  per-specialist payout splits and reputation divergence.
- Committed and pushed in 3 commits: core+contracts, services, docs/scripts.

## Known issues / lessons learned

- **Free-tier LLM providers are not reliable enough to depend on for a demo.**
  Went through Gemini (20 req/day/key, exhausted mid-testing) → OpenRouter free
  models (rate-limited, and one model had a structured-output compatibility
  bug) → Groq (works, generous free tier, solid tool-calling support). `llm.ts`
  now checks providers in this order: Groq → OpenRouter → Gemini →
  Anthropic → OpenAI. If Groq's limits ever become a problem, the same pattern
  (add a provider branch in `getModel()`) is how to add another one.
- **Zero-claims jobs get stuck money.** If every specialist fails to produce
  any claims (e.g. a provider outage), the job still gets marked `accept` (per
  the rule "0 mismatches = accept") and the requester's locked budget stays
  withheld in the escrow contract forever — it's never automatically refunded,
  because the job didn't technically fail, it just produced nothing. This is a
  real bug worth fixing (e.g.: treat zero checkable claims as its own case that
  triggers a refund, not an auto-accept).
- **Gemini's function-calling schema rejects `anyOf` unions** nested inside
  array-of-object tool/response schemas — affects any zod schema using
  `z.union([...])` or even `.nullable()` on a field inside an array item
  passed as a tool or structured-output schema. Worked around in
  `agentSchemas.ts` by making `claim_value` a plain required string. Keep this
  in mind if adding new structured-output fields.

## What's left, in priority order

1. **Connect the frontend to `agent-ts`.** This is the single biggest gap.
   Needs:
   - CORS added to `agent-ts/packages/services/src/orchestrator.ts`
     (`@fastify/cors`, not installed yet).
   - An actual `/app` UI: job submission form (request text, protocol slug,
     budget, optional target address / fault injection for demo purposes),
     a results view showing the memo + per-claim match/mismatch/unverifiable
     table + payout outcome, and a reputation dashboard page.
   - Wire these to the orchestrator's existing endpoints: `POST /jobs`,
     `GET /jobs/:id`, `GET /jobs`, `GET /reputation`, `GET /wallets`.
2. **Decide the fate of `agent/` vs `agent-ts/`.** Recommend: treat `agent-ts`
   as the real implementation going forward, explicitly document `agent/` as
   archived/reference-only, so nobody accidentally builds new features on the
   Python version.
3. **Turn on Circle Wallets for real in `agent-ts`.** Code and docs already
   exist (`agent-ts/README.md` → "Circle Wallets setup", `scripts/circle-setup.ts`).
   Just needs someone to actually run the provisioning script and fund the
   resulting wallets.
4. **Fix the zero-claims-stuck-in-escrow edge case** (see above).
5. **Add basic auth/rate-limiting** before any of this runs anywhere reachable
   by someone other than the person testing it locally.
6. **Phase 3 (later, separate effort, not urgent)**: extract the reusable
   core into an actual published SDK package, with a LangChain.js adapter and
   an ElizaOS plugin. Deliberately not started — do this only after items 1–5
   above are done and the connected product has been used for real.

## Where to look for more detail

- `agent-ts/README.md` — architecture, exact verification/tolerance rules,
  Circle Wallets setup, running instructions, project layout.
- `agent/README.md` — same, for the Python reference implementation.
- `README.md` — top-level pitch, architecture diagram, repo map.
