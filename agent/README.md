# VeriFi Agents -- backend

Bonded, multi-agent financial diligence network: specialist agents get paid
only after an evaluator independently re-checks their claims against live
external data. Every payment in this codebase is a real, mined transaction
on Arc's public testnet -- there is no mock ledger, no fake balances, no
simulated settlement. The frontend is being built separately and
integrates against the orchestrator's HTTP API (see "Frontend
integration" below).

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
                    (re-derives every claim from an independent
                     live source, rule-based match/mismatch/unverifiable)
                                        v
                         Settlement (settlement/escrow.py)
              real Arc testnet transfers, per-specialist accuracy,
                    reputation update, no local balance file
```

Every agent is its own FastAPI process on its own port with its own real
EVM wallet on Arc testnet. Payments between them are real mined
transactions, not database writes.

## Why Arc testnet + raw wallets instead of Circle Developer-Controlled Wallets

Arc's own docs (docs.arc.io/arc/references/connect-to-arc and
.../contract-addresses) turn out to make this much simpler than the
original plan assumed:

- **The RPC is public and needs no signup**: `https://rpc.testnet.arc.network`, chain id `5042002`.
- **USDC is Arc's native gas-equivalent currency**, not a separate ERC-20 you have to approve/transfer -- moving USDC on Arc is a standard signed value transfer, exactly like sending ETH on Ethereum. The `0x3600...` address is only an *optional* ERC-20 read-view over that same native balance.
- **The faucet is public and needs no signup**: `https://faucet.circle.com`, up to 20 USDC per address every 2 hours.

Given that, a keypair generated locally with `eth_account` (no account,
no entity-secret registration, no OAuth) is a fully real, fundable,
spendable wallet on a real public testnet. That's what every agent role
uses here. Circle's Developer-Controlled Wallets SDK (installed,
`circle-developer-controlled-wallets`) and the full `x402` package's
EIP-3009 gasless-authorization "exact" EVM scheme (also installed) remain
documented upgrade paths -- see `payments/x402.py`'s docstring for exactly
why they weren't needed for this baseline and what swapping to them looks
like.

## What's real right now

| Piece | Status |
|---|---|
| `tvl` | **Live** -- DefiLlama, no key |
| `price_change` | **Live** -- CoinGecko, no key |
| `governance_event` | **Live** -- Snapshot GraphQL, no key |
| `news_incident` | **Live** -- GDELT DOC 2.0 API, no key. "Corroborated" means literally 2+ distinct reporting domains in the lookback window. |
| `compliance_flag` | Real OFAC-designated addresses (Tornado Cash, 2022-08-08), static local snapshot rather than a live per-request pull of the full SDN list -- see `fixtures/sanctioned_addresses.json` for provenance and the swap-to-live-feed note |
| `wallet_flow` | **Live** via Etherscan if `ETHERSCAN_API_KEY` is set; deterministic simulated fallback (explicitly flagged `simulated: true`) otherwise |
| `token_concentration` | Simulated (flagged `simulated: true`) -- real holder-distribution data needs Etherscan's paid tier |
| **x402 payments** | **Real** -- every specialist call is a real 402 response, a real signed Arc testnet transaction, and a real on-chain verification before the resource is served |
| **Settlement** | **Real** -- escrow lock, per-specialist payout, and withheld amounts are real Arc testnet transfers (payments/chain.py) |
| **Orchestrator planning** | **Real LLM decision** via LangChain (`langchain.agents.create_agent`) when `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set; falls back to the fixed PRD Template A/B specialist list otherwise (see `agents/orchestrator.py`) |

## Environment setup

Copy `.env.example` conventions into `.env` (a starter `.env` with freshly
generated testnet wallets is already in this repo -- see below):

```bash
ARC_RPC_URL=https://rpc.testnet.arc.network      # public, no key
ARC_CHAIN_ID=5042002
USDC_CONTRACT_ADDRESS=0x3600000000000000000000000000000000000000
ARC_EXPLORER_URL=https://testnet.arcscan.app

REQUESTER_ADDRESS=...            REQUESTER_PRIVATE_KEY=...
ORCHESTRATOR_ADDRESS=...         ORCHESTRATOR_PRIVATE_KEY=...
ESCROW_ADDRESS=...               ESCROW_PRIVATE_KEY=...
ONCHAIN_AGENT_ADDRESS=...        ONCHAIN_AGENT_PRIVATE_KEY=...
NEWS_AGENT_ADDRESS=...           NEWS_AGENT_PRIVATE_KEY=...
COMPLIANCE_AGENT_ADDRESS=...     COMPLIANCE_AGENT_PRIVATE_KEY=...

ANTHROPIC_API_KEY=               # required for the real LangChain orchestrator
# OPENAI_API_KEY=                # alternative to Anthropic

ETHERSCAN_API_KEY=               # optional -- upgrades wallet_flow to live data
```

**Before running anything that moves money**, fund `requester` and
`orchestrator` at **https://faucet.circle.com** (select Arc testnet --
no account needed, ~20 USDC per address per 2 hours). `python -m
cli.run_demo` checks real balances up front and prints the exact
addresses to fund if either is empty, rather than failing mid-job.

Generate a fresh wallet set yourself any time with:
```bash
python -c "
from eth_account import Account
for role in ['requester','orchestrator','escrow','onchain-agent-v1','news-agent-v1','compliance-agent-v1']:
    a = Account.create()
    print(role, a.address, a.key.hex())
