"""Real news/incident corroboration via GDELT's DOC 2.0 API.

GDELT (gdeltproject.org) indexes global news continuously and its DOC API
is free and keyless. "Corroborated by two sources" (PRD S9.3) is measured
literally here: at least two distinct reporting domains covering the same
query within the lookback window.
"""
from __future__ import annotations
import asyncio
import httpx

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"


async def check_news_incident(protocol_slug: str, keyword: str, timespan: str = "14d") -> tuple[bool, list[str], bool]:
    """Returns (corroborated_by_two_sources, source_urls, simulated=False)."""
    query = f'"{protocol_slug}" "{keyword}"'
    params = {"query": query, "mode": "artlist", "maxrecords": "20", "timespan": timespan, "format": "json"}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(GDELT_URL, params=params)
        if resp.status_code == 429:  # GDELT rate-limits bursts; one retry covers demo-scale traffic
            await asyncio.sleep(2)
            resp = await client.get(GDELT_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    articles = data.get("articles", []) or []
    domains: dict[str, str] = {}
    for a in articles:
        domain = a.get("domain")
        url = a.get("url")
        if domain and domain not in domains:
            domains[domain] = url

    corroborated = len(domains) >= 2
    sources = list(domains.values())[:3] or [f"{GDELT_URL}?query={query}"]
    return corroborated, sources, False
