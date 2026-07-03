# ArcProof — Lepton Agents Hackathon Reference

**Event:** Lepton Agents Hackathon (Canteen × Circle × Arc)
**Dates:** Jun 15 – Jul 6, 2026 (submission deadline: 11:59 PM ET, Jul 6, 2026)
**Format:** Online, 3 weeks, invite-only, no live demo day (async judging)
**Our project:** ArcProof — a bonded, multi-agent financial research/diligence network where specialist agents get paid only after an evaluator agent verifies their claims against live external data.

---

## 1. The One-Line Pitch

> AI agents only get paid and build reputation when an evaluator verifies their financial claims against live data.

**Problem:** Agent payment rails (x402) and agent identity/reputation registries (ERC-8004-style) exist, but nothing verifies that the *work* was actually correct — a payment record proves money moved, not that the analysis was true. This matters acutely in finance, where bad output drives capital allocation and risk decisions (real incident cited: a trading agent misdirected ~$441,780 in tokens). ERC-8004 explicitly punts on validation/slashing economics to "the specific validation protocol" — ArcProof is that protocol, scoped to finance.

---

## 2. Hackathon Context (why this shape of project)

- **Hosts:** Canteen (research/builder-series host), Circle (platform, issuer of USDC/EURC), Arc (Circle's stablecoin-native L1, sub-second finality, native USDC gas).
- **Theme:** Nanopayments remove the "$0.30 minimum viable payment" floor. As small as $0.000001 via Gateway, settled <500ms on Arc. This makes per-call, per-second, per-claim payment economically real for both human creators and AI agents.
- **RFBs (Requests for Builders)** — not mandatory tracks, just idea seeds:
  1. Autonomous Paying Agents
  2. Selling Agent Services via Nanopayments
  3. Agent-to-Agent Nanopayment Networks
  4. Streaming & Continuous Payments
  5. Nanopayment Infrastructure & Tooling
  6. Creator & Publisher Monetization (this round's lean/emphasis)
  7. "Something else" is explicitly allowed
- ArcProof most directly matches **RFB 3** (agent-to-agent nanopayment networks with real economic consequence) and echoes **Prior Art idea #8** ("Reputation you post as collateral, not a score you ask to be trusted" — a broker posting a bond that slashes on bad outcomes, explicitly framed as "the natural application of ERC-8004").
- **Judging weights:**
  | Criterion | Weight | What's being checked |
  |---|---|---|
  | Agentic sophistication | 30% | Real autonomous decision-making (task decomposition, accept/reject calls) vs. scripted automation |
  | Traction | 30% | Genuine usage during the event window — real testnet USDC flowing across multiple real runs, not one scripted demo |
  | Circle tool usage | 20% | Real, non-superficial use of Wallets, Gateway/Nanopayments, x402, App Kit, Contracts |
  | Innovation | 20% | Claim-level verification against live data as the payment trigger — the novel core |
- **Awards:** $50k total — 1st $10k, 2nd $7.5k×2, 3rd $5k×3 ($40k grand prizes); ~10–12 "Standout Team" awards sharing $7.5k; $500 for best dev-tooling feedback; $2k in easter eggs/side quests.
- **Submission requirements:** public GitHub repo (required), <3-minute video demo (required), live deployed link (encouraged, not required). Can submit multiple times before the deadline — submit early and often.
- **Setup checklist:** Luma registration → Canteen Discord → Arc builder Discord (mention Canteen+Lepton) → `uv tool install` the ARC CLI → `npm install -g @circle-fin/cli` → walk the Arc 101 demo / clone `the-canteen-dev/circle-agent` → read the Distribution Bootstrap doc.

---

## 3. Product Scope — What We're Actually Building (MVP)

### In scope
1. Frontend: one page to submit a research/diligence request + budget, plus a results/reputation dashboard.
2. **Orchestrator agent**: decomposes the request into fixed subtasks, calls specialist agents via x402, allocates budget, normalizes outputs into a shared claims schema, assembles the final memo.
3. **2–3 specialist provider agents** (each paid per-call via x402):
   - On-chain data agent (TVL, treasury/whale wallet flows, token concentration) — build first.
   - News/fundamentals agent (incidents, governance actions, partnerships).
   - Compliance/filings agent (sanctions/regulatory flags) — stretch, can ship with just 2 agents.
4. **Evaluator agent**: parses the memo into discrete, pre-tagged claims (no NLP inference needed — orchestrator already emits structured JSON), independently re-derives each fact from a live external source, and issues a per-claim verdict (match/mismatch/unverifiable) plus an overall job verdict (accept/partial/reject). The accept/reject decision itself is **rule-based, not model-based** — LLM use is scoped only to schema extraction, to keep verdicts auditable and deterministic.
5. **Settlement layer**: testnet USDC via Circle Wallets + x402 + Gateway nanopayments; escrow or signed-attestation-based conditional release. Payment is calculated **per specialist agent based on that agent's own claim accuracy**, not the job's overall verdict — one specialist can get paid in full even if another specialist in the same job gets docked.
6. **Reputation dashboard**: per-agent acceptance rate, rejection history, rolling accuracy score.
7. Demo must show at least one fully-accepted job and one rejected/partial job in the same run, with a visible reputation change.

### Explicitly out of scope for MVP
- Full ERC-8004 on-chain registry
- More than 3 specialist agent types / arbitrary claim types beyond the fixed taxonomy
- Production slashing/staking contracts (signed-attestation escrow is acceptable)
- Mainnet or real funds
- KYC/compliance tooling, human-in-the-loop dispute UI

### Stretch goals
- Streaming/pay-per-second pricing for long jobs (ties to Arc's continuous-payment primitives)
- Portable reputation export in ERC-8004-compatible schema
- Second job template: "Yield Opportunity Review"

---

## 4. System Flow

```
Requester (web UI)
  → submits job + budget
Orchestrator Agent
  → decomposes into fixed subtasks per template
  → calls Specialist Agents (on-chain / news / compliance) via x402, pays per-call nanopayment on response
  → normalizes all outputs into structured claims, assembles memo
Evaluator Agent
  → parses memo into discrete claims (pre-tagged claim_type, not NLP)
  → cross-checks each claim against an independent live source
  → per-claim verdict: match / mismatch / unverifiable
  → job verdict: accept / partial accept / reject (rule-based)
Settlement Layer (Circle Wallets + x402 + Gateway)
  → releases / partially releases / withholds USDC PER SPECIALIST based on that specialist's own accuracy
Reputation Store → Dashboard
```

**Two-tier payment:** every specialist gets a small nanopayment just for *responding* (separate, unconditional). The larger conditional payment only releases after evaluator verification — this is the core trust mechanism.

---

## 5. Claim Taxonomy & Verification (the core innovation)

Fixed set of 7 claim types for MVP — anything outside this set is marked `unverifiable`, surfaced to the requester, but excluded from the accept/reject math:

| claim_type | Example | Independent verification source |
|---|---|---|
| `tvl` | "TVL is $182M" | DefiLlama API or protocol's own on-chain endpoint |
| `price_change` | "Token dropped 12% in 7 days" | CoinGecko/CoinMarketCap |
| `wallet_flow` | "Wallet X received funds from exchange Y" | Block explorer API |
| `token_concentration` | "Top 10 holders control 40% of supply" | On-chain holder distribution query |
| `governance_event` | "Proposal Z passed on [date]" | Governance forum/on-chain contract query |
| `news_incident` | "Protocol suffered exploit on [date]" | Requires **2 independent sources** to count as verified; single-source = `unverifiable`, not counted against provider |
| `compliance_flag` | "Address flagged for sanctions" | Sanctions/compliance database |

**Verdict rules:**
- Numeric claims (`tvl`, `price_change`, `token_concentration`): `match` if within a documented tolerance band (e.g., ±5%).
- Categorical claims: `match` only if the independent source confirms the exact same entity/event.
- Job-level: `accept` = all checkable claims match; `partial accept` = mixed match/mismatch up to N mismatches (suggested N=1 for MVP); `reject` = majority mismatch, OR any single mismatch on a "high-stakes" claim type (e.g., `compliance_flag` mismatch always forces at least partial-accept, regardless of everything else).
- Unverifiable claims never count toward mismatch.

---

## 6. Data Model (reference)

- **Job record**: job_id, requester_id, template, request_text, budget_usdc, status, subtasks, final_memo, overall_verdict, total_paid_usdc.
- **Claim record** (the unit passed orchestrator → evaluator): claim_id, job_id, provider_agent_id, claim_type, claim_text, claim_value, provider_source, verification_status, verification_source, verification_delta.
- **Reputation record**: provider_agent_id, total_jobs, accepted_claims, mismatched_claims, unverifiable_claims, accuracy_score (0–1), last_updated.

---

## 7. Circle / Arc Integration Map

| Capability | Used by | Purpose |
|---|---|---|
| Circle Wallets | every actor (requester, orchestrator, specialists, evaluator) | autonomous send/receive USDC |
| x402 | orchestrator → specialists | pay-per-call metering |
| Gateway / Nanopayments | orchestrator → specialists | gas-free sub-cent "you responded" fee, batched |
| Contracts / escrow | requester→escrow, evaluator→settlement | conditional release: lock, release on accept, withhold/return on reject |
| App Kit (Send / Unified Balance) | settlement layer | simplify multichain/testnet balance handling |
| Arc testnet settlement | all payment flows | sub-second finality for live demo of payment release |

**Reference repos to scaffold from (check before building from scratch):**
- `circlefin/arc-nanopayments` — nanopayments end-to-end incl. LangChain paying agent, x402 seller endpoints, Gateway batching. Start here.
- `circlefin/arc-escrow` — "AI-powered work validation and USDC settlement," architecturally closest to our evaluator/settlement layer.
- `the-canteen-dev/circle-agent` — Canteen's companion explainer to arc-nanopayments.

---

## 8. Non-Functional Requirements

- **Auditability**: store the exact independent-source query + response behind every verdict.
- **Latency**: full job (submit → specialists → evaluation → settlement) under ~2 minutes for live demo.
- **Idempotency**: cache external verification calls per job (rate limits + consistent repeat demos).
- **Transparency**: frontend shows per-claim pass/fail, not just a final accept/reject.
- **Testnet-only**: no mainnet funds anywhere in the MVP.

---

## 9. Suggested Tech Stack

- Frontend: React (submission page + results/reputation dashboard).
- Orchestrator & specialists: LangChain or lightweight custom agent framework, one process per role.
- Evaluator: deterministic rules engine wrapping external API calls; LLM only for claim-text → schema extraction.
- External data: DefiLlama (TVL), a market data API (price), a block explorer API, a sanctions/compliance source.
- Payments: Circle CLI / Agent Stack, x402 client/server libs, Gateway nanopayments, Arc testnet RPC.
- Storage: simple relational/document store for jobs/claims/reputation — only payment state needs to be on-chain.

---

## 10. 3-Week Milestone Plan

- **Week 1 — Foundations**: Circle Wallets for all roles; one working x402-metered call end-to-end (orchestrator → 1 specialist → nanopayment); fixed claim schema + Template A subtask decomposition; ship the on-chain data specialist.
- **Week 2 — Verification core**: build the evaluator (parsing, per-claim-type verification, tolerance/verdict logic); add remaining specialists; wire conditional settlement (accept→release, reject/partial→withhold, per specialist).
- **Week 3 — Polish & traction**: frontend (submission + per-claim results + reputation dashboard); run many real jobs against real live protocols/tokens for genuine testnet traction; record <3-min demo (one accepted job + one rejected/partial job + reputation change); deploy live link; finalize README with documented tolerance thresholds.

---

## 11. Job Templates

- **Template A — Protocol Treasury Diligence (required)**: e.g. "Assess Protocol X before treasury deployment." Subtasks: TVL + trend, treasury/labeled-wallet flows, news/governance summary, compliance red flags, overall risk memo + rating.
- **Template B — Yield Opportunity Review (stretch)**: same specialists, different emphasis (liquidity depth + smart-contract risk over governance history).

---

## 12. Demo Script (required narrative beats)

1. Submit a job with a budget.
2. Specialist agents get called and paid a small nanopayment for responding.
3. Evaluator checks at least one claim live against an external source on-screen (e.g., TVL vs. DefiLlama).
4. **One job passes verification → full payment released.**
5. **One job/specialist fails verification → payment withheld or reduced** (the most important scene — most competing demos will only show the happy path).
6. Reputation dashboard reflects the updated outcome.

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| External API rate limits/outages during live demo | Cache recent responses per job; keep a pre-verified fallback job ready |
| Tolerance thresholds look arbitrary/gameable | Document exact thresholds in README; keep simple (e.g., ±5%), not demo-tuned |
| Evaluator's LLM step adds non-determinism | LLM scoped strictly to schema extraction; accept/reject is rule-based |
| Escrow/slashing contract complexity eats the timeline | Default to signed-attestation conditional release instead of a full smart contract if behind schedule |
| Only 2 specialists ship | Acceptable — compliance agent is explicitly a stretch goal |
| Traction is hard to fake genuinely in 3 weeks | Prioritize running many real jobs over building more features |

---

## 14. Open Questions (unresolved as of this doc)

1. Which chain do on-chain/block-explorer checks target — Arc itself, or whatever chain the diligenced protocol actually lives on? Determines which explorer API to integrate.
2. Does the compliance/filings agent ship at all for MVP, scoped to one public sanctions list, or get dropped in favor of a stronger 2-agent Template A?
3. Real smart-contract escrow on Arc, or simplified signed-attestation pattern? (PRD recommends attestation-based for MVP given the timeline.)

---

## 15. Competitive Positioning (for README/pitch narration)

ArcProof is not competing with horizontal infra (x402, ERC-8004-style registries, Olas, Kite AI, Nevermined) — those give identity, discovery, payment rails, and generic escrow/evaluator primitives. ArcProof is the finance-vertical application layer that defines what "correct financial work" means and enforces it at the payment layer.

---

## Understanding check (my read on the priorities)

- The **evaluator's independent-verification step is the entire differentiator** — the judging rubric (Innovation 20%, Agentic sophistication 30%) both hinge on this being a real autonomous accept/reject decision against live data, not a hardcoded rule or a rubber stamp.
- **Traction (30%) is weighted equal to agentic sophistication** — this pushes us to actually run many real jobs against real protocols during the build window, not just polish one scripted demo path. That's a scope/time trade-off worth planning for in Week 3.
- **Payment must fail in the demo, not just succeed** — the PRD and hackathon judging both flag that most competing teams will only show the happy path; the rejected/partial-payment scene is treated as the single most important part of the video.
- Per-specialist (not per-job) payment settlement is what makes the "one agent gets paid, another in the same job doesn't" story legible — this is a data-model decision (claims tied to `provider_agent_id`, settlement computed per agent) not just a narrative choice.
- Everything is scoped to keep verdicts **deterministic and auditable**: LLM only touches schema extraction, never the accept/reject decision itself. This is a hard constraint to preserve if we're tempted to make the evaluator "smarter" later.

No code has been written — this file is purely a structured reference of the PRD and hackathon rules for planning purposes.