"""On-chain wallet flow / holder concentration.

wallet_flow uses the real Etherscan free-tier API when ETHERSCAN_API_KEY is
set. token_concentration needs Etherscan's paid "token holder list"
endpoint, which is out of reach for a zero-budget hackathon build, so it's
always a deterministic simulation here -- clearly flagged `simulated=True`
end to end (claim, verification record, and terminal output) rather than
silently faked. Swap `_simulate_concentration` for a real holder-list call
once a paid key or a subgraph is wired in.
"""
from __future__ import annotations
import hashlib
import httpx

from shared.config import ETHERSCAN_API_KEY

ETHERSCAN_TXLIST_URL = "https://api.etherscan.io/api"

# Publicly known exchange hot wallets, used only to demonstrate a real
# wallet_flow "did this address touch a labeled exchange wallet" check.
KNOWN_EXCHANGE_WALLETS = {
    "binance": "0x28c6c06298d514db089934071355e5743bf21d60",
    "coinbase": "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
}

# Canonical treasury address per protocol. Both the on-chain specialist and
# the evaluator import this same mapping -- the evaluator looks the address
# up independently by protocol_slug rather than trusting the specialist's
# claim_text, since claim_text is attacker/specialist-controlled.
PROTOCOL_TREASURY_ADDRESS = {
    "uniswap": "0x1a9c8182c09f50c8318d769245bea52c32be35bc",
    "aave": "0x464c71f6c2f760dda6093dcb91c24c39e5d6e18",
}


def _seed(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest(), 16)


async def check_wallet_flow(address: str, exchange_hint: str = "binance") -> tuple[bool, str, bool]:
    """Returns (touched_exchange, source, simulated)."""
    if ETHERSCAN_API_KEY:
        params = {
            "module": "account",
            "action": "txlist",
            "address": address,
            "sort": "desc",
            "apikey": ETHERSCAN_API_KEY,
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(ETHERSCAN_TXLIST_URL, params=params)
            resp.raise_for_status()
            txs = resp.json().get("result", [])
        target = KNOWN_EXCHANGE_WALLETS.get(exchange_hint, "")
        touched = any(target and (tx.get("from", "").lower() == target or tx.get("to", "").lower() == target) for tx in txs)
        return touched, f"{ETHERSCAN_TXLIST_URL}?address={address}", False

    # SIMULATED fallback: deterministic so repeated demo runs are stable.
    touched = _seed(address.lower()) % 3 != 0
    return touched, "simulated:etherscan", True


async def token_concentration_top10_pct(protocol_slug: str) -> tuple[float, str, bool]:
    """Returns (top10_holder_pct, source, simulated). Always simulated in MVP -- see module docstring."""
    pct = 20.0 + (_seed(protocol_slug) % 4000) / 100.0  # deterministic pseudo-value in [20, 60)
    return round(pct, 2), "simulated:holder-distribution", True
