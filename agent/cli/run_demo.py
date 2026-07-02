"""Terminal runner: boots all 5 VeriFi Agents services in one process,
checks real Arc testnet balances, then leaves the services running so you
(or a frontend) can submit jobs against http://127.0.0.1:8000 directly.

By default this does NOT submit any jobs itself -- it only starts the
services and waits, so the only jobs that ever run are ones you actually
ask for. Pass --demo to also run the two built-in example jobs (one clean
ACCEPT run, one with an injected lie that should get caught) before
handing control back to you.

Every payment in any run is a real, mined Arc testnet transaction -- there
is no mock ledger left in this codebase. Fund the `requester` and
`orchestrator` wallets at https://faucet.circle.com (network: Arc
testnet) before running this; the script checks balances up front and
tells you exactly what's missing rather than failing deep in a job run.

Run from the verifi-agents/ directory:
    python -m cli.run_demo            # services only, no jobs submitted
    python -m cli.run_demo --demo     # also runs the 2 built-in example jobs
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

# Real, publicly-documented OFAC SDN address (Tornado Cash, designated
# 2022-08-08) -- used to demonstrate a genuine sanctions hit, not a fake one.
SANCTIONED_DEMO_ADDRESS = "0x8589427373d6d84e98730d7795d8f6f8731fda0"
CLEAN_DEMO_ADDRESS = "0x0000000000000000000000000000000000dead"

# Kept small: real gas + real per-call nanopayments come out of these
# wallets too, and the faucet caps at 20 USDC / address / 2 hours -- this
# leaves headroom to rerun the demo several times in one funding window.
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
    instructions) instead of letting a job fail deep inside a transfer."""
    rule("REAL ARC TESTNET BALANCES (live RPC read, not a local ledger)")
    console.print(f"  RPC: {ARC_RPC_URL}  |  chain id: {ARC_CHAIN_ID}  |  connected: {chain.is_connected()}\n")

    balances = ledger.all_balances()
    for role, bal in balances.items():
        console.print(f"  {role:22s} {bal:12.6f} USDC")

    needed = {"requester": JOB_BUDGET_USDC * 2, "orchestrator": 0.05}
    missing = [role for role, min_amount in needed.items() if balances.get(role, 0) < min_amount]
    if missing:
        console.print()
        rule("NOT ENOUGH TESTNET USDC TO RUN THE DEMO", style="bold red")
        console.print("Fund these at https://faucet.circle.com (select Arc testnet, no account needed):\n")
        for role in missing:
            console.print(f"  {role:14s} {ledger.role_address(role)}")
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


async def submit_job(client: httpx.AsyncClient, payload: dict) -> dict:
    resp = await client.post(f"{ORCHESTRATOR_URL}/jobs", json=payload, timeout=120)
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
        async with httpx.AsyncClient() as client:
            rule("DEMO JOB 1 -- clean run against Uniswap, expect ACCEPT + full payment", style="bold cyan")
            job1 = await submit_job(client, {
                "request_text": "Assess Uniswap before treasury deployment.",
                "template": "protocol_treasury_diligence",
                "budget_usdc": JOB_BUDGET_USDC,
                "protocol_slug": "uniswap",
                "target_address": CLEAN_DEMO_ADDRESS,
            })
            print_job_result(job1)

            rule("DEMO JOB 2 -- compliance agent lies about a sanctioned address, expect it caught", style="bold cyan")
            job2 = await submit_job(client, {
                "request_text": (
                    "Assess Aave before treasury deployment. This treasury has strict "
                    "compliance requirements, so screen the counterparty address against "
                    "sanctions lists in addition to the usual financial and governance checks."
                ),
                "template": "protocol_treasury_diligence",
                "budget_usdc": JOB_BUDGET_USDC,
                "protocol_slug": "aave",
                "target_address": SANCTIONED_DEMO_ADDRESS,
                "inject_fault": "compliance",
            })
            print_job_result(job2)

            reputation = (await client.get(f"{ORCHESTRATOR_URL}/reputation")).json()
            print_reputation(reputation)

            rule("Real Arc testnet balances after both jobs")
            balances = (await client.get(f"{ORCHESTRATOR_URL}/wallets")).json()
            for role, bal in sorted(balances.items()):
                console.print(f"  {role:22s} {bal:12.6f} USDC")
    else:
        rule("No jobs submitted -- pass --demo to run the 2 built-in examples", style="grey62")

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
