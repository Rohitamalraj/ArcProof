/** Live TVL data -- DefiLlama's public API needs no API key. Ported from agent/data_sources/defillama.py. */

export interface TvlResult {
  tvlUsd: number;
  source: string;
}

export async function fetchTvl(protocolSlug: string): Promise<TvlResult> {
  const url = `https://api.llama.fi/tvl/${protocolSlug}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`DefiLlama request failed: ${resp.status}`);
  const tvlUsd = Number(await resp.json());
  return { tvlUsd, source: url };
}
