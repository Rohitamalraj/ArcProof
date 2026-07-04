# ArcProof agent-ts

TypeScript port of the ArcProof/VeriFi Agents backend (`../agent/`, kept as
the Python reference implementation, untouched). Same bonded, multi-agent
financial diligence network -- specialist agents get paid only after an
evaluator independently re-checks their claims against live external data,
settled with real transactions on Arc testnet.

This is **Phase 1** of a 3-phase plan: (1) this fully working TS port, (2)
test it end to end, (3) *later, separately* extract the reusable core into
a published SDK with LangChain.js and ElizaOS adapters. Phase 3 is not
started here -- this folder is a real, standalone, testable system on its
own, fully independent from `../agent/` and `../frontend/`.

## Two deliberate corrections vs. the Python reference

1. **The evaluator is deterministic code, not an LLM judgment call.** The
   Python version's evaluator asks an LLM to "judge" match/mismatch with
   ~5% offered only as a guideline. The PRD is explicit that this decision
   needs to be rule-based so verdicts stay auditable -- here,
   `packages/core/src/evaluator.ts` has zero LLM calls: it looks up the
   canonical independent source for each claim type, compares the claimed
   value against it with a fixed rule, and returns a verdict anyone can
   redo by hand. See "Verification rules" below for the exact thresholds.
2. **Every role can have a real Circle Developer-Controlled Wallet, not
   just `requester`.** The Python version only ever wired one role, off by
   default, undocumented. Here, `requester`, `orchestrator`, and all 3
   specialists can independently route through
   `@circle-fin/developer-controlled-wallets` when configured -- see
   "Circle Wallets setup" below.

Everything else (data sources, x402 wire shape, payout math, claim
taxonomy) is ported as-is.

## Architecture

```
Requester --submits job+budget--> Orchestrator :8000 (real x402 payments)
                                        |
                    +-------------------+-------------------+
                    v                   v                   v
          On-chain agent :8001   News agent :8002   Compliance agent :8003
           (TVL, price,          (governance,         (OFAC sanctions
            wallet flow,          news incidents)       screening)
            concentration)
                    |                   |                   |
                    +-------------------+-------------------+
                                        v
                              Evaluator :8004
                  (deterministic -- re-derives every claim from an
                   independent live source, zero LLM in the decision)
                                        v
                         Settlement (packages/core/src/settlement.ts)
              real Arc testnet transfers, per-specialist accuracy,
                    reputation update, no local balance file
```

Every agent is its own Fastify process on its own port with its own real
EVM wallet on Arc testnet (or a real Circle-managed wallet, see below).
Payments between them are real mined transactions, not database writes.

## Project layout

```
packages/
  core/        @arcproof/core -- no HTTP, no LLM framework dependency
    src/schema.ts             zod wire schema (Claim, JobRequest, JobRecord, ...)
    src/config.ts             env loading, per-role wallets (plain + Circle)
    src/chain.ts              viem: native-USDC transfer + independent verify
    src/wallet.ts             role-keyed balance/transfer helpers
    src/circleWallet.ts       Circle Developer-Controlled Wallets client, every role
    src/escrowContract.ts     lock/release/finalize/refund against VeriFiEscrow
    src/x402.ts               402 handshake, exact-native settlement
    src/dataSources/          defillama, price, explorer, governance, news, sanctions
    src/evaluator.ts          DETERMINISTIC verification -- no LLM
    src/settlement.ts         verdict + per-specialist payout math
    src/store.ts              JSON-file job + reputation storage
  services/    @arcproof/services -- Fastify HTTP services + LangChain.js agents
    src/llm.ts, agentSchemas.ts, tools.ts, langchainPlanner.ts
    src/orchestrator.ts, evaluatorService.ts
    src/specialists/{onchainAgent,newsAgent,complianceAgent}.ts
    src/cli/runDemo.ts
  contracts/   compiled VeriFiEscrow ABI/bytecode (reused, not recompiled) + deploy.ts
scripts/
  generate-wallets.ts   fresh plain wallet per role
  circle-setup.ts       provisions real Circle-managed wallets per role
```

## Setup

```bash
cd agent-ts
npm install
cp .env.example .env
```

Fill in `.env`:
- At least one LLM key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
  `GOOGLE_API_KEY`) -- every specialist and the orchestrator's planner are
  real LangChain.js tool-calling agents.
- Wallets: run `npm run gen-wallets` to generate a fresh plain keypair per
  role (prints them and writes `.env` if one doesn't exist yet).

Before deploying, fund the **`escrow`** wallet at
**https://faucet.circle.com** (select Arc testnet, no account needed, ~20
USDC per address per 2 hours) -- it's the deployer and pays the contract
creation gas. Then:
```bash
npm run deploy-contract     # deploys a fresh VeriFiEscrow, writes the address
```

Before running anything that moves money, also fund `requester` and
`orchestrator` the same way. `npm run demo` checks real balances up front
and prints the exact addresses to fund if any are empty.

## Circle Wallets setup (optional, real, per role)

