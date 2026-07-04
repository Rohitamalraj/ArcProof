/**
 * LangChain.js tool wrappers around @arcproof/core's data source connectors
 * -- used by the 3 specialists to gather claims. Ported from
 * agent/agents/tools.py.
 *
 * Note: unlike the Python version, these are no longer also handed to the
 * evaluator -- this project's evaluator (core's evaluator.ts) calls the
 * data sources directly as deterministic code, not through an LLM tool
 * loop, since its decision must be rule-based (see evaluator.ts's
 * docstring).
 *
 * Every tool returns plain text (LLM tool results are always text) that
 * either states the real value/source/simulated flag, or an "ERROR: ..."
 * line the agent is instructed to treat as "skip this data point" --
 * matching the try/catch-per-claim resilience the old deterministic
 * specialists had, now enforced via the system prompt instead of direct
 * control flow.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { dataSources } from "@arcproof/core";

export const fetchTvl = tool(
  async ({ protocol_slug }: { protocol_slug: string }) => {
    try {
      const { tvlUsd, source } = await dataSources.defillama.fetchTvl(protocol_slug);
      return `tvl_usd=${tvlUsd} source=${source} simulated=false`;
    } catch (e) {
      return `ERROR: could not fetch TVL for '${protocol_slug}': ${e}`;
    }
  },
  {
    name: "fetch_tvl",
    description:
      "Fetch a protocol's current live Total Value Locked in USD from DefiLlama. Use the exact protocol_slug given for the job (e.g. 'aave', 'uniswap').",
    schema: z.object({ protocol_slug: z.string() }),
  }
);

export const fetchPriceChange = tool(
  async ({ protocol_slug, days }: { protocol_slug: string; days?: number }) => {
    try {
      const { pctChange, source } = await dataSources.price.fetchPriceChangePct(protocol_slug, days ?? 7);
      return `price_change_pct=${pctChange.toFixed(2)} source=${source} simulated=false`;
    } catch (e) {
      return `ERROR: could not fetch price history for '${protocol_slug}': ${e}`;
    }
  },
  {
    name: "fetch_price_change",
    description: "Fetch a protocol token's real percent price change over the last N days (default 7) from CoinGecko.",
    schema: z.object({ protocol_slug: z.string(), days: z.number().optional() }),
  }
);

export const checkWalletFlow = tool(
  async ({ protocol_slug, exchange_hint }: { protocol_slug: string; exchange_hint?: string }) => {
    const address = dataSources.explorer.PROTOCOL_TREASURY_ADDRESS[protocol_slug];
    if (!address) return `ERROR: no known treasury address for protocol '${protocol_slug}' -- skip the wallet_flow claim.`;
    try {
      const { touchedExchange, source, simulated } = await dataSources.explorer.checkWalletFlow(address, exchange_hint ?? "binance");
      return `treasury_address=${address} touched_exchange=${touchedExchange} source=${source} simulated=${simulated}`;
    } catch (e) {
      return `ERROR: could not check wallet flow for '${address}': ${e}`;
    }
  },
  {
    name: "check_wallet_flow",
    description:
      "Check whether a protocol's known treasury wallet sent funds to a labeled exchange wallet recently. Looks up the treasury address for protocol_slug internally -- never guess an address yourself.",
    schema: z.object({ protocol_slug: z.string(), exchange_hint: z.string().optional() }),
  }
);

export const tokenConcentration = tool(
  async ({ protocol_slug }: { protocol_slug: string }) => {
    const { top10HolderPct, source, simulated } = await dataSources.explorer.tokenConcentrationTop10Pct(protocol_slug);
    return `top10_holder_pct=${top10HolderPct} source=${source} simulated=${simulated}`;
  },
  {
    name: "token_concentration",
    description: "Fetch the percent of token supply held by the top 10 holders for a protocol.",
    schema: z.object({ protocol_slug: z.string() }),
  }
);

export const fetchGovernance = tool(
  async ({ protocol_slug }: { protocol_slug: string }) => {
    try {
      const { proposals, source } = await dataSources.governance.fetchRecentClosedProposals(protocol_slug, 1);
      if (!proposals.length) return `No closed governance proposals found for '${protocol_slug}' in Snapshot -- skip the governance_event claim.`;
      const p = proposals[0];
      return `title=${JSON.stringify(p.title)} end_date=${p.endDate} winning_choice=${p.winningChoice} source=${source}`;
    } catch (e) {
      return `ERROR: ${e} -- skip the governance_event claim.`;
    }
  },
  {
    name: "fetch_governance",
    description: "Fetch the most recently closed governance proposal (title, end date, winning choice) for a protocol from Snapshot.",
    schema: z.object({ protocol_slug: z.string() }),
  }
);

export const checkNewsIncident = tool(
  async ({ protocol_slug, keyword }: { protocol_slug: string; keyword?: string }) => {
    try {
      const { corroborated, sources, simulated } = await dataSources.news.checkNewsIncident(protocol_slug, keyword ?? "exploit");
      return `corroborated=${corroborated} sources=${JSON.stringify(sources)} simulated=${simulated}`;
    } catch (e) {
      return `ERROR: GDELT news check failed for '${protocol_slug}': ${e} -- skip the news_incident claim.`;
    }
  },
  {
    name: "check_news_incident",
    description: "Check GDELT for a corroborated (2+ distinct reporting domains) recent security incident/exploit news for a protocol.",
    schema: z.object({ protocol_slug: z.string(), keyword: z.string().optional() }),
  }
);

export const checkSanctions = tool(
  async ({ address }: { address: string }) => {
    const { flagged, source } = await dataSources.sanctions.checkSanctions(address);
    return `address=${address} flagged=${flagged} source=${source}`;
  },
  {
    name: "check_sanctions",
    description: "Check whether a wallet address is on the real OFAC SDN sanctions list snapshot.",
    schema: z.object({ address: z.string() }),
  }
);

export const ONCHAIN_TOOLS = [fetchTvl, fetchPriceChange, checkWalletFlow, tokenConcentration];
export const NEWS_TOOLS = [fetchGovernance, checkNewsIncident];
export const COMPLIANCE_TOOLS = [checkSanctions];
