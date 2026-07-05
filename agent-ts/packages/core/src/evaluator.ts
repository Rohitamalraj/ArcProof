/**
 * Deterministic, rule-based claim verification.
 *
 * This is the single biggest deliberate correction versus the Python
 * version (agent/agents/evaluator.py), which delegated the match/mismatch/
 * unverifiable decision itself to an LLM's "judgment" (with ~5% offered
 * only as a guideline, not an enforced rule). The PRD (S9.3/S9.4) is
 * explicit that this decision must be rule-based specifically so verdicts
 * stay auditable -- a judge, a requester, or a specialist operator should
 * be able to redo the exact comparison below by hand from the printed
 * claim value + independently-fetched value and get the same verdict every
 * time. Nothing in this file calls an LLM.
 *
 * Independent sources are looked up the same way the Python version's
 * evaluator tools did: NEVER by trusting the claim's own claim_text/address
 * for *what* to check (that's specialist/attacker-controlled) -- only
 * claim_value is what gets judged, against a canonically-looked-up target
 * (protocol_slug -> treasury address, protocol_slug -> governance space,
 * job's own target_address for compliance).
 *
 * Tolerance/verdict rules (PRD S9.3/S9.4, documented here for auditability
 * per the PRD's own NFR requirement -- also restated in agent-ts/README.md):
 *   - tvl, price_change, token_concentration: numeric, match if the claimed
 *     value is within +/-5% (relative to the independently-fetched value)
 *     of that independent value.
 *   - wallet_flow, compliance_flag: categorical boolean, match only if the
 *     claimed boolean equals the independently-fetched boolean exactly.
 *   - governance_event: categorical, match if the claimed value
 *     (case-insensitive substring) appears in either the independently
 *     re-fetched proposal's title or its winning choice.
 *   - news_incident: 0 corroborating independent domains -> mismatch (looks
 *     fabricated), exactly 1 -> unverifiable (some evidence, not enough to
 *     confirm -- PRD's explicit "single-source is unverifiable, not match,
 *     and doesn't count against the provider" rule), 2+ -> match.
 *   - Any claim type with no independent source configured, or whose
 *     independent lookup itself fails/has no data, is unverifiable.
 */
import type { Claim, VerificationStatus } from "./schema.js";
import * as defillama from "./dataSources/defillama.js";
import * as price from "./dataSources/price.js";
import * as explorer from "./dataSources/explorer.js";
import * as governance from "./dataSources/governance.js";
import * as news from "./dataSources/news.js";
import * as sanctions from "./dataSources/sanctions.js";

export const NUMERIC_TOLERANCE_RATIO = 0.05; // +/-5%, PRD S9.4

export interface EvaluationContext {
  protocolSlug: string;
  targetAddress?: string | null;
}

interface Verdict {
  status: VerificationStatus;
  value?: boolean | number | string | null;
  source?: string;
  delta?: number | null;
  note: string;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
  }
  return null;
}

function compareNumeric(claimed: number, independent: number): { status: VerificationStatus; delta: number } {
  const deltaPct = independent !== 0 ? ((claimed - independent) / Math.abs(independent)) * 100 : claimed === 0 ? 0 : 100;
  const withinTolerance = Math.abs(deltaPct) <= NUMERIC_TOLERANCE_RATIO * 100;
  return { status: withinTolerance ? "match" : "mismatch", delta: Math.round(deltaPct * 100) / 100 };
}

async function verifyTvl(claim: Claim, ctx: EvaluationContext): Promise<Verdict> {
  const claimed = toNumber(claim.claim_value);
  if (claimed === null) return { status: "unverifiable", note: "claim_value is not a number" };
  try {
    const { tvlUsd, source } = await defillama.fetchTvl(ctx.protocolSlug);
    const { status, delta } = compareNumeric(claimed, tvlUsd);
    return { status, value: tvlUsd, source, delta, note: `claimed ${claimed} vs independent ${tvlUsd} (${delta >= 0 ? "+" : ""}${delta}%)` };
  } catch (e) {
    return { status: "unverifiable", note: `DefiLlama lookup failed: ${e}` };
  }
}

