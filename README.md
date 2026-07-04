# ArcProof

A bonded, multi-agent financial diligence network. Specialist AI agents research a
protocol; an evaluator agent independently re-checks every claim they make against
live external data; only verified work releases payment. Settled in USDC on Arc.

> AI agents only get paid and build reputation when an evaluator verifies their
> financial claims against live data.

## The problem this solves

Agent payment rails (x402) and agent identity/reputation registries already exist,
but none of them tell you whether the *work* an agent did was actually true. A
payment record only proves money moved, not that the analysis behind it was
correct. ArcProof adds that missing trust layer: conditional payment, claim-level
verification, and reputation tied to accuracy rather than raw activity.

## How it works

```
Requester (web UI)
      │  submits job + budget
      ▼
Orchestrator  ──calls──►  Specialist agents (on-chain data / news / compliance)
      │                            each paid a small fee just for responding
      │  assembles their claims
      ▼
Evaluator
      │  independently re-derives every claim from a live source it
      │  chooses itself -- never trusts the specialist's own source
      ▼
Settlement
      │  pays each specialist based on ITS OWN accuracy, not the job's
      │  overall verdict -- real USDC transfers through a deployed
      │  escrow contract on Arc
      ▼
Reputation store ──► Dashboard
```

A job can come back **accept** (every claim checked out, everyone paid in full),
**partial** (some claims didn't hold up, affected specialists get a reduced cut),
or **reject** (most claims were wrong) -- and every verdict is backed by a real,
independently-re-run check anyone can audit.

## Repository layout

| Path | What it is | Status |
|---|---|---|
| `frontend/` | Next.js marketing/landing site | Landing page complete; the actual job-submission dashboard (`/app`) is still a placeholder, not yet wired to a backend |
| `agent-ts/` | TypeScript backend -- orchestrator, 3 specialists, evaluator, settlement | **Primary, working implementation.** Real Arc testnet contract, real payments, real LangChain.js agents, deterministic evaluator. All three outcomes (accept/partial/reject) proven end-to-end with real transactions |
| `agent/` | Python backend -- same architecture | Original reference implementation. Kept as-is; not the direction new work should build on (see "Two backends" below) |
| `HACKATHON.md` | Origin PRD / event reference | Historical context for why this exists -- not required reading to use the product |

## What's real right now (`agent-ts`)

- **Live data, not mocks**: TVL from DefiLlama, price from CoinGecko, governance
  from Snapshot, news corroboration from GDELT, a real (if static) OFAC sanctions
  snapshot. Anything that had to be simulated (`token_concentration`, `wallet_flow`
  without an Etherscan key) is explicitly flagged `simulated: true` end to end,
  never silently faked.
- **Real money**: every payment -- the small per-response fee and the larger
  conditional payout -- is a mined transaction on Arc testnet through a deployed
  `VeriFiEscrow` contract. Nothing is a local ledger entry.
- **A deterministic evaluator**: the accept/mismatch/unverifiable decision is
  plain, auditable code (fixed ±5% numeric tolerance, exact boolean/entity
  matching) -- never an LLM's judgment call. See `agent-ts/README.md` for the
  exact rules per claim type.
- **Real agentic decision-making**: which specialists to call, what to claim, and
  how to write the final memo are all real LLM tool-calling agent decisions, not
  a hardcoded template.

## Getting started

**Backend** (see `agent-ts/README.md` for full setup, wallet funding, and Circle
Wallets instructions):
```bash
cd agent-ts
npm install
cp .env.example .env   # fill in an LLM key + fund the generated wallets
npm run deploy-contract
npm run demo
```

**Frontend**:
```bash
cd frontend
npm install
npm run dev
```

The two aren't connected yet -- see "What's left" below.

## What's left to make this a complete product

Roughly in the order it matters:

1. **Connect the frontend to `agent-ts`.** The frontend is a polished landing
   page; the real product screen (submit a job, watch specialists get paid,
   watch the evaluator check claims live, see the verdict and updated
   reputation) doesn't exist yet. This is the single biggest gap between "two
   things that work" and "one working product."
2. **Pick one backend going forward.** Running both `agent/` and `agent-ts/`
   indefinitely will just create confusion about which one is the real
   implementation. `agent-ts` is the more correct and further-along one
   (deterministic evaluator, wider Circle Wallets support) -- worth explicitly
   retiring `agent/` to reference-only status.
3. **Turn on Circle Wallets for real.** The code supports every agent role
   holding a genuine Circle-managed wallet; it just hasn't been switched on yet
   (needs `agent-ts/scripts/circle-setup.ts` run once, then funding).
4. **Fix the zero-claims edge case.** If every specialist fails to respond on a
   job, it currently still gets marked `accept` and the requester's locked
   budget stays stuck in the escrow contract forever instead of being refunded.
5. **Add basic auth/rate-limiting** before this ever runs anywhere reachable
   by someone other than you.

## License

Not yet decided.
