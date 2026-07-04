/** Live governance data -- Snapshot's public GraphQL API needs no API key. Ported from agent/data_sources/governance.py. */

const SNAPSHOT_GRAPHQL_URL = "https://hub.snapshot.org/graphql";

const SLUG_TO_SNAPSHOT_SPACE: Record<string, string> = {
  aave: "aave.eth",
  lido: "lido-snapshot.eth",
  uniswap: "uniswapgovernance.eth",
  compound: "comp-vote.eth",
  maker: "makerdao.eth",
  makerdao: "makerdao.eth",
  curve: "curve.eth",
  balancer: "balancer.eth",
  sushiswap: "sushigov.eth",
};

const QUERY = `
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
`;

export interface GovernanceProposal {
  id: string;
  title: string;
  state: string;
  scores: number[];
  choices: string[];
  end: number;
  winningChoice: string | null;
  endDate: string;
}

export async function fetchRecentClosedProposals(
  protocolSlug: string,
  limit = 5
): Promise<{ proposals: GovernanceProposal[]; source: string }> {
  const space = SLUG_TO_SNAPSHOT_SPACE[protocolSlug];
  if (!space) {
    throw new Error(`no snapshot space mapped for slug '${protocolSlug}'`);
  }

  const resp = await fetch(SNAPSHOT_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { space, first: limit } }),
  });
  if (!resp.ok) throw new Error(`Snapshot request failed: ${resp.status}`);
  const json = (await resp.json()) as { data: { proposals: Omit<GovernanceProposal, "winningChoice" | "endDate">[] } };
  const proposals = json.data.proposals;

  const enriched: GovernanceProposal[] = proposals.map((p) => {
    let winningChoice: string | null = null;
    if (p.scores?.length && p.choices?.length) {
      let winningIndex = 0;
      for (let i = 1; i < p.scores.length; i++) {
        if (p.scores[i] > p.scores[winningIndex]) winningIndex = i;
      }
      winningChoice = p.choices[winningIndex];
    }
    const endDate = new Date(p.end * 1000).toISOString().slice(0, 10);
    return { ...p, winningChoice, endDate };
  });

  return { proposals: enriched, source: `${SNAPSHOT_GRAPHQL_URL} (space=${space})` };
}
