"""Structured-output schemas for the true LLM agents (specialists +
evaluator). Kept separate from shared/schema.py, which is the wire format
every agent exchanges over HTTP -- these are only the shape an agent's
LLM call itself is constrained to, before the server assigns claim_id/
job_id/provider_agent_id and turns a draft into a real Claim.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field

from shared.schema import ClaimType, VerificationStatus


class ClaimDraft(BaseModel):
    claim_type: ClaimType
    claim_text: str = Field(description="Human-readable statement of the claim, citing the number/fact")
    claim_value: Optional[bool | float | str] = Field(description="The exact value returned by the tool used, copied verbatim -- never estimated")
    provider_source: str = Field(description="The exact source string/URL returned by the tool used")
    simulated: bool = Field(default=False, description="True only if the tool's result explicitly said simulated=true")


class SpecialistClaims(BaseModel):
    claims: list[ClaimDraft] = Field(description="One entry per data point actually gathered via a tool call -- omit any the tools couldn't produce")


class ClaimVerdict(BaseModel):
    claim_id: str = Field(description="Must exactly match a claim_id given in the input")
    verification_status: VerificationStatus
    verification_value: Optional[bool | float | str] = Field(default=None, description="The independently-fetched value, verbatim from the tool")
    verification_source: Optional[str] = Field(default=None, description="The exact source string/URL returned by the tool used to check this claim")
    verification_delta: Optional[float] = Field(default=None, description="Numeric difference (claim minus independently-fetched value) for numeric claims, else null")
    verification_note: Optional[str] = Field(default=None, description="Short justification for the verdict, e.g. why unverifiable or why within/outside tolerance")


class EvaluationOutput(BaseModel):
    verdicts: list[ClaimVerdict] = Field(description="Exactly one verdict per claim_id given in the input, same claim_ids")