Unconfigured, every role falls back to its plain private key above -- the
system is fully functional without this section. To make a role's payments
actually flow through Circle's own managed-wallet product instead:

1. Get an API key at console.circle.com/api-keys, put it in
   `CIRCLE_API_KEY`.
2. Generate + register an entity secret once (semi-irreversible, do this
   exactly once per Circle account):
   ```bash
   node -e "require('@circle-fin/developer-controlled-wallets').generateEntitySecret()"
   # copy the printed secret into CIRCLE_ENTITY_SECRET in .env, then:
   node -e "require('dotenv/config'); require('@circle-fin/developer-controlled-wallets').registerEntitySecretCiphertext({apiKey: process.env.CIRCLE_API_KEY, entitySecret: process.env.CIRCLE_ENTITY_SECRET}).then(r => console.log(r.data?.recoveryFile))"
   ```
3. Provision a wallet set + one Circle-managed wallet per role you want
   Circle-backed (any subset -- all 5 non-`escrow` roles are supported):
   ```bash
   npx tsx scripts/circle-setup.ts requester orchestrator onchain-agent-v1 news-agent-v1 compliance-agent-v1
   ```
   Paste the printed `CIRCLE_WALLET_ID_*`/`CIRCLE_ADDRESS_*` lines into
   `.env`.
4. Fund each printed Circle wallet address at faucet.circle.com same as any
   other role.

From here, `lock()`/`release()`/`finalize()`/`refund()` (escrowContract.ts)
automatically route through the Circle-managed wallet for any role that has
one configured, falling back to the plain key otherwise -- no other code
changes needed.

## Verification rules (documented per the PRD's auditability requirement)

Defined in `packages/core/src/evaluator.ts`:
- **Numeric claims** (`tvl`, `price_change`, `token_concentration`): match
  if the claimed value is within **+/-5%** (relative to the
  independently-fetched value) of that value.
- **Categorical booleans** (`wallet_flow`, `compliance_flag`): match only
  if the claimed boolean exactly equals the independently-fetched boolean.
  The independent lookup uses a canonical address (protocol treasury /
  job's own `target_address`), never the claim's own text.
- **`governance_event`**: match if the claimed value case-insensitively
  matches the independently-refetched most-recent-closed-proposal's title
  or winning choice.
- **`news_incident`**: 0 independent corroborating domains -> **mismatch**
  (looks fabricated); exactly 1 -> **unverifiable** (PRD's explicit
  single-source rule -- some evidence, not enough to confirm, doesn't count
  against the provider); 2+ -> **match**.
- Any claim type with no independent source available, or whose lookup
  itself fails, is **unverifiable** and never counts toward mismatches.

Per-specialist payout and job-verdict thresholds (`packages/core/src/settlement.ts`,
unchanged from the reference):
- Payout: full if 0 mismatches, 50% if exactly 1, withheld if 2+.
- Job verdict: accept if 0 mismatches; partial if 1; reject if a majority
  of checkable claims mismatch. A `compliance_flag` mismatch always blocks
  a clean "accept" (a floor, not a ceiling).

## Running it

```bash
npm run demo   # boots all 5 services, checks balances, interactive job prompts
```

To reproduce the two canonical demo scenes:
- **Clean accept**: request something like "Assess Uniswap before treasury
  deployment", protocol `uniswap`, leave target address/fault blank ->
  every claim independently re-derived -> `ACCEPT`, every specialist paid
  in full, real transactions.
- **Caught lie**: request an Aave assessment, protocol `aave`, paste in the
  real OFAC-sanctioned address the prompt suggests, choose `compliance` at
  the fault prompt -> the compliance agent is told to lie -> the
  deterministic evaluator's independent sanctions check catches it exactly
  -> payout cut, real (smaller) transfer.

Run `npx tsx packages/services/src/cli/runDemo.ts` (no `--demo`) to just
boot the services and submit jobs from another terminal, e.g. `POST
http://127.0.0.1:8000/jobs`. Every transfer prints its real transaction
hash; look it up on `https://testnet.arcscan.app` for independent proof.

### Separate terminals

```bash
npm run onchain-agent --workspace=@arcproof/services
npm run news-agent --workspace=@arcproof/services
npm run compliance-agent --workspace=@arcproof/services
npm run evaluator --workspace=@arcproof/services
npm run orchestrator --workspace=@arcproof/services
```

## Frontend integration

The orchestrator (`:8000`) is the only surface a frontend needs:
- `POST /jobs` -- submit a job, returns the full `JobRecord` once complete.
- `GET /jobs/:id`, `GET /jobs`, `GET /reputation`, `GET /wallets`.

CORS isn't configured yet -- add `@fastify/cors` to `orchestrator.ts` once
the frontend's dev origin is known. (No changes to `../frontend/` are made
by this phase.)

## Known limitations (carried over from the PRD's own risk list)

- `token_concentration` is always simulated -- no free real data source
  for holder distribution.
- `compliance_flag` checks a static OFAC snapshot, not a live-fetched feed.
- No auth/rate-limiting -- fine for a local testnet demo.
- No caching of external API calls per job yet.
