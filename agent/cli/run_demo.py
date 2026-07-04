"""Terminal runner: boots all 5 VeriFi Agents services in one process,
checks real Arc testnet balances, then leaves the services running so you
(or a frontend) can submit jobs against http://127.0.0.1:8000 directly.

By default this does NOT submit any jobs itself -- it only starts the
services and waits, so the only jobs that ever run are ones you actually
ask for. Pass --demo to interactively submit real jobs from this terminal
-- every job's request_text/protocol/budget/fault choice comes from
whatever you type at the prompt, not a hardcoded script. Nothing here
scripts a fixed "job 1 accepts, job 2 rejects" outcome; if you want to
demonstrate the evaluator catching a lie, choose to inject a fault
yourself when prompted -- the claim, the verification, and the payout cut
are all still real.

Every payment in any run is a real, mined Arc testnet transaction -- there
is no mock ledger left in this codebase. Fund the `requester` and
`orchestrator` wallets at https://faucet.circle.com (network: Arc
testnet) before running this; the script checks balances up front and
tells you exactly what's missing rather than failing deep in a job run.

Run from the verifi-agents/ directory:
    python -m cli.run_demo            # services only, no jobs submitted
    python -m cli.run_demo --demo     # services + an interactive job-submission loop
"""
from __future__ import annotations
import asyncio
import sys
import time

import httpx
import uvicorn
from rich.table import Table
from rich.panel import Panel

from shared.console import get_console, rule, log
from shared.config import (
    ORCHESTRATOR_PORT, ONCHAIN_AGENT_PORT, NEWS_AGENT_PORT,
    COMPLIANCE_AGENT_PORT, EVALUATOR_PORT, ORCHESTRATOR_URL, ARC_RPC_URL, ARC_CHAIN_ID,
)
from payments import chain
from payments.wallet import ledger

from agents.orchestrator import app as orchestrator_app
from agents.evaluator import app as evaluator_app
from agents.specialists.onchain_agent import app as onchain_app
from agents.specialists.news_agent import app as news_app
from agents.specialists.compliance_agent import app as compliance_app

console = get_console()

SERVICES = [
    ("orchestrator", orchestrator_app, ORCHESTRATOR_PORT),
    ("evaluator", evaluator_app, EVALUATOR_PORT),
    ("onchain-agent-v1", onchain_app, ONCHAIN_AGENT_PORT),
    ("news-agent-v1", news_app, NEWS_AGENT_PORT),
    ("compliance-agent-v1", compliance_app, COMPLIANCE_AGENT_PORT),
]

# Suggested defaults shown in the interactive prompt -- never auto-assigned.
# The sanctioned one is a real, publicly-documented OFAC SDN address
# (Tornado Cash, designated 2022-08-08), offered so anyone wanting to
# demo the compliance-catch scene doesn't have to go find a real one.
SANCTIONED_DEMO_ADDRESS = "0x8589427373d6d84e98730d7795d8f6f8731fda0"
CLEAN_DEMO_ADDRESS = "0x0000000000000000000000000000000000dead"

# Suggested default budget -- kept small since real gas + real per-call
# nanopayments come out of these wallets too, and the faucet caps at 20
# USDC / address / 2 hours. Any value can be typed at the prompt instead.
JOB_BUDGET_USDC = 0.30


def build_servers() -> list[tuple[str, uvicorn.Server]]:
    servers = []
    for name, app, port in SERVICES:
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        server = uvicorn.Server(config)
        server.install_signal_handlers = False
        servers.append((name, server))
    return servers


