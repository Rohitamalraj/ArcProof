/**
 * Real news/incident corroboration via GDELT's DOC 2.0 API. Ported from
 * agent/data_sources/news.py.
 *
 * GDELT (gdeltproject.org) indexes global news continuously and its DOC API
 * is free and keyless. "Corroborated by two sources" (PRD S9.3) is measured
 * literally here: at least two distinct reporting domains covering the same
 * query within the lookback window.
 */

const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

export interface NewsIncidentResult {
  corroborated: boolean;
  sources: string[];
  simulated: false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkNewsIncident(
  protocolSlug: string,
  keyword: string,
  timespan = "14d"
): Promise<NewsIncidentResult> {
  const query = `"${protocolSlug}" "${keyword}"`;
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    maxrecords: "20",
    timespan,
    format: "json",
  });

  let resp = await fetch(`${GDELT_URL}?${params.toString()}`);
  if (resp.status === 429) {
    // GDELT rate-limits bursts; one retry covers demo-scale traffic
    await sleep(2000);
    resp = await fetch(`${GDELT_URL}?${params.toString()}`);
  }
  if (!resp.ok) throw new Error(`GDELT request failed: ${resp.status}`);
  const data = (await resp.json()) as { articles?: { domain?: string; url?: string }[] };

  const articles = data.articles || [];
  const domains = new Map<string, string>();
  for (const a of articles) {
    if (a.domain && !domains.has(a.domain) && a.url) {
      domains.set(a.domain, a.url);
    }
  }

  const corroborated = domains.size >= 2;
  const sources = Array.from(domains.values()).slice(0, 3);
  return {
    corroborated,
    sources: sources.length ? sources : [`${GDELT_URL}?query=${encodeURIComponent(query)}`],
    simulated: false,
  };
}
