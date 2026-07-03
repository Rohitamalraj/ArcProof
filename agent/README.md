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
                    (real LLM tool-calling agent -- re-derives every
                     claim from an independent live source and judges
                     match/mismatch/unverifiable itself)
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
| **x402 payments** | **Real** -- 402 response and payment-proof payload use the real installed `x402` package's wire schema (`x402.schemas.payments`); settlement is a real signed Arc testnet transaction independently re-verified on-chain before the resource is served (see `payments/x402.py` docstring for why the package's EIP-3009 "exact" scheme isn't used) |
| **Settlement / escrow** | **Real smart contract** -- `contracts/VeriFiEscrow.sol`, deployed on Arc testnet. Lock/release/finalize/refund are real contract calls (`payments/escrow_contract.py`), not application-level wallet transfers -- the contract itself holds locked job budgets and enforces who can release/refund (only the orchestrator's wallet, set as `settler` at deploy time) |
| **Every agent** | **Real LLM tool-calling agent** (`langchain.agents.create_agent`) -- orchestrator (planning + memo), all 3 specialists (claim gathering), and the evaluator (independent verdicts) each make a real model call with real tools bound. No rule-based/template fallback exists anywhere: a failed LLM call fails that step loudly (empty claims, or the job fails and escrow refunds) rather than silently substituting a fixed decision. See `agents/llm.py`, `agents/tools.py`. |

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

# Optional: one Gemini key per agent role instead of all 5 sharing
# GOOGLE_API_KEY. Free tier is 20 requests/day *per key*, and every agent
# (orchestrator, 3 specialists, evaluator) now makes real LLM calls -- a
# single job can burn 5-6+ requests, so one shared key exhausts fast.
# Any role left unset falls back to GOOGLE_API_KEY. See agents/llm.py.
GOOGLE_API_KEY_ORCHESTRATOR=
GOOGLE_API_KEY_ONCHAIN=
GOOGLE_API_KEY_NEWS=
GOOGLE_API_KEY_COMPLIANCE=
GOOGLE_API_KEY_EVALUATOR=
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
python -m cli.run_demo --demo
```

This boots all 5 services in one process, reads real balances, then
interactively prompts you for jobs to submit -- request text, protocol
slug, budget, an address to screen, and an optional fault to inject.
Nothing is scripted: what happens is whatever you actually ask for.

To reproduce the two canonical demo scenes:

- **A clean accept**: request something like "Assess Uniswap before
  treasury deployment", protocol `uniswap`, leave the target address and
  fault prompts blank -> every claim checked against a live source or the
  real Arc chain -> `ACCEPT`, every specialist paid in full, real
  transactions.
- **A caught lie**: request an Aave assessment with compliance screening,
  protocol `aave`, paste in the real OFAC-sanctioned address the prompt
  suggests (a Tornado Cash contract, sanctioned 2022-08-08), and choose
  `compliance` at the fault prompt -- the compliance agent is told to lie
  about that address, and the evaluator's independent sanctions check
  catches it -> payout cut, real (smaller) transfer.

Run `python -m cli.run_demo` (no `--demo`) to just boot the services and
submit jobs from another terminal instead, e.g. `POST
http://127.0.0.1:8000/jobs`. Every transfer prints its real transaction
hash to the terminal; look it up on Arc's testnet explorer for
independent proof.

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

- **Full x402 EIP-3009 "exact" EVM scheme** (`x402` package): this
  project *does* use the real installed `x402` package now -- the 402
  response body and payment-proof payload are genuine
  `x402.schemas.payments.PaymentRequired`/`PaymentRequirements`/
  `PaymentPayload` types (`payments/x402.py`), spec-parseable by any
  x402 client. What's *not* adopted is the package's registered EVM
  "exact" scheme (`mechanisms/evm/exact/`), because it's built on EIP-3009
  `transferWithAuthorization` -- a function only a real ERC-20 *contract*
  implements, and Arc's USDC is native currency, not an ERC-20 (the
  `0x3600...` address is only an optional read-view). Settlement uses a
  custom `scheme="exact-native"` instead: a direct signed transfer,
  independently re-verified on-chain -- same trust model, just no
  gasless-authorization machinery a native-gas-token chain doesn't need.
  See `payments/x402.py`'s docstring for the full reasoning and the
  `register_exact_evm_client/server/facilitator` classes if this ever
  needs to run against a chain where USDC really is an EIP-3009 ERC-20.
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
contracts/
  VeriFiEscrow.sol          on-chain escrow contract: lock/release/finalize/refund per job
  compile.py, deploy.py     solcx compile + web3.py deploy to Arc testnet
  VeriFiEscrow.json, deployed_address.txt   compiled ABI/bytecode + the live deployed address
payments/
  chain.py                 real Arc testnet transfers + verification (web3.py + eth_account)
  wallet.py                role-keyed balance/transfer helpers on top of chain.py
  escrow_contract.py       lock/release/finalize/refund calls against the deployed VeriFiEscrow contract
  x402.py                  402 handshake using the real x402 package's wire schema, settled on-chain
data_sources/          DefiLlama, CoinGecko, Snapshot, Etherscan, GDELT, OFAC-fixture connectors
agents/
  llm.py                    per-role LLM model selection (5 separate Gemini keys supported, see .env.example)
  tools.py                  LangChain tool wrappers around data_sources/*, shared by specialists + evaluator
  agent_schemas.py          structured-output schemas (ClaimDraft, ClaimVerdict) every agent's LLM call is constrained to
  orchestrator.py           owns the job lifecycle; real x402 payments; LLM-only decomposition (no template fallback)
  langchain_planner.py      real LangChain tool-calling agent for specialist selection + memo writing
  evaluator.py              real LLM tool-calling agent -- independent claim verification, own judgment call
  specialists/              onchain_agent.py, news_agent.py, compliance_agent.py -- each a real LLM tool-calling agent
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
