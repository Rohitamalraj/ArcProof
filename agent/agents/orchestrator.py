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

from shared.schema import JobRequest, JobRecord, Claim
from shared.console import log, rule
from shared.config import ORCHESTRATOR_PORT, ONCHAIN_AGENT_URL, NEWS_AGENT_URL, COMPLIANCE_AGENT_URL, EVALUATOR_URL, WALLETS
from payments.x402 import x402_post
from payments.wallet import ledger
from payments import escrow_contract
from storage.store import job_store, reputation_store
from settlement.escrow import settle
from agents import langchain_planner

app = FastAPI(title="VeriFi Orchestrator")

ORCHESTRATOR_PRIVATE_KEY = WALLETS["orchestrator"]["private_key"]

SPECIALIST_URLS: dict[str, str] = {
    "onchain-agent-v1": ONCHAIN_AGENT_URL,
    "news-agent-v1": NEWS_AGENT_URL,
    "compliance-agent-v1": COMPLIANCE_AGENT_URL,
}


async def decompose(job_req: JobRequest) -> langchain_planner.SpecialistPlan:
    # No fixed-template fallback: this is a real LLM decision or the job
    # fails loudly (caught by create_job's outer try/except, which refunds
    # the locked escrow) -- a silent substitute decision here would be
    # indistinguishable from a real one downstream. Returns the full plan
    # (not just specialist_ids) since it also carries the LLM-inferred
    # template_label used when the requester didn't supply their own.
    return await langchain_planner.plan_specialists(job_req)


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
    # Same "agent or loud failure" rule as decompose() -- no templated
    # memo fallback.
    return await langchain_planner.write_memo(job_req, claims)


@app.post("/jobs")
async def create_job(job_req: JobRequest):
    job_id = f"job_{uuid.uuid4().hex[:10]}"
    rule(f"NEW JOB {job_id} -- {job_req.protocol_slug}")
    log("orchestrator", f'received request: "{job_req.request_text}" | budget={job_req.budget_usdc} USDC | template={job_req.template}')

    job = JobRecord(
        job_id=job_id,
        requester_id=job_req.requester_wallet,
        template=job_req.template or "unclassified",  # replaced with the LLM's inferred label below once decompose() runs
        request_text=job_req.request_text,
        protocol_slug=job_req.protocol_slug,
        budget_usdc=job_req.budget_usdc,
        status="in_progress",
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    try:
        escrow_contract.lock(job_id, job_req.requester_wallet, job_req.budget_usdc)
    except Exception as e:
        job.status = "failed"
        job_store.save(job)
        raise HTTPException(status_code=402, detail=f"could not lock budget in escrow contract: {e}")

    try:
        plan = await decompose(job_req)
        job.subtasks = plan.specialist_ids
        if not job_req.template:
            job.template = plan.template_label

        all_claims: list[Claim] = []
        # Each specialist is now a real LLM tool-calling agent (multiple
        # tool calls + reasoning round-trips per request), which routinely
        # takes longer than a single deterministic handler did -- 30s was
        # tuned for the old rule-based specialists and was timing out
        # client-side while the agent kept working server-side past the
        # point its claims could still be used.
        async with httpx.AsyncClient(timeout=120) as client:
            for name in plan.specialist_ids:
                try:
                    claims = await call_specialist(client, name, job_req, job_id)
                    all_claims.extend(claims)
                except Exception as e:
                    log("orchestrator", f"  ! {name} failed: {e}", style="bold red")

        job.claims = all_claims
        job.final_memo = await assemble_memo(job_req, all_claims)

        log("orchestrator", f"assembled {len(all_claims)} claims from {len(plan.specialist_ids)} specialists -> handing off to evaluator")
        # The evaluator now makes one real LLM agent call per job covering
        # every claim (potentially several tool calls) -- same timeout
        # widening as above, and it scales with claim count.
        async with httpx.AsyncClient(timeout=180) as client:
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
        # Budget is already locked in the escrow contract at this point (see
        # above) -- any failure past that line must not leave real funds
        # stranded with no job record and no way back to the requester.
        # refund() is a real contract call, same trust model as any release.
        log("orchestrator", f"job {job_id} failed after budget lock: {e} -- refunding escrow contract -> requester", style="bold red")
        job.status = "failed"
        try:
            escrow_contract.refund(job_id)
        except Exception as refund_error:
            log("orchestrator", f"  ! refund ALSO failed: {refund_error} -- funds remain locked in contract, job marked failed", style="bold red")
        job_store.save(job)
        raise HTTPException(status_code=500, detail=f"job failed after budget was locked; escrow contract refunded to requester where possible: {e}")


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
    balances = ledger.all_balances()
    try:
        from payments.chain import get_balance_usdc
        balances["escrow-contract"] = get_balance_usdc(escrow_contract.contract_address())
    except Exception:
        pass
    try:
        from payments.chain import get_balance_usdc
        from shared.config import CIRCLE_REQUESTER_ADDRESS
        if CIRCLE_REQUESTER_ADDRESS:
            balances["requester-circle"] = get_balance_usdc(CIRCLE_REQUESTER_ADDRESS)
    except Exception:
        pass
    return balances


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=ORCHESTRATOR_PORT)
