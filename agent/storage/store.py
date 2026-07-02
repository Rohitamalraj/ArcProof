"""JSON-file-backed job and reputation storage.

No DB setup needed for a hackathon build. Not concurrency-hardened beyond
a per-process lock -- fine for the single-process demo runner and for
separate-terminal mode since each store instance re-reads the file on
every op.
"""
from __future__ import annotations
import json
import os
from datetime import datetime, timezone
from threading import Lock

from shared.schema import JobRecord, ReputationRecord
from shared.config import DATA_DIR


class JobStore:
    def __init__(self, path: str | None = None):
        self._path = path or os.path.join(DATA_DIR, "jobs.json")
        self._lock = Lock()

    def _read_all(self) -> dict[str, dict]:
        if not os.path.exists(self._path):
            return {}
        with open(self._path) as f:
            return json.load(f)

    def _write_all(self, data: dict[str, dict]) -> None:
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(data, f, indent=2, default=str)

    def save(self, job: JobRecord) -> None:
        with self._lock:
            data = self._read_all()
            data[job.job_id] = job.model_dump()
            self._write_all(data)

    def get(self, job_id: str) -> JobRecord | None:
        data = self._read_all()
        raw = data.get(job_id)
        return JobRecord(**raw) if raw else None

    def list_all(self) -> list[JobRecord]:
        return [JobRecord(**raw) for raw in self._read_all().values()]


class ReputationStore:
    def __init__(self, path: str | None = None):
        self._path = path or os.path.join(DATA_DIR, "reputation.json")
        self._lock = Lock()

    def _read_all(self) -> dict[str, dict]:
        if not os.path.exists(self._path):
            return {}
        with open(self._path) as f:
            return json.load(f)

    def _write_all(self, data: dict[str, dict]) -> None:
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(data, f, indent=2, default=str)

    def get(self, provider_agent_id: str) -> ReputationRecord:
        data = self._read_all()
        raw = data.get(provider_agent_id)
        if raw:
            return ReputationRecord(**raw)
        return ReputationRecord(provider_agent_id=provider_agent_id)

    def list_all(self) -> list[ReputationRecord]:
        return [ReputationRecord(**raw) for raw in self._read_all().values()]

    def record_job(self, provider_agent_id: str, matches: int, mismatches: int, unverifiable: int) -> ReputationRecord:
        with self._lock:
            data = self._read_all()
            raw = data.get(provider_agent_id)
            rec = ReputationRecord(**raw) if raw else ReputationRecord(provider_agent_id=provider_agent_id)

            rec.total_jobs += 1
            rec.accepted_claims += matches
            rec.mismatched_claims += mismatches
            rec.unverifiable_claims += unverifiable
            checkable = rec.accepted_claims + rec.mismatched_claims
            rec.accuracy_score = round(rec.accepted_claims / checkable, 4) if checkable else 1.0
            rec.last_updated = datetime.now(timezone.utc).isoformat()

            data[provider_agent_id] = rec.model_dump()
            self._write_all(data)
        return rec


job_store = JobStore()
reputation_store = ReputationStore()