async function verifyPriceChange(claim: Claim, ctx: EvaluationContext): Promise<Verdict> {
  const claimed = toNumber(claim.claim_value);
  if (claimed === null) return { status: "unverifiable", note: "claim_value is not a number" };
  try {
    const { pctChange, source } = await price.fetchPriceChangePct(ctx.protocolSlug, 7);
    const { status, delta } = compareNumeric(claimed, pctChange);
    return { status, value: pctChange, source, delta, note: `claimed ${claimed}% vs independent ${pctChange.toFixed(2)}%` };
  } catch (e) {
    return { status: "unverifiable", note: `CoinGecko lookup failed: ${e}` };
  }
}

async function verifyTokenConcentration(claim: Claim, ctx: EvaluationContext): Promise<Verdict> {
  const claimed = toNumber(claim.claim_value);
  if (claimed === null) return { status: "unverifiable", note: "claim_value is not a number" };
  const { top10HolderPct, source } = await explorer.tokenConcentrationTop10Pct(ctx.protocolSlug);
  const { status, delta } = compareNumeric(claimed, top10HolderPct);
  return {
    status,
    value: top10HolderPct,
    source: `${source} (simulated -- see explorer.ts)`,
    delta,
    note: `claimed ${claimed}% vs independent ${top10HolderPct}%`,
  };
}

async function verifyWalletFlow(claim: Claim, ctx: EvaluationContext): Promise<Verdict> {
  const claimed = toBool(claim.claim_value);
  if (claimed === null) return { status: "unverifiable", note: "claim_value is not a boolean" };
  const address = explorer.PROTOCOL_TREASURY_ADDRESS[ctx.protocolSlug];
  if (!address) return { status: "unverifiable", note: `no known treasury address for protocol '${ctx.protocolSlug}'` };
  const { touchedExchange, source, simulated } = await explorer.checkWalletFlow(address);
  return {
    status: claimed === touchedExchange ? "match" : "mismatch",
    value: touchedExchange,
    source: simulated ? `${source} (simulated)` : source,
    note: `claimed touched_exchange=${claimed} vs independent=${touchedExchange}`,
  };
}

async function verifyGovernanceEvent(claim: Claim, ctx: EvaluationContext): Promise<Verdict> {
  if (typeof claim.claim_value !== "string" || !claim.claim_value) {
    return { status: "unverifiable", note: "claim_value is not a descriptive string" };
  }
  try {
    const { proposals, source } = await governance.fetchRecentClosedProposals(ctx.protocolSlug, 1);
    if (!proposals.length) return { status: "unverifiable", note: "no closed proposals found on Snapshot" };
    const p = proposals[0];
    const claimedValue = claim.claim_value.trim();
    const claimedLower = claimedValue.toLowerCase();
    const note = `most recent closed proposal: '${p.title}' (winner: ${p.winningChoice ?? "n/a"}, ended ${p.endDate})`;

    // The specialist reports this as several independent atomic claims
    // (proposal title, end date, winning choice) rather than one combined
    // description -- each shape needs checking on its own terms. The old
    // single "does this text relate to the proposal" substring test both
    // missed true date claims (a bare "2026-06-22" never contains the
    // title/winner text -> wrongly flagged a true claim as a mismatch) and
    // let a *fabricated* winner slip through as a false match (a substring
    // check means "FABRICATED-For" still contains the real winner "For").

    const dateMatch = claimedValue.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      return { status: dateMatch[0] === p.endDate ? "match" : "mismatch", value: p.endDate, source, note };
    }

    // A claim value much shorter than the proposal's own title is trying
    // to state the winning choice on its own (e.g. "For"), not restate the
    // title -- require it to equal the real choice exactly rather than
    // merely contain it, or a fabricated "FABRICATED-For" would pass.
    if (p.winningChoice && claimedValue.length <= p.title.length / 2) {
      return { status: claimedLower === p.winningChoice.toLowerCase() ? "match" : "mismatch", value: p.winningChoice, source, note };
    }

    const matches = claimedLower.includes(p.title.toLowerCase()) || p.title.toLowerCase().includes(claimedLower);
    return {
      status: matches ? "match" : "mismatch",
      value: `${p.title} -> ${p.winningChoice ?? "(no winner)"}`,
      source,
      note,
    };
  } catch (e) {
    return { status: "unverifiable", note: `Snapshot lookup failed: ${e}` };
  }
}

