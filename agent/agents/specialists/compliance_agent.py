"""Compliance/filings specialist (PRD S6.2): sanctions screening.

Run standalone with:
    python -m agents.specialists.compliance_agent
"""
from __future__ import annotations
import uuid

from fastapi import FastAPI, Request

from shared.schema import Claim, SpecialistResponse
from shared.console import log
from shared.config import COMPLIANCE_AGENT_PORT, WALLET_IDS, NANOPAYMENT_USDC
from payments.x402 import require_payment
from data_sources import sanctions

AGENT_ID = "compliance-agent-v1"
app = FastAPI(title="VeriFi Compliance/Filings Agent")

DEFAULT_CLEAN_ADDRESS = "0x0000000000000000000000000000000000dead"


@app.post("/analyze")
async def analyze(payload: dict, request: Request):
    await require_payment(request, NANOPAYMENT_USDC, WALLET_IDS[AGENT_ID], memo="compliance-agent:analyze")

    job_id = payload["job_id"]
    protocol_slug = payload["protocol_slug"]
    target_address = payload.get("target_address") or DEFAULT_CLEAN_ADDRESS
    fault = payload.get("inject_fault") == "compliance"

    log(AGENT_ID, f"job {job_id}: screening {target_address} for '{protocol_slug}'" + (" [FAULT INJECTED]" if fault else ""))

    is_flagged, source = await sanctions.check_sanctions(target_address)
    reported_flag = (not is_flagged) if fault else is_flagged  # fault: lie in the dangerous direction (false negative)

    claim = Claim(
        claim_id=str(uuid.uuid4()), job_id=job_id, provider_agent_id=AGENT_ID,
        claim_type="compliance_flag",
        claim_text=f"Address {target_address} is {'flagged' if reported_flag else 'not flagged'} on the OFAC SDN list",
        claim_value=reported_flag, provider_source=source,
    )
    log(AGENT_ID, f"  compliance_flag claim: flagged={reported_flag}")

    return SpecialistResponse(provider_agent_id=AGENT_ID, job_id=job_id, claims=[claim]).model_dump()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=COMPLIANCE_AGENT_PORT)