async def wait_until_ready(port: int, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    async with httpx.AsyncClient() as client:
        while time.time() < deadline:
            try:
                r = await client.get(f"http://127.0.0.1:{port}/openapi.json")
                if r.status_code < 500:
                    return
            except Exception:
                pass
            await asyncio.sleep(0.2)
    raise RuntimeError(f"service on port {port} did not become ready in time")


def check_real_balances() -> bool:
    """Reads live balances from Arc testnet. Returns False (with clear
    instructions) instead of letting a job fail deep inside a transfer.

    The requester role now locks budget exclusively through its real
    Circle-managed wallet (payments/escrow_contract.py's lock(), no
    eth_account fallback) -- so it's that wallet's on-chain balance that
    gates the demo, not the eth_account `requester` wallet's (which is no
    longer spent by lock() at all)."""
    rule("REAL ARC TESTNET BALANCES (live RPC read, not a local ledger)")
    console.print(f"  RPC: {ARC_RPC_URL}  |  chain id: {ARC_CHAIN_ID}  |  connected: {chain.is_connected()}\n")

    balances = {k: v for k, v in ledger.all_balances().items() if k != "requester"}
    if CIRCLE_REQUESTER_ADDRESS:
        balances["requester-circle"] = chain.get_balance_usdc(CIRCLE_REQUESTER_ADDRESS)
    for role, bal in balances.items():
        console.print(f"  {role:22s} {bal:12.6f} USDC")

    addresses = {**{r: ledger.role_address(r) for r in ledger.all_balances()}, "requester-circle": CIRCLE_REQUESTER_ADDRESS}
    needed = {"requester-circle": JOB_BUDGET_USDC * 2, "orchestrator": 0.05}
    missing = [role for role, min_amount in needed.items() if balances.get(role, 0) < min_amount]
    if missing:
        console.print()
        rule("NOT ENOUGH TESTNET USDC TO RUN THE DEMO", style="bold red")
        console.print("Fund these at https://faucet.circle.com (select Arc testnet, no account needed):\n")
        for role in missing:
            console.print(f"  {role:14s} {addresses[role]}")
        console.print("\nThen rerun: python -m cli.run_demo\n")
        return False
    return True


def print_job_result(job: dict) -> None:
    rule(f"JOB {job['job_id']} RESULT")
    console.print(Panel(job.get("final_memo") or "(no memo)", title="Final Memo", expand=False))

    table = Table(title="Per-Claim Verification (evaluator vs. live independent source)")
    table.add_column("Provider")
    table.add_column("Type")
    table.add_column("Claim")
    table.add_column("Status")
    table.add_column("Delta")
    for c in job["claims"]:
        status = c["verification_status"]
        color = {"match": "green", "mismatch": "red", "unverifiable": "grey62"}.get(status, "white")
        delta = f"{c['verification_delta']:+.2f}%" if c.get("verification_delta") is not None else "-"
        table.add_row(c["provider_agent_id"], c["claim_type"], c["claim_text"][:70], f"[{color}]{status}[/{color}]", delta)
    console.print(table)

    payout_table = Table(title="Settlement per Specialist (real Arc testnet transfers)")
    for col in ["Provider", "Matches", "Mismatches", "Unverifiable", "Outcome", "Paid / Allocated (USDC)"]:
        payout_table.add_column(col)
    for p in job["payouts"]:
        payout_table.add_row(
            p["provider_agent_id"], str(p["matches"]), str(p["mismatches"]), str(p["unverifiable"]),
            p["outcome"], f"{p['paid_usdc']:.4f} / {p['allocated_usdc']:.4f}",
        )
    console.print(payout_table)

    verdict_color = {"accept": "bold green", "partial": "bold yellow", "reject": "bold red"}[job["overall_verdict"]]
    console.print(f"\nOVERALL VERDICT: [{verdict_color}]{job['overall_verdict'].upper()}[/{verdict_color}]  |  total paid: {job['total_paid_usdc']:.4f} USDC\n")


def print_reputation(reputation: list[dict]) -> None:
    rule("REPUTATION DASHBOARD")
    table = Table()
    for col in ["Provider", "Jobs", "Accepted Claims", "Mismatched", "Unverifiable", "Accuracy"]:
        table.add_column(col)
    for r in sorted(reputation, key=lambda r: r["provider_agent_id"]):
        table.add_row(
            r["provider_agent_id"], str(r["total_jobs"]), str(r["accepted_claims"]),
            str(r["mismatched_claims"]), str(r["unverifiable_claims"]), f"{r['accuracy_score'] * 100:.1f}%",
        )
    console.print(table)


async def async_input(prompt: str) -> str:
    # A plain input() would block the whole asyncio event loop -- since
    # the 5 FastAPI services run as tasks on this same loop, that would
    # freeze every service (including ones a frontend or another terminal
    # might be hitting) while waiting on a keypress. Running it in the
    # default executor keeps the loop free.
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, input, prompt)


