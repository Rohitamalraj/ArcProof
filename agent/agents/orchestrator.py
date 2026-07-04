"""Orchestrator agent (PRD S6.2): decomposes a job, pays specialists via
x402, hands the assembled claims to the evaluator, then triggers
settlement. Owns the JobRecord end to end since it's the only role that
needs to persist job state across the whole lifecycle.

Run standalone with:
    python -m agents.orchestrator
This is also the one HTTP surface a frontend integrates against later:
POST /jobs to submit work, GET /jobs/{id} to poll status, GET /reputation
for the dashboard feed.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from shared.schema import JobRequest, JobRecord, Claim
from shared.console import log, rule
from shared.config import (
    ORCHESTRATOR_PORT, ONCHAIN_AGENT_URL, NEWS_AGENT_URL, COMPLIANCE_AGENT_URL,
    EVALUATOR_URL, WALLETS, ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY,
    ARC_CHAIN_ID, ARC_RPC_URL, ARC_EXPLORER_URL, NANOPAYMENT_USDC, FRONTEND_ORIGIN,
)
from payments.x402 import x402_post
from payments.wallet import ledger, transfer_to_address
from payments import chain
from storage.store import job_store, reputation_store
from settlement.escrow import settle
from agents import langchain_planner

app = FastAPI(title="VeriFi Orchestrator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN] if FRONTEND_ORIGIN != "*" else ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

ORCHESTRATOR_PRIVATE_KEY = WALLETS["orchestrator"]["private_key"]
ESCROW_ADDRESS = WALLETS["escrow"]["address"]

SPECIALIST_URLS: dict[str, str] = {
    "onchain-agent-v1": ONCHAIN_AGENT_URL,
    "news-agent-v1": NEWS_AGENT_URL,
    "compliance-agent-v1": COMPLIANCE_AGENT_URL,
}

# Fixed Template A/B subtask decomposition (PRD S8) -- used only as a
# fallback when no LLM is configured. When ANTHROPIC_API_KEY or
# OPENAI_API_KEY is set, `decompose()` instead asks a real LangChain
# tool-calling agent (agents/langchain_planner.py) which specialists this
# specific request actually needs.
TEMPLATE_SPECIALISTS: dict[str, list[str]] = {
    "protocol_treasury_diligence": ["onchain-agent-v1", "news-agent-v1", "compliance-agent-v1"],
    "yield_opportunity_review": ["onchain-agent-v1", "compliance-agent-v1"],
}


async def decompose(job_req: JobRequest) -> list[str]:
    if GOOGLE_API_KEY or ANTHROPIC_API_KEY or OPENAI_API_KEY:
        try:
            plan = await langchain_planner.plan_specialists(job_req)
            return plan.specialist_ids
        except Exception as e:
            # Free-tier LLM quotas (daily caps, not per-minute) are a real
            # external dependency this job shouldn't die on -- the payment/
            # verification pipeline underneath doesn't care who picked the
            # specialist list. Fall back to the fixed template rather than
            # failing (and having already locked the requester's budget).
            log("orchestrator", f"LLM planner unavailable ({e}) -- falling back to fixed Template A/B list", style="grey62")
            return TEMPLATE_SPECIALISTS[job_req.template]
    log("orchestrator", "no LLM configured -- using fixed Template A/B specialist list (see README)", style="grey62")
    return TEMPLATE_SPECIALISTS[job_req.template]


async def call_specialist(client: httpx.AsyncClient, name: str, job_req: JobRequest, job_id: str) -> list[Claim]:
    url = SPECIALIST_URLS[name]
    log("orchestrator", f"-> calling {name} ({url}/analyze)")
    resp = await x402_post(client, f"{url}/analyze", ORCHESTRATOR_PRIVATE_KEY, {
        "job_id": job_id,
        "protocol_slug": job_req.protocol_slug,
        "target_address": job_req.target_address,
        "inject_fault": job_req.inject_fault,
    })
    resp.raise_for_status()
    return [Claim(**c) for c in resp.json()["claims"]]


async def assemble_memo(job_req: JobRequest, claims: list[Claim]) -> str:
    if GOOGLE_API_KEY or ANTHROPIC_API_KEY or OPENAI_API_KEY:
        try:
            return await langchain_planner.write_memo(job_req, claims)
        except Exception as e:
            log("orchestrator", f"LLM memo writer unavailable ({e}) -- falling back to templated memo", style="grey62")
            return _template_memo(job_req, claims)
    return _template_memo(job_req, claims)


def _template_memo(job_req: JobRequest, claims: list[Claim]) -> str:
    lines = [f"# Diligence Memo: {job_req.protocol_slug}", "", job_req.request_text, ""]
    by_type: dict[str, list[Claim]] = {}
    for c in claims:
        by_type.setdefault(c.claim_type, []).append(c)
    for claim_type, group in by_type.items():
        lines.append(f"## {claim_type}")
        for c in group:
            lines.append(f"- {c.claim_text} (source: {c.provider_source})")
        lines.append("")
    return "\n".join(lines)


@app.post("/jobs")
async def create_job(job_req: JobRequest):
    job_id = f"job_{uuid.uuid4().hex[:10]}"
    rule(f"NEW JOB {job_id} -- {job_req.protocol_slug}")
    log("orchestrator", f'received request: "{job_req.request_text}" | budget={job_req.budget_usdc} USDC | template={job_req.template}')

    job = JobRecord(
        job_id=job_id,
        requester_id=job_req.requester_wallet,
        template=job_req.template,
        request_text=job_req.request_text,
        protocol_slug=job_req.protocol_slug,
        budget_usdc=job_req.budget_usdc,
        status="in_progress",
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    if job_req.payment_tx_hash:
        # Real connected-wallet path: the requester already broadcast a real
        # transfer to escrow themselves. Don't trust the claim -- re-derive
        # it from the chain, same principle as payments/x402.py's
        # verify_transfer use for specialist nanopayments.
        verified = chain.verify_transfer(
            job_req.payment_tx_hash,
            expected_from=job_req.requester_wallet,
            expected_to=ESCROW_ADDRESS,
            min_amount_usdc=job_req.budget_usdc,
        )
        if not verified:
            job.status = "failed"
            job_store.save(job)
            raise HTTPException(status_code=402, detail=f"payment tx {job_req.payment_tx_hash} could not be verified on-chain")
        log("orchestrator", f"budget verified on-chain: {job_req.requester_wallet[:10]}.. -> escrow (tx {job_req.payment_tx_hash})")
    else:
        # Fallback path used by cli/run_demo.py and other backend-internal
        # callers that don't have a real connected wallet -- signs the
        # transfer with the fixed 'requester' role wallet from .env.
        try:
            ledger.transfer(job_req.requester_wallet, "escrow", job_req.budget_usdc, memo=f"job {job_id}: lock budget")
        except Exception as e:
            job.status = "failed"
            job_store.save(job)
            raise HTTPException(status_code=402, detail=f"could not lock budget in escrow: {e}")

    try:
        specialists = await decompose(job_req)
        job.subtasks = specialists

        all_claims: list[Claim] = []
        async with httpx.AsyncClient(timeout=30) as client:
            for name in specialists:
                try:
                    claims = await call_specialist(client, name, job_req, job_id)
                    all_claims.extend(claims)
                except Exception as e:
                    log("orchestrator", f"  ! {name} failed: {e}", style="bold red")

        job.claims = all_claims
        job.final_memo = await assemble_memo(job_req, all_claims)

        log("orchestrator", f"assembled {len(all_claims)} claims from {len(specialists)} specialists -> handing off to evaluator")
        async with httpx.AsyncClient(timeout=30) as client:
            eval_resp = await client.post(f"{EVALUATOR_URL}/evaluate", json={
                "job_id": job_id,
                "protocol_slug": job_req.protocol_slug,
                "target_address": job_req.target_address,
                "claims": [c.model_dump() for c in all_claims],
            })
            eval_resp.raise_for_status()
            job.claims = [Claim(**c) for c in eval_resp.json()["claims"]]

        job = await settle(job)
        job_store.save(job)

        log("orchestrator", f"job {job_id} DONE -- verdict={job.overall_verdict.upper()} paid={job.total_paid_usdc:.4f} USDC", style="bold cyan")
        return job.model_dump()

    except Exception as e:
        # Budget is already locked in escrow at this point (see above) --
        # any failure past that line must not leave real funds stranded
        # with no job record and no way back to the requester. Refund for
        # real, on-chain, same as any other settlement transfer.
        log("orchestrator", f"job {job_id} failed after budget lock: {e} -- refunding escrow -> requester", style="bold red")
        job.status = "failed"
        try:
            if job_req.payment_tx_hash:
                # Real connected wallet -- refund straight to that address,
                # not through the role lookup `ledger.transfer` uses.
                transfer_to_address("escrow", job_req.requester_wallet, job_req.budget_usdc, memo=f"job {job_id}: refund after failure")
            else:
                ledger.transfer("escrow", job_req.requester_wallet, job_req.budget_usdc, memo=f"job {job_id}: refund after failure")
        except Exception as refund_error:
            log("orchestrator", f"  ! refund ALSO failed: {refund_error} -- funds remain in escrow, job marked failed", style="bold red")
        job_store.save(job)
        raise HTTPException(status_code=500, detail=f"job failed after budget was locked; escrow refunded to requester where possible: {e}")


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job.model_dump()


@app.get("/jobs")
async def list_jobs():
    return [j.model_dump() for j in job_store.list_all()]


@app.get("/reputation")
async def get_reputation():
    return [r.model_dump() for r in reputation_store.list_all()]


@app.get("/wallets")
async def get_wallets():
    return ledger.all_balances()


@app.get("/config")
async def get_config():
    return {
        "arc_chain_id": ARC_CHAIN_ID,
        "arc_rpc_url": ARC_RPC_URL,
        "arc_explorer_url": ARC_EXPLORER_URL,
        "escrow_address": ESCROW_ADDRESS,
        "nanopayment_usdc": NANOPAYMENT_USDC,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=ORCHESTRATOR_PORT)
