"""Conditional settlement (PRD S9.4/S9.5, implementation guide S4).

Deliberately rule-based, not model-based, so every accept/partial/reject
decision is auditable from this file alone -- see PRD "Non-Functional
Requirements: Auditability".

Verdict thresholds (document these -- PRD S9.4 NFR requires it):
  - Numeric claim match tolerance: +/-5% of the independently-sourced value.
  - Per-provider payout: full if 0 mismatches, 50% if exactly 1 mismatch,
    withheld (0%) if 2+ mismatches. Same N=1 threshold the PRD suggests at
    job level, reapplied per-provider so each specialist is judged on its
    own claims (PRD S9.5).
  - Job-level verdict: reject if a majority of checkable claims mismatch;
    partial if 1..N(=1) mismatch; accept if 0 mismatches. A compliance_flag
    mismatch is a floor, not a ceiling -- it prevents "accept" but doesn't
    by itself force "reject".
  - Unverifiable claims never count toward mismatches or payment.

`ledger.transfer(...)` below is real -- every payout is a mined Arc
testnet transaction (payments/chain.py), not a database write. Withheld
funds simply never leave the escrow wallet; there's no separate "hold"
step needed on a real chain. `compute_job_verdict` and
`compute_provider_payout` never touch payments directly, which is what
keeps the verdict math auditable independent of how settlement executes.
"""
from __future__ import annotations
from collections import defaultdict

from shared.schema import Claim, JobRecord, ProviderPayout, Verdict
from shared.console import log
from payments.wallet import ledger
from storage.store import reputation_store

NUMERIC_CLAIM_TYPES = {"tvl", "price_change", "token_concentration"}
PARTIAL_MISMATCH_THRESHOLD = 1  # N in PRD S9.4


def _checkable(claims: list[Claim]) -> list[Claim]:
    return [c for c in claims if c.verification_status in ("match", "mismatch")]


def compute_job_verdict(claims: list[Claim]) -> Verdict:
    checkable = _checkable(claims)
    mismatches = [c for c in checkable if c.verification_status == "mismatch"]

    if not checkable or not mismatches:
        verdict: Verdict = "accept"
    elif len(mismatches) > len(checkable) / 2:
        verdict = "reject"
    elif len(mismatches) <= PARTIAL_MISMATCH_THRESHOLD:
        verdict = "partial"
    else:
        verdict = "reject"

    compliance_mismatch = any(c.claim_type == "compliance_flag" and c.verification_status == "mismatch" for c in claims)
    if compliance_mismatch and verdict == "accept":
        verdict = "partial"  # floor: a compliance miss can never look like a clean pass

    return verdict


def compute_provider_payout(provider_agent_id: str, provider_claims: list[Claim], allocated_usdc: float) -> ProviderPayout:
    checkable = _checkable(provider_claims)
    matches = sum(1 for c in checkable if c.verification_status == "match")
    mismatches = sum(1 for c in checkable if c.verification_status == "mismatch")
    unverifiable = sum(1 for c in provider_claims if c.verification_status == "unverifiable")

    if mismatches == 0:
        fraction, outcome = 1.0, "full"
    elif mismatches <= PARTIAL_MISMATCH_THRESHOLD:
        fraction, outcome = 0.5, "partial"
    else:
        fraction, outcome = 0.0, "withheld"

    return ProviderPayout(
        provider_agent_id=provider_agent_id,
        claims_checked=len(checkable),
        matches=matches,
        mismatches=mismatches,
        unverifiable=unverifiable,
        allocated_usdc=round(allocated_usdc, 6),
        paid_usdc=round(allocated_usdc * fraction, 6),
        fraction_paid=fraction,
        outcome=outcome,
    )


async def settle(job: JobRecord) -> JobRecord:
    log("settlement", f"job {job.job_id}: computing verdict over {len(job.claims)} claims")

    job.overall_verdict = compute_job_verdict(job.claims)

    by_provider: dict[str, list[Claim]] = defaultdict(list)
    for c in job.claims:
        by_provider[c.provider_agent_id].append(c)

    n_providers = len(by_provider) or 1
    share = job.budget_usdc / n_providers

    payouts: list[ProviderPayout] = []
    total_paid = 0.0
    for provider_id, provider_claims in by_provider.items():
        payout = compute_provider_payout(provider_id, provider_claims, share)
        payouts.append(payout)

        if payout.paid_usdc > 0:
            ledger.transfer(
                "escrow",
                provider_id,
                payout.paid_usdc,
                memo=f"job {job.job_id} conditional payout ({payout.outcome})",
            )
            total_paid += payout.paid_usdc
        withheld = payout.allocated_usdc - payout.paid_usdc
        if withheld > 1e-9:
            ledger.refund_or_hold(
                "escrow", withheld, memo=f"job {job.job_id}: withheld from {provider_id} ({payout.outcome})"
            )

        reputation_store.record_job(provider_id, payout.matches, payout.mismatches, payout.unverifiable)
        log(
            "settlement",
            f"{provider_id}: {payout.matches} match / {payout.mismatches} mismatch / {payout.unverifiable} unverifiable "
            f"-> {payout.outcome} ({payout.paid_usdc:.4f}/{payout.allocated_usdc:.4f} USDC)",
        )

    job.payouts = payouts
    job.total_paid_usdc = round(total_paid, 6)
    job.status = {"accept": "accepted", "partial": "partial_accepted", "reject": "rejected"}[job.overall_verdict]

    log("settlement", f"job {job.job_id}: overall verdict = {job.overall_verdict.upper()}, total paid = {job.total_paid_usdc:.4f} USDC")
    return job
