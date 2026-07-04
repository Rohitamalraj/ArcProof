/**
 * JSON-file-backed job and reputation storage. Ported from
 * agent/storage/store.py.
 *
 * No DB setup needed for a hackathon build. Not concurrency-hardened beyond
 * a simple in-process queue per store -- fine for a single-process demo
 * runner and for separate-terminal mode since each store instance re-reads
 * the file on every op.
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import { JobRecordSchema, ReputationRecordSchema, type JobRecord, type ReputationRecord } from "./schema.js";

// Simple promise-chain mutex -- Node is single-threaded, so this is enough
// to serialize read-modify-write cycles across concurrent async callers.
function makeMutex() {
  let queue: Promise<unknown> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };
}

class JobStore {
  private path: string;
  private lock = makeMutex();

  constructor(filePath?: string) {
    this.path = filePath || path.join(DATA_DIR, "jobs.json");
  }

  private readAll(): Record<string, unknown> {
    if (!fs.existsSync(this.path)) return {};
    return JSON.parse(fs.readFileSync(this.path, "utf-8"));
  }

  private writeAll(data: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(data, null, 2));
  }

  save(job: JobRecord): Promise<void> {
    return this.lock(() => {
      const data = this.readAll();
      data[job.job_id] = job;
      this.writeAll(data);
    });
  }

  get(jobId: string): JobRecord | null {
    const data = this.readAll();
    const raw = data[jobId];
    return raw ? JobRecordSchema.parse(raw) : null;
  }

  listAll(): JobRecord[] {
    return Object.values(this.readAll()).map((raw) => JobRecordSchema.parse(raw));
  }
}

class ReputationStore {
  private path: string;
  private lock = makeMutex();

  constructor(filePath?: string) {
    this.path = filePath || path.join(DATA_DIR, "reputation.json");
  }

  private readAll(): Record<string, unknown> {
    if (!fs.existsSync(this.path)) return {};
    return JSON.parse(fs.readFileSync(this.path, "utf-8"));
  }

  private writeAll(data: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(data, null, 2));
  }

  get(providerAgentId: string): ReputationRecord {
    const data = this.readAll();
    const raw = data[providerAgentId];
    return raw ? ReputationRecordSchema.parse(raw) : ReputationRecordSchema.parse({ provider_agent_id: providerAgentId });
  }

  listAll(): ReputationRecord[] {
    return Object.values(this.readAll()).map((raw) => ReputationRecordSchema.parse(raw));
  }

  recordJob(providerAgentId: string, matches: number, mismatches: number, unverifiable: number): Promise<ReputationRecord> {
    return this.lock(() => {
      const data = this.readAll();
      const raw = data[providerAgentId];
      const rec = raw ? ReputationRecordSchema.parse(raw) : ReputationRecordSchema.parse({ provider_agent_id: providerAgentId });

      rec.total_jobs += 1;
      rec.accepted_claims += matches;
      rec.mismatched_claims += mismatches;
      rec.unverifiable_claims += unverifiable;
      const checkableCount = rec.accepted_claims + rec.mismatched_claims;
      rec.accuracy_score = checkableCount ? Math.round((rec.accepted_claims / checkableCount) * 10000) / 10000 : 1.0;
      rec.last_updated = new Date().toISOString();

      data[providerAgentId] = rec;
      this.writeAll(data);
      return rec;
    });
  }
}

export const jobStore = new JobStore();
export const reputationStore = new ReputationStore();
