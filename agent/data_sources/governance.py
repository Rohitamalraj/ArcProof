"""Live governance data -- Snapshot's public GraphQL API needs no API key."""
from __future__ import annotations
from datetime import datetime, timezone
import httpx

SNAPSHOT_GRAPHQL_URL = "https://hub.snapshot.org/graphql"

SLUG_TO_SNAPSHOT_SPACE = {
    "aave": "aave.eth",
    "lido": "lido-snapshot.eth",
    "uniswap": "uniswapgovernance.eth",
    "compound": "comp-vote.eth",
    "maker": "makerdao.eth",
    "makerdao": "makerdao.eth",
    "curve": "curve.eth",
    "balancer": "balancer.eth",
    "sushiswap": "sushigov.eth",
}

_QUERY = """
query Proposals($space: String!, $first: Int!) {
  proposals(
    first: $first
    skip: 0
    where: { space: $space, state: "closed" }
    orderBy: "created"
    orderDirection: desc
  ) {
    id
    title
    state
    scores
    choices
    end
  }
}
"""


async def fetch_recent_closed_proposals(protocol_slug: str, limit: int = 5) -> tuple[list[dict], str]:
    space = SLUG_TO_SNAPSHOT_SPACE.get(protocol_slug)
    if not space:
        raise ValueError(f"no snapshot space mapped for slug '{protocol_slug}'")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            SNAPSHOT_GRAPHQL_URL,
            json={"query": _QUERY, "variables": {"space": space, "first": limit}},
        )
        resp.raise_for_status()
        proposals = resp.json()["data"]["proposals"]

    for p in proposals:
        if p["scores"] and p["choices"]:
            winning_index = max(range(len(p["scores"])), key=lambda i: p["scores"][i])
            p["winning_choice"] = p["choices"][winning_index]
        else:
            p["winning_choice"] = None
        p["end_date"] = datetime.fromtimestamp(p["end"], tz=timezone.utc).date().isoformat()

    return proposals, f"{SNAPSHOT_GRAPHQL_URL} (space={space})"
