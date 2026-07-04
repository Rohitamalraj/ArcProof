"""Wire-format schema shared by every agent (PRD S10). Import this, don't
redefine it -- it's what lets the orchestrator, specialists and evaluator
agree on shape without a runtime negotiation step.
"""
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field

ClaimType = Literal[
    "tvl",
    "price_change",
    "wallet_flow",
    "token_concentration",
    "governance_event",
    "news_incident",
    "compliance_flag",
]

VerificationStatus = Literal["pending", "match", "mismatch", "unverifiable"]
JobStatus = Literal["pending", "in_progress", "accepted", "partial_accepted", "rejected", "failed"]
Verdict = Literal["accept", "partial", "reject"]
Template = Literal["protocol_treasury_diligence", "yield_opportunity_review"]


class Claim(BaseModel):
    claim_id: str
    job_id: str
    provider_agent_id: str
    claim_type: ClaimType
    claim_text: str
    claim_value: Optional[bool | float | str] = None
    provider_source: str
    simulated: bool = False  # true if the provider's own data source was a fallback fixture, not a live call

    verification_status: VerificationStatus = "pending"
    verification_source: Optional[str] = None
    verification_value: Optional[bool | float | str] = None
    verification_delta: Optional[float] = None
    verification_note: Optional[str] = None


class SpecialistResponse(BaseModel):
    provider_agent_id: str
    job_id: str
    claims: list[Claim]


class JobRequest(BaseModel):
    request_text: str
    template: Template = "protocol_treasury_diligence"
    budget_usdc: float = Field(gt=0)
    protocol_slug: str  # e.g. "aave", "lido" -- DefiLlama slug, also used for price/governance lookups
    requester_wallet: str = "requester"
    payment_tx_hash: Optional[str] = None  # real on-chain tx moving budget_usdc requester -> escrow; set by a connected browser wallet, verified independently rather than trusted
    target_address: Optional[str] = None  # wallet checked by the compliance agent; defaults to a clean demo address
    inject_fault: Optional[Literal["onchain", "news", "compliance"]] = None  # demo-only: force a specialist to fabricate a claim


class ProviderPayout(BaseModel):
    provider_agent_id: str
    claims_checked: int
    matches: int
    mismatches: int
    unverifiable: int
    allocated_usdc: float
    paid_usdc: float
    fraction_paid: float
    outcome: Literal["full", "partial", "withheld"]


class JobRecord(BaseModel):
    job_id: str
    requester_id: str
    template: Template
    request_text: str
    protocol_slug: str
    budget_usdc: float
    status: JobStatus = "pending"
    created_at: str
    subtasks: list[str] = Field(default_factory=list)
    final_memo: Optional[str] = None
    overall_verdict: Optional[Verdict] = None
    total_paid_usdc: float = 0.0
    claims: list[Claim] = Field(default_factory=list)
    payouts: list[ProviderPayout] = Field(default_factory=list)


class ReputationRecord(BaseModel):
    provider_agent_id: str
    total_jobs: int = 0
    accepted_claims: int = 0
    mismatched_claims: int = 0
    unverifiable_claims: int = 0
    accuracy_score: float = 1.0
    last_updated: str = ""