async def prompt_job() -> dict | None:
    """Asks whoever is running this terminal what job to submit -- nothing
    here is scripted. Returns None if they choose to stop."""
    console.print()
    rule("Submit a job (Ctrl+C or blank request to stop)", style="bold cyan")
    request_text = (await async_input("Request text: ")).strip()
    if not request_text:
        return None

    protocol_slug = ""
    while not protocol_slug:
        protocol_slug = (await async_input("Protocol slug (e.g. aave, uniswap, lido, curve): ")).strip()
        if not protocol_slug:
            console.print("  (required -- this is what gets looked up on DefiLlama/CoinGecko/etc.)")

    budget_usdc = JOB_BUDGET_USDC
    budget_raw = (await async_input(f"Budget USDC [{JOB_BUDGET_USDC}]: ")).strip()
    if budget_raw:
        try:
            budget_usdc = float(budget_raw)
            if budget_usdc <= 0:
                raise ValueError("must be positive")
        except ValueError:
            console.print(f"  Couldn't parse '{budget_raw}' as a positive number -- using default {JOB_BUDGET_USDC}.")
            budget_usdc = JOB_BUDGET_USDC

    target_raw = (await async_input(
        f"Target address to screen [{CLEAN_DEMO_ADDRESS} clean / {SANCTIONED_DEMO_ADDRESS} real OFAC hit / blank = clean]: "
    )).strip()
    target_address = target_raw or CLEAN_DEMO_ADDRESS
    fault_raw = (await async_input(
        "Inject a fault to demo the evaluator catching a lie? [none/onchain/news/compliance]: "
    )).strip().lower()
    inject_fault = fault_raw if fault_raw in ("onchain", "news", "compliance") else None

    return {
        "request_text": request_text,
        "budget_usdc": budget_usdc,
        "protocol_slug": protocol_slug,
        "target_address": target_address,
        "inject_fault": inject_fault,
    }


async def submit_job(client: httpx.AsyncClient, payload: dict) -> dict:
    # Every specialist and the evaluator are now real LLM tool-calling
    # agents (agents/orchestrator.py widens its own internal specialist/
    # evaluator timeouts to 120s/180s for the same reason) -- a job with
    # 2-3 specialists called sequentially plus one evaluator pass can
    # comfortably exceed 120s end to end.
    resp = await client.post(f"{ORCHESTRATOR_URL}/jobs", json=payload, timeout=300)
    if resp.status_code >= 400:
        log("cli", f"job submission failed: {resp.status_code} {resp.text}", style="bold red")
        resp.raise_for_status()
    return resp.json()


async def run_demo() -> None:
    for _, _, port in SERVICES:
        await wait_until_ready(port)

    rule("VeriFi Agents -- all 5 services are live", style="bold green")
    console.print(
        f"  orchestrator  : http://127.0.0.1:{ORCHESTRATOR_PORT}  (POST /jobs, GET /jobs/{{id}}, GET /reputation)\n"
        f"  evaluator     : http://127.0.0.1:{EVALUATOR_PORT}\n"
        f"  onchain agent : http://127.0.0.1:{ONCHAIN_AGENT_PORT}\n"
        f"  news agent    : http://127.0.0.1:{NEWS_AGENT_PORT}\n"
        f"  compliance    : http://127.0.0.1:{COMPLIANCE_AGENT_PORT}\n"
    )

    if not check_real_balances():
        return

    if "--demo" in sys.argv:
        jobs_run = 0
        async with httpx.AsyncClient() as client:
            while True:
                try:
                    payload = await prompt_job()
                except (KeyboardInterrupt, EOFError):
                    break
                if payload is None:
                    break
                try:
                    job = await submit_job(client, payload)
                    print_job_result(job)
                    jobs_run += 1
                except Exception as e:
                    log("cli", f"job failed: {e}", style="bold red")

            if jobs_run:
                reputation = (await client.get(f"{ORCHESTRATOR_URL}/reputation")).json()
                print_reputation(reputation)

                rule(f"Real Arc testnet balances after {jobs_run} job(s)")
                balances = (await client.get(f"{ORCHESTRATOR_URL}/wallets")).json()
                for role, bal in sorted(balances.items()):
                    console.print(f"  {role:22s} {bal:12.6f} USDC")
    else:
        rule("No jobs submitted -- pass --demo to submit real jobs interactively", style="grey62")

    rule("Services are live. Submit jobs from another terminal (POST http://127.0.0.1:8000/jobs). Press Ctrl+C to stop.", style="bold cyan")


async def main() -> None:
    servers = build_servers()
    server_tasks = [asyncio.create_task(server.serve()) for _, server in servers]
    try:
        await run_demo()
        await asyncio.gather(*server_tasks)
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        for _, server in servers:
            server.should_exit = True
        await asyncio.gather(*server_tasks, return_exceptions=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        console.print("\nStopped.")
