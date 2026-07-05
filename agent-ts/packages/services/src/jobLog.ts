/**
 * In-memory, per-job activity log -- what a frontend polls (GET
 * /jobs/:id/logs) to show live agent/transaction activity while a job is
 * being processed, since POST /jobs itself is a single synchronous call
 * that only resolves once the whole job is done.
 *
 * Deliberately in-memory only (no persistence, doesn't survive a service
 * restart) -- this is a live-status feed, not the source of truth. The
 * JobRecord (store.ts, JSON-file backed) remains the durable record once a
 * job completes; this is only useful *during* processing.
 */
export type JobLogLevel = "info" | "success" | "warn" | "error";

// Actor ids used consistently by both from/to fields below: "requester",
// "orchestrator", "onchain-agent-v1", "news-agent-v1", "compliance-agent-v1",
// "evaluator-v1", "escrow" (the contract itself, not a role wallet).
export type JobLogKind = "call" | "payment" | "response" | "verdict" | "settlement" | "system";

export interface JobLogEntry {
  ts: string;
  level: JobLogLevel;
  message: string;
  txHash?: string;
  explorerUrl?: string;
  // Optional structured who-talked-to-whom metadata -- lets a frontend
  // (the 3D agent-network scene) animate real agent-to-agent communication
  // driven by actual events instead of guessing from free-text `message`.
  // Not every entry has one (e.g. "writing the memo" has no counterparty).
  from?: string;
  to?: string;
  kind?: JobLogKind;
}

const logs = new Map<string, JobLogEntry[]>();

// Caps memory for long-running processes across many jobs -- old entries
// for a job are only ever read once (right after completion) before the
// frontend switches to the durable JobRecord, so losing very old jobs'
// transient logs here has no real cost.
const MAX_JOBS_TRACKED = 200;

export function startJobLog(jobId: string): void {
  if (logs.size >= MAX_JOBS_TRACKED) {
    const oldest = logs.keys().next().value;
    if (oldest) logs.delete(oldest);
  }
  logs.set(jobId, []);
}

export function logEvent(
  jobId: string,
  level: JobLogLevel,
  message: string,
  tx?: { txHash?: string; explorerUrl?: string },
  actors?: { from?: string; to?: string; kind?: JobLogKind }
): void {
  const entry: JobLogEntry = {
    ts: new Date().toISOString(),
    level,
    message,
    txHash: tx?.txHash,
    explorerUrl: tx?.explorerUrl,
    from: actors?.from,
    to: actors?.to,
    kind: actors?.kind,
  };
  const arr = logs.get(jobId);
  if (arr) {
    arr.push(entry);
  } else {
    logs.set(jobId, [entry]);
  }
  const txSuffix = tx?.txHash ? ` (tx ${tx.txHash})` : "";
  console.log(`[job-log] ${jobId} :: ${message}${txSuffix}`);
}

export function getJobLog(jobId: string): JobLogEntry[] {
  return logs.get(jobId) ?? [];
}
