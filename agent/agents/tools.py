"""LangChain tool wrappers around this project's real data source
connectors (data_sources/*) -- shared by every true LLM agent (the three
specialists and the evaluator) so both "gather a claim" and
"independently re-check a claim" reasoning steps call the exact same
live sources, just under different system prompts.

Every tool returns plain text (LLM tool results are always text) that
either states the real value/source/simulated flag, or an "ERROR: ..."
line the agent is instructed to treat as "skip this data point" --
matching the try/except-per-claim resilience the old deterministic
specialists had, now enforced via the system prompt instead of Python
control flow.
"""
from __future__ import annotations

from langchain_core.tools import tool

from data_sources import defillama, price, explorer, governance, news, sanctions


@tool
async def fetch_tvl(protocol_slug: str) -> str:
    """Fetch a protocol's current live Total Value Locked in USD from DefiLlama.
    Use the exact protocol_slug given for the job (e.g. 'aave', 'uniswap')."""
    try:
        tvl, source = await defillama.fetch_tvl(protocol_slug)
        return f"tvl_usd={tvl} source={source} simulated=false"
    except Exception as e:
        return f"ERROR: could not fetch TVL for '{protocol_slug}': {e}"


@tool
async def fetch_price_change(protocol_slug: str, days: int = 7) -> str:
    """Fetch a protocol token's real percent price change over the last N days
    (default 7) from CoinGecko."""
    try:
        pct, source = await price.fetch_price_change_pct(protocol_slug, days=days)
        return f"price_change_pct={pct:.2f} source={source} simulated=false"
    except Exception as e:
        return f"ERROR: could not fetch price history for '{protocol_slug}': {e}"


@tool
async def check_wallet_flow(protocol_slug: str, exchange_hint: str = "binance") -> str:
    """Check whether a protocol's known treasury wallet sent funds to a labeled
    exchange wallet recently. Looks up the treasury address for protocol_slug
    internally -- never guess an address yourself."""
    address = explorer.PROTOCOL_TREASURY_ADDRESS.get(protocol_slug)
    if not address:
        return f"ERROR: no known treasury address for protocol '{protocol_slug}' -- skip the wallet_flow claim."
    try:
        touched, source, simulated = await explorer.check_wallet_flow(address, exchange_hint=exchange_hint)
        return f"treasury_address={address} touched_exchange={str(touched).lower()} source={source} simulated={str(simulated).lower()}"
    except Exception as e:
        return f"ERROR: could not check wallet flow for '{address}': {e}"


@tool
async def token_concentration(protocol_slug: str) -> str:
    """Fetch the percent of token supply held by the top 10 holders for a protocol."""
    pct, source, simulated = await explorer.token_concentration_top10_pct(protocol_slug)
    return f"top10_holder_pct={pct} source={source} simulated={str(simulated).lower()}"


@tool
async def fetch_governance(protocol_slug: str) -> str:
    """Fetch the most recently closed governance proposal (title, end date,
    winning choice) for a protocol from Snapshot."""
    try:
        proposals, source = await governance.fetch_recent_closed_proposals(protocol_slug, limit=1)
    except ValueError as e:
        return f"ERROR: {e} -- skip the governance_event claim."
    if not proposals:
        return f"No closed governance proposals found for '{protocol_slug}' in Snapshot -- skip the governance_event claim."
    p = proposals[0]
    return f"title={p['title']!r} end_date={p['end_date']} winning_choice={p['winning_choice']} source={source}"


@tool
async def check_news_incident(protocol_slug: str, keyword: str = "exploit") -> str:
    """Check GDELT for a corroborated (2+ distinct reporting domains) recent
    security incident/exploit news for a protocol."""
    try:
        corroborated, sources, simulated = await news.check_news_incident(protocol_slug, keyword=keyword)
        return f"corroborated={str(corroborated).lower()} sources={sources} simulated={str(simulated).lower()}"
    except Exception as e:
        return f"ERROR: GDELT news check failed for '{protocol_slug}': {e} -- skip the news_incident claim."


@tool
async def check_sanctions(address: str) -> str:
    """Check whether a wallet address is on the real OFAC SDN sanctions list snapshot."""
    flagged, source = await sanctions.check_sanctions(address)
    return f"address={address} flagged={str(flagged).lower()} source={source}"


ONCHAIN_TOOLS = [fetch_tvl, fetch_price_change, check_wallet_flow, token_concentration]
NEWS_TOOLS = [fetch_governance, check_news_incident]
COMPLIANCE_TOOLS = [check_sanctions]
EVALUATOR_TOOLS = [
    fetch_tvl, fetch_price_change, check_wallet_flow, token_concentration,
    fetch_governance, check_news_incident, check_sanctions,
]
