"""Shared LLM model selection for every LangChain agent in this project
(orchestrator planner/memo writer, the three specialists, the evaluator)
-- one place to pick the model so every true agent uses the same
provider fallback order.

Deliberately no non-LLM return value: every agent that calls this is a
real tool-calling LangChain agent now, not a rule-based fallback wearing
an agent's name. See README "What's real right now" for the per-agent
resilience story on transient failures (quota, network) vs. this
config-time check (no key at all).
"""
from __future__ import annotations

from langchain_google_genai import ChatGoogleGenerativeAI

from shared.config import ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEYS_BY_ROLE


def get_model(role: str) -> str | ChatGoogleGenerativeAI:
    """Returns whatever `create_agent(model=...)` should be given for this
    agent role -- a real ChatGoogleGenerativeAI instance bound to that
    role's own API key if one is configured (see GOOGLE_API_KEYS_BY_ROLE in
    shared/config.py, five separate free-tier keys so five agents don't
    share one 20-requests/day quota bucket), else a plain provider:model
    string that langchain resolves from ANTHROPIC_API_KEY/OPENAI_API_KEY.
    """
    google_key = GOOGLE_API_KEYS_BY_ROLE.get(role, "")
    if google_key:
        return ChatGoogleGenerativeAI(model="gemini-2.5-flash-lite", google_api_key=google_key)
    if ANTHROPIC_API_KEY:
        return "anthropic:claude-sonnet-4-5"
    if OPENAI_API_KEY:
        return "openai:gpt-4o-mini"
    raise RuntimeError(
        f"No LLM configured for role '{role}' -- set GOOGLE_API_KEY (or a "
        f"role-specific GOOGLE_API_KEY_* variant, free, aistudio.google.com/apikey), "
        f"ANTHROPIC_API_KEY, or OPENAI_API_KEY in .env. Every agent in this project "
        f"(orchestrator, specialists, evaluator) is a real LLM tool-calling agent and "
        f"needs a real model to ask."
    )
