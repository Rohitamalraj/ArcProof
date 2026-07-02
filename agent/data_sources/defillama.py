"""Live TVL data -- DefiLlama's public API needs no API key."""
from __future__ import annotations
import httpx

DEFILLAMA_URL = "https://api.llama.fi/tvl/{slug}"


async def fetch_tvl(protocol_slug: str) -> tuple[float, str]:
    """Returns (tvl_usd, source_url). Raises on network/parse failure."""
    url = DEFILLAMA_URL.format(slug=protocol_slug)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        tvl = float(resp.json())
        return tvl, url
