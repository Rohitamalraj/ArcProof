import { BACKEND_TIMEOUT_MS } from "@/lib/constants";
import type {
  BackendConfig,
  Claim,
  JobLogEntry,
  JobRequest,
  JobResponse,
  Payout,
  ReputationRecord,
  ReputationResponse,
} from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://127.0.0.1:8000";
// Only needed once the orchestrator's optional API_KEY (services/src/security.ts)
// is actually set server-side -- unset by default, so this is a no-op locally.
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

function authHeaders(): Record<string, string> {
  return API_KEY ? { "X-Api-Key": API_KEY } : {};
}

function withTimeoutSignal(timeoutMs: number): AbortSignal {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  ctrl.signal.addEventListener("abort", () => clearTimeout(timeoutId), { once: true });
  return ctrl.signal;
}

function normalizeClaim(claim: Partial<Claim>): Claim {
  return {
    claim_id: claim.claim_id || "",
    job_id: claim.job_id || "",
    provider_agent_id: claim.provider_agent_id || "",
    claim_type: (claim.claim_type || "tvl") as Claim["claim_type"],
    claim_text: claim.claim_text || "",
    claim_value: claim.claim_value ?? null,
    provider_source: claim.provider_source || "",
    simulated: Boolean(claim.simulated),
    verification_status: (claim.verification_status || "unverifiable") as Claim["verification_status"],
    verification_source: claim.verification_source || "",
    verification_value: claim.verification_value ?? null,
    verification_delta: claim.verification_delta ?? null,
    verification_note: claim.verification_note || "",
  };
}

function normalizePayout(payout: Partial<Payout>): Payout {
  return {
    provider_agent_id: payout.provider_agent_id || "",
    claims_checked: payout.claims_checked ?? 0,
    matches: payout.matches ?? 0,
    mismatches: payout.mismatches ?? 0,
    unverifiable: payout.unverifiable ?? 0,
    allocated_usdc: payout.allocated_usdc ?? 0,
    paid_usdc: payout.paid_usdc ?? 0,
    fraction_paid: payout.fraction_paid ?? 0,
    outcome: (payout.outcome || "withheld") as Payout["outcome"],
    nanopayment_tx_hash: payout.nanopayment_tx_hash ?? null,
    settlement_tx_hash: payout.settlement_tx_hash ?? null,
  };
}

function normalizeJob(raw: unknown): JobResponse {
  const data = (raw || {}) as Record<string, unknown>;
  const claims = Array.isArray(data.claims)
    ? (data.claims as Partial<Claim>[]).map(normalizeClaim)
    : [];
  const payouts = Array.isArray(data.payouts)
    ? (data.payouts as Partial<Payout>[]).map(normalizePayout)
    : [];

  return {
    job_id: String(data.job_id || ""),
    requester_id: String(data.requester_id || "requester"),
    template: String(data.template || "unclassified"),
    request_text: String(data.request_text || ""),
    protocol_slug: String(data.protocol_slug || ""),
    budget_usdc: Number(data.budget_usdc || 0),
    status: (data.status || "failed") as JobResponse["status"],
    created_at: String(data.created_at || new Date().toISOString()),
    subtasks: Array.isArray(data.subtasks) ? (data.subtasks as string[]) : [],
    final_memo: String(data.final_memo || ""),
    overall_verdict: (data.overall_verdict || "reject") as JobResponse["overall_verdict"],
    total_paid_usdc: Number(data.total_paid_usdc || 0),
    claims,
    payouts,
    lock_tx_hash: (data.lock_tx_hash as string) ?? null,
    finalize_tx_hash: (data.finalize_tx_hash as string) ?? null,
    refund_tx_hash: (data.refund_tx_hash as string) ?? null,
  };
}

function normalizeReputation(raw: unknown): ReputationResponse {
  if (!raw) {
    return {};
  }

  // Supports both the exact role-keyed map shape and a list shape.
  if (Array.isArray(raw)) {
    const result: ReputationResponse = {};
    for (const item of raw as Partial<ReputationRecord>[]) {
      const id = String(item.provider_agent_id || "");
      if (!id) {
        continue;
      }
      result[id] = {
        provider_agent_id: id,
        total_jobs: item.total_jobs ?? 0,
        accepted_claims: item.accepted_claims ?? 0,
        mismatched_claims: item.mismatched_claims ?? 0,
        unverifiable_claims: item.unverifiable_claims ?? 0,
        accuracy_score: item.accuracy_score ?? 0,
        last_updated: item.last_updated || "",
      };
    }
    return result;
  }

  const out: ReputationResponse = {};
  const map = raw as Record<string, Partial<ReputationRecord>>;
  for (const [key, value] of Object.entries(map)) {
    const id = String(value.provider_agent_id || key);
    out[id] = {
      provider_agent_id: id,
      total_jobs: value.total_jobs ?? 0,
      accepted_claims: value.accepted_claims ?? 0,
      mismatched_claims: value.mismatched_claims ?? 0,
      unverifiable_claims: value.unverifiable_claims ?? 0,
      accuracy_score: value.accuracy_score ?? 0,
      last_updated: value.last_updated || "",
    };
  }
  return out;
}

export async function submitJob(req: JobRequest): Promise<JobResponse> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(req),
      signal: withTimeoutSignal(BACKEND_TIMEOUT_MS),
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("timeout: Agents are still working. This job may take a moment longer.");
    }
    throw error;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Job submission failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return normalizeJob(data);
}

export async function getJob(job_id: string): Promise<JobResponse> {
  const res = await fetch(`${BASE}/jobs/${job_id}`, {
    signal: withTimeoutSignal(30000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Job fetch failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return normalizeJob(data);
}

/** Every job this orchestrator has ever processed (JSON-file backed,
 * server-side) -- unlike JobHistoryList's localStorage list, this isn't
 * limited to jobs submitted from the current browser. */
export async function getJobs(): Promise<JobResponse[]> {
  const res = await fetch(`${BASE}/jobs`, {
    signal: withTimeoutSignal(30000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jobs fetch failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data.map(normalizeJob) : [];
}

export async function getReputation(): Promise<ReputationResponse> {
  const res = await fetch(`${BASE}/reputation`, {
    signal: withTimeoutSignal(30000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Reputation fetch failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return normalizeReputation(data);
}

export async function getWallets(): Promise<Record<string, number>> {
  const res = await fetch(`${BASE}/wallets`, {
    signal: withTimeoutSignal(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Wallets fetch failed (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Polled while a job is in flight (POST /jobs is one long synchronous call
 * server-side; this is the only way to see activity before it resolves).
 * The job_id is already known client-side before submission (see
 * lib/wallet.ts's generateJobId()), so polling can start immediately.
 * Fails soft (empty array) instead of throwing -- a missed poll tick
 * shouldn't interrupt the actual job or surface as a user-facing error.
 */
export async function getJobLogs(job_id: string): Promise<JobLogEntry[]> {
  try {
    const res = await fetch(`${BASE}/jobs/${job_id}/logs`, { signal: withTimeoutSignal(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.logs) ? (data.logs as JobLogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function getConfig(): Promise<BackendConfig> {
  const res = await fetch(`${BASE}/config`, {
    signal: withTimeoutSignal(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Config fetch failed (${res.status}): ${err}`);
  }
  return res.json();
}
