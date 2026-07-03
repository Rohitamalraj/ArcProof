"""Evaluator agent (PRD S9): a real LangChain tool-calling agent that
independently re-derives every claim from its own live tool calls and
judges match/mismatch/unverifiable. Upgraded from a fixed +/-5% threshold
table to full LLM judgment -- the model decides what counts as a match
using the same live sources as before, it just applies judgment instead
of a hard cutoff. This trades some payout determinism for genuine
agentic reasoning; settlement/escrow.py is unaffected since it only ever
reads claim.verification_status, whichever agent set it.

This service does NOT trust the specialist's claim_text for identifying
*what* to check -- its tools look up canonical addresses/spaces
themselves (data_sources.explorer.PROTOCOL_TREASURY_ADDRESS) -- only
claim_value is what's being judged.

Run standalone with:
    python -m agents.evaluator
"""
from __future__ import annotations

from fastapi import FastAPI
from langchain.agents import create_agent

from shared.schema import Claim
from shared.console import log
from shared.config import EVALUATOR_PORT
from agents.llm import get_model
from agents.agent_schemas import EvaluationOutput
from agents.tools import EVALUATOR_TOOLS

app = FastAPI(title="VeriFi Evaluator Agent")

SYSTEM_PROMPT = (
    "You are the independent evaluator in a bonded financial diligence network. You are "
    "given a list of claims made by paid specialist agents, each with a claim_id. For "
    "EVERY claim, use your tools to independently re-fetch the real current value from a "
    "live source -- never trust the claim's stated value or source, and never skip a "
    "tool call just because the claim looks plausible.\n\n"
    "Judge each claim:\n"
    "- 'match' if the claim is substantively correct (for numeric claims, ~5% is a "
    "normal tolerance for noisy real-time data -- use judgment on borderline cases)\n"
    "- 'mismatch' if the claim is materially wrong or fabricated\n"
    "- 'unverifiable' if your tool could not produce an independent value for this claim "
    "(no data available, or a single-source news claim, which is unverifiable rather "
    "than a mismatch) -- never guess a verdict just to avoid 'unverifiable'\n\n"
    "Return exactly one verdict per claim_id given, using the same claim_ids. For each "
    "verdict, set verification_value/verification_source to what your tool returned, "
    "verification_delta to the numeric difference (claim minus independent value) for "
    "numeric claims (else leave it null), and a short verification_note explaining your "
    "judgment -- mention if the source was flagged simulated."
)


@app.post("/evaluate")
async def evaluate(payload: dict):
    job_id = payload["job_id"]
    protocol_slug = payload["protocol_slug"]
    target_address = payload.get("target_address")
    claims = [Claim(**c) for c in payload["claims"]]

    log("evaluator", f"job {job_id}: independently verifying {len(claims)} claims")

    if not claims:
        # Nothing to verify -- there is no claim_id an LLM call could
        # return a verdict for, so the loop below would discard whatever
        # it said anyway. Calling the model here would only waste a real
        # request (and real quota) for a result nothing uses.
        return {"claims": []}

    claims_text = "\n".join(
        f"- claim_id={c.claim_id} type={c.claim_type} text={c.claim_text!r} "
        f"claim_value={c.claim_value!r} (reported by {c.provider_agent_id})"
        for c in claims
    )
    user_msg = (
        f"Protocol slug: {protocol_slug}\n"
        f"Target address for compliance checks: {target_address or '(none given)'}\n\n"
        f"Claims to verify:\n{claims_text}"
    )

    try:
        agent = create_agent(model=get_model("evaluator"), tools=EVALUATOR_TOOLS, system_prompt=SYSTEM_PROMPT, response_format=EvaluationOutput)
        result = await agent.ainvoke({"messages": [{"role": "user", "content": user_msg}]})
        verdicts = {v.claim_id: v for v in result["structured_response"].verdicts}
    except Exception as e:
        log("evaluator", f"  ! evaluator agent unavailable ({e}) -- all claims marked unverifiable", style="bold red")
        verdicts = {}

    for claim in claims:
        v = verdicts.get(claim.claim_id)
        if v is None:
            claim.verification_status = "unverifiable"
            claim.verification_note = "evaluator agent returned no verdict for this claim"
        else:
            claim.verification_status = v.verification_status
            claim.verification_value = v.verification_value
            claim.verification_source = v.verification_source
            claim.verification_delta = v.verification_delta
            claim.verification_note = v.verification_note

        delta_str = f" (delta {claim.verification_delta:+.2f}%)" if claim.verification_delta is not None else ""
        style = {"match": "bold green", "mismatch": "bold red", "unverifiable": "grey62"}.get(claim.verification_status, "white")
        log("evaluator", f"  [{claim.claim_type}] {claim.verification_status.upper()}{delta_str} -- {claim.claim_text}", style=style)

    return {"claims": [c.model_dump() for c in claims]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=EVALUATOR_PORT)
