"""Real LangChain tool-calling agent (LangChain 1.x `create_agent`) that
decides which specialists a job actually needs and writes the requester-
facing memo prose. Replaces the fixed Template A/B specialist list with a
genuine LLM decision -- the orchestrator still executes the real x402
payment + HTTP calls, but which specialists get called is now the model's
call, not a hardcoded dict lookup.

Requires ANTHROPIC_API_KEY or OPENAI_API_KEY in .env. There is
deliberately no non-LLM fallback in this module -- if you want a real
agent decision, it needs a real model to ask. (The orchestrator still has
TEMPLATE_SPECIALISTS as a documented fallback for when no key is
configured -- see agents/orchestrator.py.)
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from langchain.agents import create_agent

from shared.config import ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY
from shared.schema import JobRequest, Claim
from shared.console import log

ALL_SPECIALISTS = {
    "onchain-agent-v1": "On-chain data: TVL, 7-day price change, treasury wallet flow to exchanges, token holder concentration.",
    "news-agent-v1": "News/fundamentals: most recent governance proposal outcome, reported security incidents.",
    "compliance-agent-v1": "Compliance/filings: OFAC sanctions screening for a specific wallet address.",
}


def model_id() -> str:
    # Google's free tier (aistudio.google.com/apikey, no credit card) is
    # checked first since it costs nothing for this project's small
    # planning/memo calls -- Anthropic/OpenAI are real pay-as-you-go
    # billing, so they're only used if explicitly configured instead.
    if GOOGLE_API_KEY:
        # gemini-2.5-flash's free tier is a project-wide 20-requests/DAY cap
        # (not per-minute) -- burns fast across a demo session (2 LLM calls
        # per job). gemini-2.5-flash-lite has its own separate quota bucket
        # on the same key and is otherwise equivalent for this project's
        # small planning/memo tasks.
        return "google_genai:gemini-2.5-flash-lite"
    if ANTHROPIC_API_KEY:
        return "anthropic:claude-sonnet-4-5"
    if OPENAI_API_KEY:
        return "openai:gpt-4o-mini"
    raise RuntimeError(
        "No LLM configured for the LangChain orchestrator -- set GOOGLE_API_KEY "
        "(free, aistudio.google.com/apikey), ANTHROPIC_API_KEY, or OPENAI_API_KEY "
        "in .env. (Falling back to the fixed template instead? See "
        "TEMPLATE_SPECIALISTS in agents/orchestrator.py.)"
    )


class SpecialistPlan(BaseModel):
    specialist_ids: list[str] = Field(description="Subset of onchain-agent-v1, news-agent-v1, compliance-agent-v1 to engage")
    reasoning: str = Field(description="One sentence on why these specialists (and not others) answer the request")


async def plan_specialists(job_req: JobRequest) -> SpecialistPlan:
    agent = create_agent(
        model=model_id(),
        tools=[],
        system_prompt=(
            "You are the orchestrator for VeriFi Agents, a bonded financial diligence network. "
            "Given a diligence request, decide which specialist agents to engage. Each specialist "
            "costs the requester's budget, so only pick ones actually relevant to the request:\n\n"
            + "\n".join(f"- {sid}: {desc}" for sid, desc in ALL_SPECIALISTS.items())
        ),
        response_format=SpecialistPlan,
    )
    result = await agent.ainvoke({
        "messages": [{
            "role": "user",
            "content": f"Request: {job_req.request_text}\nProtocol slug: {job_req.protocol_slug}\nTemplate: {job_req.template}\nBudget: {job_req.budget_usdc} USDC",
        }]
    })
    plan: SpecialistPlan = result["structured_response"]
    plan.specialist_ids = [s for s in plan.specialist_ids if s in ALL_SPECIALISTS] or list(ALL_SPECIALISTS)
    log("orchestrator", f"LLM plan: {plan.specialist_ids} -- {plan.reasoning}", style="bold cyan")
    return plan


async def write_memo(job_req: JobRequest, claims: list[Claim]) -> str:
    agent = create_agent(
        model=model_id(),
        tools=[],
        system_prompt=(
            "You write concise financial diligence memos from a list of verified claims. "
            "Cite every claim's source inline. Do not add facts not present in the claims. "
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
