"""Live price data -- CoinGecko's public API needs no API key."""
from __future__ import annotations
import httpx

MARKET_CHART_URL = "https://api.coingecko.com/api/v3/coins/{id}/market_chart"

# DefiLlama protocol slugs don't always match CoinGecko coin ids.
# Extend this as new protocols get added to demos.
SLUG_TO_COINGECKO_ID = {
    "aave": "aave",
    "lido": "lido-dao",
    "uniswap": "uniswap",
    "compound": "compound-governance-token",
    "curve": "curve-dao-token",
    "maker": "maker",
    "makerdao": "maker",
    "pancakeswap": "pancakeswap-token",
    "sushiswap": "sushi",
    "balancer": "balancer",
}


async def fetch_price_change_pct(protocol_slug: str, days: int = 7) -> tuple[float, str]:
    """Returns (pct_change_over_window, source_url). Raises on failure."""
    coin_id = SLUG_TO_COINGECKO_ID.get(protocol_slug, protocol_slug)
    url = MARKET_CHART_URL.format(id=coin_id)
    params = {"vs_currency": "usd", "days": str(days)}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        prices = resp.json()["prices"]  # list of [timestamp_ms, price]
        first_price = prices[0][1]
        last_price = prices[-1][1]
        pct_change = ((last_price - first_price) / first_price) * 100
        return pct_change, f"{url}?vs_currency=usd&days={days}"
