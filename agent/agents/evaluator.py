"""Evaluator agent (PRD S9): re-derives every claim from an independent
live source and assigns a per-claim verdict. Deliberately rule-based, not
model-based -- see settlement/escrow.py docstring for why.

This service does NOT trust the specialist's claim_text for identifying
*what* to check (e.g. which address, which protocol) -- it looks that up
independently (data_sources.explorer.PROTOCOL_TREASURY_ADDRESS, the
request's own target_address) and only uses the specialist's claim_value
as the number/fact being checked.

Run standalone with:
    python -m agents.evaluator
"""
from __future__ import annotations

from fastapi import FastAPI

from shared.schema import Claim
from shared.console import log
from shared.config import EVALUATOR_PORT
from data_sources import defillama, price, explorer, governance, news, sanctions

app = FastAPI(title="VeriFi Evaluator Agent")

NUMERIC_TOLERANCE_PCT = 5.0  # documented in settlement/escrow.py; keep in sync


async def _verify(claim: Claim, protocol_slug: str, target_address: str | None) -> None:
    if claim.claim_type == "tvl":
        actual, source = await defillama.fetch_tvl(protocol_slug)
        claim.verification_value = actual
        claim.verification_source = source
        if actual:
            delta_pct = ((float(claim.claim_value) - actual) / actual) * 100
            claim.verification_delta = round(delta_pct, 2)
            claim.verification_status = "match" if abs(delta_pct) <= NUMERIC_TOLERANCE_PCT else "mismatch"
        else:
            claim.verification_status = "unverifiable"

    elif claim.claim_type == "price_change":
        actual, source = await price.fetch_price_change_pct(protocol_slug)
        delta = float(claim.claim_value) - actual
        claim.verification_value = round(actual, 2)
        claim.verification_source = source
        claim.verification_delta = round(delta, 2)
        claim.verification_status = "match" if abs(delta) <= NUMERIC_TOLERANCE_PCT else "mismatch"

    elif claim.claim_type == "token_concentration":
        actual, source, simulated = await explorer.token_concentration_top10_pct(protocol_slug)
        delta = float(claim.claim_value) - actual
        claim.verification_value = actual
        claim.verification_source = source
        claim.verification_delta = round(delta, 2)
        claim.verification_status = "match" if abs(delta) <= NUMERIC_TOLERANCE_PCT else "mismatch"
        claim.verification_note = "simulated data source" if simulated else None

    elif claim.claim_type == "wallet_flow":
        address = explorer.PROTOCOL_TREASURY_ADDRESS.get(protocol_slug)
        if not address:
            claim.verification_status = "unverifiable"
            return
        actual, source, simulated = await explorer.check_wallet_flow(address, exchange_hint="binance")
        claimed = bool(claim.claim_value)
        claim.verification_value = actual
        claim.verification_source = source
        claim.verification_status = "match" if actual == claimed else "mismatch"
        claim.verification_note = "simulated data source" if simulated else None

    elif claim.claim_type == "governance_event":
        try:
            proposals, source = await governance.fetch_recent_closed_proposals(protocol_slug, limit=1)
        except ValueError:
            claim.verification_status = "unverifiable"
            return
        if not proposals:
            claim.verification_status = "unverifiable"
            return
        actual_choice = proposals[0]["winning_choice"]
        claim.verification_value = actual_choice
        claim.verification_source = source
        claim.verification_status = "match" if str(claim.claim_value) == str(actual_choice) else "mismatch"

    elif claim.claim_type == "news_incident":
        corroborated, sources, simulated = await news.check_news_incident(protocol_slug, keyword="exploit")
        claim.verification_source = sources[0]
        claim.verification_note = "simulated data source" if simulated else None
        if not corroborated:
            # PRD S9.3: single-source news claims are unverifiable, not a match/mismatch,
            # and never count against the provider.
            claim.verification_status = "unverifiable"
        else:
            claim.verification_value = corroborated
            claim.verification_status = "match" if bool(claim.claim_value) == corroborated else "mismatch"

    elif claim.claim_type == "compliance_flag":
        if not target_address:
            claim.verification_status = "unverifiable"
            return
        actual_flag, source = await sanctions.check_sanctions(target_address)
        claim.verification_value = actual_flag
        claim.verification_source = source
        claim.verification_status = "match" if bool(claim.claim_value) == actual_flag else "mismatch"

    else:
        claim.verification_status = "unverifiable"


@app.post("/evaluate")
async def evaluate(payload: dict):
    job_id = payload["job_id"]
    protocol_slug = payload["protocol_slug"]
    target_address = payload.get("target_address")
    claims = [Claim(**c) for c in payload["claims"]]

    log("evaluator", f"job {job_id}: independently verifying {len(claims)} claims")

    for claim in claims:
        try:
            await _verify(claim, protocol_slug, target_address)
        except Exception as e:
            claim.verification_status = "unverifiable"
            claim.verification_note = f"verification error: {e}"

        delta_str = f" (delta {claim.verification_delta:+.2f}%)" if claim.verification_delta is not None else ""
        style = {"match": "bold green", "mismatch": "bold red", "unverifiable": "grey62"}.get(claim.verification_status, "white")
        log("evaluator", f"  [{claim.claim_type}] {claim.verification_status.upper()}{delta_str} -- {claim.claim_text}", style=style)

    return {"claims": [c.model_dump() for c in claims]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=EVALUATOR_PORT)