"
```

## Verdict rules (documented per the PRD's auditability requirement)

Defined in `settlement/escrow.py`:
- Numeric claims (`tvl`, `price_change`, `token_concentration`) match if
  within **±5%** of the independently-sourced value.
- Per-specialist payout: **full** if 0 of its claims mismatch, **50%** if
  exactly 1 mismatches, **withheld** if 2+ -- and it's a real transfer
  either way (or a real non-transfer, for withheld amounts).
- Job-level verdict: **accept** if 0 mismatches, **partial** if 1
  mismatch, **reject** if a majority of checkable claims mismatch. A
  `compliance_flag` mismatch is a floor (blocks a clean "accept") not a
  ceiling.
- Unverifiable claims never count toward mismatches or payment.

## Running it

```bash
cd verifi-agents
pip install -r requirements.txt
# fund requester + orchestrator at faucet.circle.com first (see above)
python -m cli.run_demo
```

This boots all 5 services in one process, reads real balances, and (if
funded) runs:
1. **Job 1** (Uniswap, no faults) -- every claim checked against a live
   source or the real Arc chain -> `ACCEPT`, every specialist paid in
   full, real transactions.
2. **Job 2** (Aave) -- the compliance agent is told to lie about a real,
   publicly-designated OFAC SDN address (a Tornado Cash contract,
   sanctioned 2022-08-08) -- the evaluator's independent sanctions check
   catches it -> `PARTIAL`, the compliance agent's payout is cut in half
   via a real (smaller) transfer, the other two specialists still get
   paid in full.

Every transfer prints its real transaction hash to the terminal; look it
up on Arc's testnet explorer for independent proof.

### Separate terminals (matches the PRD's original per-agent layout)

```bash
python -m agents.specialists.onchain_agent      # :8001
python -m agents.specialists.news_agent         # :8002
python -m agents.specialists.compliance_agent   # :8003
python -m agents.evaluator                      # :8004
python -m agents.orchestrator                   # :8000
```

```bash
curl -X POST http://127.0.0.1:8000/jobs -H "Content-Type: application/json" -d '{
  "request_text": "Assess Lido before treasury deployment.",
  "template": "protocol_treasury_diligence",
  "budget_usdc": 0.3,
  "protocol_slug": "lido"
}'
```

Add `"inject_fault": "onchain" | "news" | "compliance"` to force that
specialist to fabricate a claim and watch the evaluator catch it against
the live/on-chain source.

## Frontend integration

The orchestrator (`:8000`) is the only surface a frontend needs:

- `POST /jobs` -- submit a `JobRequest` (see `shared/schema.py`), returns
  the full `JobRecord` once the job completes (memo, per-claim
  verification, real payouts, verdict). Synchronous -- a job resolves in
  the time it takes a handful of real transactions to mine on Arc
  testnet (seconds, not long-running).
- `GET /jobs/{job_id}` -- refetch a completed job.
- `GET /jobs` -- list all jobs.
- `GET /reputation` -- per-provider accuracy for the reputation dashboard.
- `GET /wallets` -- live Arc testnet balances for every role, useful for
  a "real payments happening" view.

CORS isn't configured yet -- add `fastapi.middleware.cors.CORSMiddleware`
to `agents/orchestrator.py` once the frontend's dev origin is known.

## Upgrade paths (installed, documented, not wired in yet)

- **Full x402 EIP-3009 "exact" EVM scheme** (`x402` package, already
  installed): gasless authorizations via a self-hosted or third-party
  facilitator. Not needed today because USDC is Arc's native gas token --
  a payer already needs native balance, so there's no gasless advantage
  to unlock. See `payments/x402.py` docstring for the exact classes
  (`register_exact_evm_client/server/facilitator`) to wire in later.
- **Circle Developer-Controlled Wallets** (`circle-developer-controlled-wallets`,
  already installed): swaps raw `eth_account` keys for Circle-managed
  keys behind an entity-secret-encrypted API. Useful once this needs to
  run outside a hackathon context (key custody, compliance guardrails),
  not needed to prove the payment logic works today.
- **verifi_sdk packaging, epoch batching, multi-chain registration**: not
  built -- genuinely roadmap, not pretend-done.

## Project layout

```
shared/               wire schema, config (real wallets + Arc network config), terminal logging
payments/
  chain.py                 real Arc testnet transfers + verification (web3.py + eth_account)
  wallet.py                role-keyed balance/transfer helpers on top of chain.py
  x402.py                  402 handshake settled via real on-chain transactions
data_sources/          DefiLlama, CoinGecko, Snapshot, Etherscan, GDELT, OFAC-fixture connectors
agents/
  orchestrator.py           owns the job lifecycle; real x402 payments; LLM or template decomposition
  langchain_planner.py      real LangChain tool-calling agent for specialist selection + memo writing
  evaluator.py              independent claim verification, rule-based
  specialists/              onchain_agent.py, news_agent.py, compliance_agent.py
settlement/escrow.py   verdict + per-specialist payout rules -> real transfers
storage/store.py       JSON-file-backed job + reputation metadata (not payment state -- that's on-chain)
cli/run_demo.py        boots all 5 services, checks real balances, runs the two demo jobs
fixtures/              curated real OFAC SDN address snapshot
```

## Known limitations (tracked, not blocking)

- `token_concentration` is always simulated -- no free real data source
  exists for holder distribution; flagged `simulated: true` throughout.
- `compliance_flag` checks a static, real snapshot of OFAC designations
  rather than a live-fetched full SDN list -- swap point documented in
  `fixtures/sanctioned_addresses.json`.
- No auth/rate-limiting on any endpoint -- fine for a local demo against
  a testnet, not for a public deployment.
- Gas costs are real (tiny, but real) on top of every USDC amount moved --
  demo job budgets are kept small (`JOB_BUDGET_USDC` in `cli/run_demo.py`)
  to leave headroom under the faucet's 20 USDC/2hr cap across repeated runs.
