/** Live price data -- CoinGecko's public API needs no API key. Ported from agent/data_sources/price.py. */

const MARKET_CHART_URL = "https://api.coingecko.com/api/v3/coins/{id}/market_chart";

// DefiLlama protocol slugs don't always match CoinGecko coin ids.
// Extend this as new protocols get added to demos.
const SLUG_TO_COINGECKO_ID: Record<string, string> = {
  aave: "aave",
  lido: "lido-dao",
  uniswap: "uniswap",
  compound: "compound-governance-token",
  curve: "curve-dao-token",
  maker: "maker",
  makerdao: "maker",
  pancakeswap: "pancakeswap-token",
  sushiswap: "sushi",
  balancer: "balancer",
};

export interface PriceChangeResult {
  pctChange: number;
  source: string;
}

export async function fetchPriceChangePct(protocolSlug: string, days = 7): Promise<PriceChangeResult> {
  const coinId = SLUG_TO_COINGECKO_ID[protocolSlug] || protocolSlug;
  const url = MARKET_CHART_URL.replace("{id}", coinId);
  const params = new URLSearchParams({ vs_currency: "usd", days: String(days) });
  const resp = await fetch(`${url}?${params.toString()}`);
  if (!resp.ok) throw new Error(`CoinGecko request failed: ${resp.status}`);
  const data = (await resp.json()) as { prices: [number, number][] };
  const prices = data.prices;
  const firstPrice = prices[0][1];
  const lastPrice = prices[prices.length - 1][1];
  const pctChange = ((lastPrice - firstPrice) / firstPrice) * 100;
  return { pctChange, source: `${url}?vs_currency=usd&days=${days}` };
}
