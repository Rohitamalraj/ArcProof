/**
 * The SAME onchain/news/compliance specialists and verifiers as
 * shared.ts, but built with @arcproof/sdk-elizaos's NATIVE builders
 * (createElizaClaimGatherer / createElizaOrchestrator) instead of
 * @arcproof/sdk-langchain's. This file imports ONLY @arcproof/sdk,
 * @arcproof/sdk-elizaos, and @arcproof/core (for the data sources) --
 * deliberately NO @arcproof/sdk-langchain and NO @langchain/* anywhere.
 * It's the proof that `sdk` + `sdk-elizaos` alone gives the full
 * orchestrator -> specialists -> evaluator pipeline.
 *
 * The verifiers are identical to shared.ts (re-exported from it) -- the
 * evaluator lives in @arcproof/sdk core and is framework-agnostic, so
 * there's nothing ElizaOS-specific about it.
 */
import { dataSources } from "@arcproof/core";
import { createElizaClaimGatherer, createElizaOrchestrator, type ElizaTool, type ElizaSpecialistDescriptor } from "@arcproof/sdk-elizaos";

export { makeVerifiers } from "./shared.js";

// ============================== Tools (plain async fns, no LangChain) ==============================

const fetchTvl: ElizaTool = {
  name: "fetch_tvl",
  description: "Fetch a protocol's current live TVL in USD from DefiLlama.",
  run: async (ctx) => {
    try {
      const { tvlUsd, source } = await dataSources.defillama.fetchTvl(ctx.protocolSlug as string);
      return `tvl_usd=${tvlUsd} source=${source} simulated=false`;
    } catch (e) {
      return `ERROR: could not fetch TVL for '${ctx.protocolSlug}': ${e}`;
    }
  },
};

const fetchPriceChange: ElizaTool = {
  name: "fetch_price_change",
  description: "Fetch a protocol token's 7-day percent price change from CoinGecko.",
  run: async (ctx) => {
    try {
      const { pctChange, source } = await dataSources.price.fetchPriceChangePct(ctx.protocolSlug as string, 7);
      return `price_change_pct=${pctChange.toFixed(2)} source=${source} simulated=false`;
    } catch (e) {
      return `ERROR: could not fetch price history for '${ctx.protocolSlug}': ${e}`;
    }
  },
};

const checkWalletFlow: ElizaTool = {
  name: "check_wallet_flow",
  description: "Check whether a protocol's treasury wallet sent funds to a labeled exchange recently.",
  run: async (ctx) => {
    const address = dataSources.explorer.PROTOCOL_TREASURY_ADDRESS[ctx.protocolSlug as string];
    if (!address) return `ERROR: no known treasury address for protocol '${ctx.protocolSlug}' -- skip the wallet_flow claim.`;
    try {
      const { touchedExchange, source, simulated } = await dataSources.explorer.checkWalletFlow(address, "binance");
      return `treasury_address=${address} touched_exchange=${touchedExchange} source=${source} simulated=${simulated}`;
    } catch (e) {
      return `ERROR: could not check wallet flow for '${address}': ${e}`;
    }
  },
};

const tokenConcentration: ElizaTool = {
  name: "token_concentration",
  description: "Fetch the percent of token supply held by the top 10 holders.",
  run: async (ctx) => {
    const { top10HolderPct, source, simulated } = await dataSources.explorer.tokenConcentrationTop10Pct(ctx.protocolSlug as string);
    return `top10_holder_pct=${top10HolderPct} source=${source} simulated=${simulated}`;
  },
};

const fetchGovernance: ElizaTool = {
  name: "fetch_governance",
  description: "Fetch the most recently closed governance proposal from Snapshot.",
  run: async (ctx) => {
    try {
      const { proposals, source } = await dataSources.governance.fetchRecentClosedProposals(ctx.protocolSlug as string, 1);
      if (!proposals.length) return `No closed governance proposals found for '${ctx.protocolSlug}' -- skip the governance_event claim.`;
      const p = proposals[0];
      return `title=${JSON.stringify(p.title)} end_date=${p.endDate} winning_choice=${p.winningChoice} source=${source}`;
    } catch (e) {
      return `ERROR: ${e} -- skip the governance_event claim.`;
    }
  },
};

const checkNewsIncident: ElizaTool = {
  name: "check_news_incident",
  description: "Check GDELT for corroborated (2+ domains) recent security-incident news.",
  run: async (ctx) => {
    try {
      const { corroborated, sources, simulated } = await dataSources.news.checkNewsIncident(ctx.protocolSlug as string, "exploit");
      return `corroborated=${corroborated} sources=${JSON.stringify(sources)} simulated=${simulated}`;
    } catch (e) {
      return `ERROR: GDELT news check failed for '${ctx.protocolSlug}': ${e} -- skip the news_incident claim.`;
    }
  },
};

const checkSanctions: ElizaTool = {
  name: "check_sanctions",
  description: "Check whether the job's target address is on the OFAC SDN sanctions list.",
  run: async (ctx) => {
    const address = (ctx.targetAddress as string) || "0x0000000000000000000000000000000000dead";
    const { flagged, source } = await dataSources.sanctions.checkSanctions(address);
    return `address=${address} flagged=${flagged} source=${source}`;
  },
};

// ============================== Native specialists ==============================

export function makeNativeSpecialists(): ElizaSpecialistDescriptor[] {
  const onchain = createElizaClaimGatherer({
    agentId: "onchain-agent-v1",
    tools: [fetchTvl, fetchPriceChange, checkWalletFlow, tokenConcentration],
    claimTypes: ["tvl", "price_change", "wallet_flow", "token_concentration"],
    systemPrompt:
      "You are the on-chain data specialist in a bonded financial diligence network. Draft one claim per on-chain " +
      "metric your tools returned (TVL, 7-day price change, treasury wallet flow, top-10 holder concentration). " +
      "Never invent or estimate a number: copy every claim_value and provider_source verbatim from a tool result.",
  });

  const news = createElizaClaimGatherer({
    agentId: "news-agent-v1",
    tools: [fetchGovernance, checkNewsIncident],
    claimTypes: ["governance_event", "news_incident"],
    systemPrompt:
      "You are the news/fundamentals specialist. Draft a governance_event claim from the most recent closed proposal " +
      "and a news_incident claim if corroborated news exists. Copy values verbatim; omit any claim whose tool line " +
      "says to skip it.",
  });

  const compliance = createElizaClaimGatherer({
    agentId: "compliance-agent-v1",
    tools: [checkSanctions],
    claimTypes: ["compliance_flag"],
    systemPrompt:
      "You are the compliance specialist. Draft exactly one compliance_flag claim from the sanctions tool result. " +
      "claim_value must be the literal 'true' or 'false' from the tool's flagged field -- never invent it.",
  });

  return [
    { id: "onchain-agent-v1", description: "On-chain data: TVL, 7-day price change, treasury wallet flow to exchanges, token holder concentration.", gatherClaims: onchain },
    { id: "news-agent-v1", description: "News/fundamentals: most recent governance proposal outcome, reported security incidents.", gatherClaims: news },
    { id: "compliance-agent-v1", description: "Compliance/filings: OFAC sanctions screening for a specific wallet address.", gatherClaims: compliance },
  ];
}

export function makeNativeOrchestrator() {
  return createElizaOrchestrator({
    specialists: makeNativeSpecialists(),
    buildPlanningMessage: (ctx) => `Request: ${ctx.requestText}\nProtocol slug: ${ctx.protocolSlug}`,
  });
}
