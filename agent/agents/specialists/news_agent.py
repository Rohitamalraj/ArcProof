"""News/fundamentals specialist (PRD S6.2): governance actions, incidents.

Run standalone with:
    python -m agents.specialists.news_agent
"""
from __future__ import annotations
import uuid

from fastapi import FastAPI, Request

from shared.schema import Claim, SpecialistResponse
from shared.console import log
from shared.config import NEWS_AGENT_PORT, WALLET_IDS, NANOPAYMENT_USDC
from payments.x402 import require_payment
from data_sources import governance, news

AGENT_ID = "news-agent-v1"
app = FastAPI(title="VeriFi News/Fundamentals Agent")


@app.post("/analyze")
async def analyze(payload: dict, request: Request):
    await require_payment(request, NANOPAYMENT_USDC, WALLET_IDS[AGENT_ID], memo="news-agent:analyze")

    job_id = payload["job_id"]
    protocol_slug = payload["protocol_slug"]
    fault = payload.get("inject_fault") == "news"

    log(AGENT_ID, f"job {job_id}: analyzing news/governance for '{protocol_slug}'" + (" [FAULT INJECTED]" if fault else ""))

    claims: list[Claim] = []

    try:
        proposals, source = await governance.fetch_recent_closed_proposals(protocol_slug, limit=1)
        if proposals:
            p = proposals[0]
            winning_choice = p["winning_choice"] or "unknown"
            reported_choice = f"FABRICATED-{winning_choice}" if fault else winning_choice
            claims.append(Claim(
                claim_id=str(uuid.uuid4()), job_id=job_id, provider_agent_id=AGENT_ID,
                claim_type="governance_event",
                claim_text=f"Governance proposal '{p['title']}' closed on {p['end_date']} with outcome '{reported_choice}'",
                claim_value=reported_choice, provider_source=source,
            ))
            log(AGENT_ID, f"  governance_event claim: '{p['title']}' -> {reported_choice}")
    except ValueError as e:
        log(AGENT_ID, f"  ! no governance data available for '{protocol_slug}': {e}")

    try:
        corroborated, sources, simulated = await news.check_news_incident(protocol_slug, keyword="exploit")
        incident_text = "had a reported security incident" if corroborated else "had no corroborated security incident"
        claims.append(Claim(
            claim_id=str(uuid.uuid4()), job_id=job_id, provider_agent_id=AGENT_ID,
            claim_type="news_incident",
            claim_text=f"{protocol_slug} {incident_text} referencing 'exploit' in the lookback window",
            claim_value=corroborated, provider_source=sources[0], simulated=simulated,
        ))
        log(AGENT_ID, f"  news_incident claim: corroborated={corroborated} (simulated={simulated})")
    except Exception as e:
        # GDELT is free and keyless but rate-limits bursts (429) or
        # occasionally returns a non-JSON error body -- a flaky third-party
        # news source should cost this ONE claim, not the whole specialist
        # response (which would also throw away the governance_event claim
        # above that already succeeded).
        log(AGENT_ID, f"  ! news_incident check failed (GDELT): {e}", style="grey62")

    return SpecialistResponse(provider_agent_id=AGENT_ID, job_id=job_id, claims=claims).model_dump()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=NEWS_AGENT_PORT)