async function verifyNewsIncident(claim: Claim, ctx: EvaluationContext): Promise<Verdict> {
  // Independently derive a keyword from the claim text rather than trusting
  // a structured field -- "exploit" is the demo default the specialist's
  // own tool call also defaults to (agents/tools.py's check_news_incident).
  const keyword = /exploit|hack|incident/i.test(claim.claim_text) ? "exploit" : "incident";
  try {
    const { corroborated, sources } = await news.checkNewsIncident(ctx.protocolSlug, keyword);
    if (sources.length === 0) {
      return { status: "mismatch", value: false, source: "GDELT DOC 2.0 API", note: "zero independent reporting domains found -- claim appears unfounded" };
    }
    if (!corroborated) {
      return {
        status: "unverifiable",
        value: false,
        source: sources[0],
        note: "only 1 independent reporting domain found -- PRD requires 2+ to count as verified",
      };
    }
    return { status: "match", value: true, source: sources.join(", "), note: `corroborated by ${sources.length} independent domains` };
  } catch (e) {
    return { status: "unverifiable", note: `GDELT lookup failed: ${e}` };
  }
}

async function verifyComplianceFlag(claim: Claim, ctx: EvaluationContext): Promise<Verdict> {
  const claimed = toBool(claim.claim_value);
  if (claimed === null) return { status: "unverifiable", note: "claim_value is not a boolean" };
  if (!ctx.targetAddress) return { status: "unverifiable", note: "no target_address given on the job" };
  const { flagged, source } = await sanctions.checkSanctions(ctx.targetAddress);
  return {
    status: claimed === flagged ? "match" : "mismatch",
    value: flagged,
    source,
    note: `claimed flagged=${claimed} vs independent=${flagged} for ${ctx.targetAddress}`,
  };
}

const VERIFIERS: Record<string, (claim: Claim, ctx: EvaluationContext) => Promise<Verdict>> = {
  tvl: verifyTvl,
  price_change: verifyPriceChange,
  token_concentration: verifyTokenConcentration,
  wallet_flow: verifyWalletFlow,
  governance_event: verifyGovernanceEvent,
  news_incident: verifyNewsIncident,
  compliance_flag: verifyComplianceFlag,
};

/** Re-derives one claim's truth independently and returns the claim with verification_* fields filled in. */
export async function evaluateClaim(claim: Claim, ctx: EvaluationContext): Promise<Claim> {
  const verifier = VERIFIERS[claim.claim_type];
  let verdict: Verdict;
  if (!verifier) {
    verdict = { status: "unverifiable", note: `no independent verifier configured for claim_type '${claim.claim_type}'` };
  } else {
    try {
      verdict = await verifier(claim, ctx);
    } catch (e) {
      verdict = { status: "unverifiable", note: `verification failed unexpectedly: ${e}` };
    }
  }

  const evaluated: Claim = {
    ...claim,
    verification_status: verdict.status,
    verification_value: verdict.value ?? null,
    verification_source: verdict.source ?? null,
    verification_delta: verdict.delta ?? null,
    verification_note: verdict.note,
  };

  const label = { match: "MATCH", mismatch: "MISMATCH", unverifiable: "UNVERIFIABLE", pending: "PENDING" }[verdict.status];
  console.log(`[evaluator] [${claim.claim_type}] ${label} -- ${claim.claim_text} (${verdict.note})`);
  return evaluated;
}

export async function evaluateClaims(claims: Claim[], ctx: EvaluationContext): Promise<Claim[]> {
  return Promise.all(claims.map((c) => evaluateClaim(c, ctx)));
}
