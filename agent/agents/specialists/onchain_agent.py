"""On-chain data specialist (PRD S6.2): TVL, treasury wallet flow, holder concentration.

Runs as its own FastAPI service, paid per call via the x402 handshake in
payments/x402.py. Run standalone with:
    python -m agents.specialists.onchain_agent
"""
from __future__ import annotations
import uuid

from fastapi import FastAPI, Request

from shared.schema import Claim, SpecialistResponse
from shared.console import log
from shared.config import ONCHAIN_AGENT_PORT, WALLET_IDS, NANOPAYMENT_USDC
from payments.x402 import require_payment
from data_sources import defillama, explorer, price
from data_sources.explorer import PROTOCOL_TREASURY_ADDRESS

AGENT_ID = "onchain-agent-v1"
app = FastAPI(title="VeriFi On-Chain Data Agent")


@app.post("/analyze")
async def analyze(payload: dict, request: Request):
    await require_payment(request, NANOPAYMENT_USDC, WALLET_IDS[AGENT_ID], memo="onchain-agent:analyze")

    job_id = payload["job_id"]
    protocol_slug = payload["protocol_slug"]
    fault = payload.get("inject_fault") == "onchain"

    log(AGENT_ID, f"job {job_id}: analyzing on-chain data for '{protocol_slug}'" + (" [FAULT INJECTED]" if fault else ""))

    claims: list[Claim] = []

    try:
        tvl, source = await defillama.fetch_tvl(protocol_slug)
        reported_tvl = tvl * 1.5 if fault else tvl
        claims.append(Claim(
            claim_id=str(uuid.uuid4()), job_id=job_id, provider_agent_id=AGENT_ID,
            claim_type="tvl",
            claim_text=f"{protocol_slug} TVL is ${reported_tvl:,.0f}",
            claim_value=reported_tvl, provider_source=source,
        ))
        log(AGENT_ID, f"  tvl claim: ${reported_tvl:,.0f} (source: {source})")
    except Exception as e:
        log(AGENT_ID, f"  ! failed to fetch TVL for '{protocol_slug}': {e}")

    try:
        pct_change, source = await price.fetch_price_change_pct(protocol_slug)
        claims.append(Claim(
            claim_id=str(uuid.uuid4()), job_id=job_id, provider_agent_id=AGENT_ID,
            claim_type="price_change",
            claim_text=f"{protocol_slug} token price changed {pct_change:+.1f}% over the last 7 days",
            claim_value=round(pct_change, 2), provider_source=source,
        ))
        log(AGENT_ID, f"  price_change claim: {pct_change:+.1f}% (source: {source})")
    except Exception as e:
        log(AGENT_ID, f"  ! failed to fetch price history for '{protocol_slug}': {e}")

    address = PROTOCOL_TREASURY_ADDRESS.get(protocol_slug)
    if address:
        touched, source, simulated = await explorer.check_wallet_flow(address, exchange_hint="binance")
        claims.append(Claim(
            claim_id=str(uuid.uuid4()), job_id=job_id, provider_agent_id=AGENT_ID,
            claim_type="wallet_flow",
            claim_text=f"Treasury wallet {address[:10]}... {'sent funds to' if touched else 'showed no flow to'} a labeled exchange wallet in the lookback window",
            claim_value=touched, provider_source=source, simulated=simulated,
        ))
        log(AGENT_ID, f"  wallet_flow claim: touched_exchange={touched} (simulated={simulated})")

    pct, source, simulated = await explorer.token_concentration_top10_pct(protocol_slug)
    claims.append(Claim(
        claim_id=str(uuid.uuid4()), job_id=job_id, provider_agent_id=AGENT_ID,
        claim_type="token_concentration",
        claim_text=f"Top 10 holders control {pct:.1f}% of {protocol_slug} supply",
        claim_value=pct, provider_source=source, simulated=simulated,
    ))
    log(AGENT_ID, f"  token_concentration claim: {pct:.1f}% (simulated={simulated})")

    return SpecialistResponse(provider_agent_id=AGENT_ID, job_id=job_id, claims=claims).model_dump()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=ONCHAIN_AGENT_PORT)
