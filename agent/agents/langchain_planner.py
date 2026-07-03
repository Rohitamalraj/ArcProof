"""Real LangChain tool-calling agent (LangChain 1.x `create_agent`) that
decides which specialists a job actually needs and writes the requester-
facing memo prose -- the orchestrator still executes the real x402
payment + HTTP calls, but which specialists get called is the model's
call, not a hardcoded dict lookup.

Requires GOOGLE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in .env
(see agents/llm.py). Deliberately no non-LLM fallback anywhere in this
project: if a call here fails, agents/orchestrator.py lets the failure
propagate and refunds the requester's locked escrow rather than quietly
substituting a fixed-template decision.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from langchain.agents import create_agent

from shared.schema import JobRequest, Claim
from shared.console import log
from agents.llm import get_model

ALL_SPECIALISTS = {
    "onchain-agent-v1": "On-chain data: TVL, 7-day price change, treasury wallet flow to exchanges, token holder concentration.",
    "news-agent-v1": "News/fundamentals: most recent governance proposal outcome, reported security incidents.",
    "compliance-agent-v1": "Compliance/filings: OFAC sanctions screening for a specific wallet address.",
}


class SpecialistPlan(BaseModel):
    specialist_ids: list[str] = Field(description="Subset of onchain-agent-v1, news-agent-v1, compliance-agent-v1 to engage")
    reasoning: str = Field(description="One sentence on why these specialists (and not others) answer the request")
    template_label: str = Field(description="A short (2-5 word) descriptive category for this specific request, e.g. 'Protocol Treasury Diligence', 'Yield Opportunity Review', 'Sanctions Screening', or something new you invent if the request doesn't fit an existing pattern -- this is not a fixed enum, every request gets its own fitting label")


async def plan_specialists(job_req: JobRequest) -> SpecialistPlan:
    agent = create_agent(
        model=get_model("orchestrator"),
        tools=[],
        system_prompt=(
            "You are the orchestrator for VeriFi Agents, a bonded financial diligence network. "
            "Given a diligence request, decide which specialist agents to engage. Each specialist "
            "costs the requester's budget, so only pick ones actually relevant to the request:\n\n"
            + "\n".join(f"- {sid}: {desc}" for sid, desc in ALL_SPECIALISTS.items())
            + "\n\nAlso assign this specific request a short, fitting category label -- requesters "
            "aren't restricted to a fixed template list, so invent a label that actually describes "
            "what this request is asking for, don't force it into a generic bucket."
        ),
        response_format=SpecialistPlan,
    )
    template_hint = f"\nRequester-supplied template hint: {job_req.template}" if job_req.template else ""
    result = await agent.ainvoke({
        "messages": [{
            "role": "user",
            "content": f"Request: {job_req.request_text}\nProtocol slug: {job_req.protocol_slug}\nBudget: {job_req.budget_usdc} USDC{template_hint}",
        }]
    })
    plan: SpecialistPlan = result["structured_response"]
    plan.specialist_ids = [s for s in plan.specialist_ids if s in ALL_SPECIALISTS] or list(ALL_SPECIALISTS)
    log("orchestrator", f"LLM plan: {plan.specialist_ids} -- {plan.reasoning}", style="bold cyan")
    log("orchestrator", f"LLM category label: '{plan.template_label}'", style="grey62")
    return plan


async def write_memo(job_req: JobRequest, claims: list[Claim]) -> str:
    if not claims:
        # No claims exist to cite -- this isn't a case where an LLM call
        # adds judgment, the correct memo is fixed regardless of which
        # model you ask. Observed without this guard: the model filled
        # the gap with unsourced training-data "facts" (specific TVL
        # figures, named auditors, a fabricated date) that read exactly
        # like real diligence output despite zero underlying evidence --
        # exactly the failure mode this project exists to prevent.
        log("orchestrator", "no claims gathered -- skipping memo LLM call, returning an explicit no-data notice", style="grey62")
        return (
            f"# {job_req.protocol_slug} Diligence Memo\n\n"
            "No claims were successfully gathered for this request (every specialist call "
            "either failed or returned no data). This memo cannot make any verified "
            "statements about the protocol. Resubmit the job to try again."
        )

    agent = create_agent(
        model=get_model("orchestrator"),
        tools=[],
        system_prompt=(
            "You write concise financial diligence memos from a list of verified claims. "
            "Cite every claim's source inline. Every factual statement in the memo must "
            "trace back to one of the claims given -- do not add facts, figures, dates, or "
            "names from your own general knowledge, even ones you believe to be true. If "
            "the claims don't cover something, omit it rather than filling the gap. "
            "End with a one-line risk rating (Low/Medium/High) based only on the claims given."
        ),
    )
    claims_text = "\n".join(f"- [{c.claim_type}] {c.claim_text} (source: {c.provider_source})" for c in claims)
    result = await agent.ainvoke({
        "messages": [{
            "role": "user",
            "content": f"Request: {job_req.request_text}\n\nClaims gathered:\n{claims_text}\n\nWrite the memo.",
        }]
    })
    return result["messages"][-1].content
