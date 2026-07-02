"""Sanctions screening against a curated, real OFAC SDN address snapshot.

See fixtures/sanctioned_addresses.json for provenance. This is real public
data, just not a live per-request fetch -- for production, swap `_load()`
to pull the full SDN list on a schedule (https://ofac.treasury.gov/sanctions-list-service)
instead of reading the static fixture.
"""
from __future__ import annotations
import json
import os

from shared.config import FIXTURES_DIR

_FIXTURE_PATH = os.path.join(FIXTURES_DIR, "sanctioned_addresses.json")
_cache: dict | None = None


def _load() -> dict:
    global _cache
    if _cache is None:
        with open(_FIXTURE_PATH) as f:
            _cache = json.load(f)
    return _cache


async def check_sanctions(address: str) -> tuple[bool, str]:
    """Returns (is_flagged, source)."""
    data = _load()
    flagged = address.lower() in {a.lower() for a in data["addresses"]}
    return flagged, data["source"]
