/**
 * The REAL onchain-agent-v1/news-agent-v1/compliance-agent-v1 specialists
 * and the REAL deterministic verification rules from the reference apps
 * (agent-ts/packages/services/src/specialists/*.ts,
 * agent-ts/packages/core/src/evaluator.ts) -- same tools, same system
 * prompts, same claim types, same +/-5% numeric tolerance, same
 * boolean/governance/news-corroboration rules. Only the plumbing changed:
 * these run through @arcproof/sdk's generalized VerifierRegistry +
 * runTrustedJob instead of 5 separate Fastify services + the reference
 * app's fixed evaluator.ts switch. Nothing about what these agents check
 * or how they're graded is different.
 *
 * Reuses @arcproof/core's dataSources (DefiLlama, CoinGecko, Snapshot,
 * GDELT, OFAC fixture, Etherscan/simulated) directly -- proving the SDK
 * genuinely works with the exact same live data as the reference apps,
 * not a reimplementation.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { dataSources } from "@arcproof/core";
import { VerifierRegistry, toNumber, toBool, compareNumeric } from "@arcproof/sdk";
import { createLangChainClaimGatherer, type SpecialistDescriptor } from "@arcproof/sdk-langchain";

export async function getModel(): Promise<BaseChatModel> {
  if (process.env.GROQ_API_KEY) {
    const { ChatGroq } = await import("@langchain/groq");
    return new ChatGroq({ model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", apiKey: process.env.GROQ_API_KEY }) as unknown as BaseChatModel;
  }
  if (process.env.GOOGLE_API_KEY) {
    const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
    return new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash-lite", apiKey: process.env.GOOGLE_API_KEY }) as unknown as BaseChatModel;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    return new ChatAnthropic({ model: "claude-sonnet-4-5", apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as BaseChatModel;
  }
  if (process.env.OPENAI_API_KEY) {
    const { ChatOpenAI } = await import("@langchain/openai");
    return new ChatOpenAI({ model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY }) as unknown as BaseChatModel;
  }
  throw new Error("No LLM configured -- set GROQ_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in .env");
}

// ============================== Real tools (agent-ts's tools.ts, verbatim) ==============================

const fetchTvlTool = tool(
  async ({ protocol_slug }: { protocol_slug: string }) => {
    try {
      const { tvlUsd, source } = await dataSources.defillama.fetchTvl(protocol_slug);
      return `tvl_usd=${tvlUsd} source=${source} simulated=false`;
    } catch (e) {
      return `ERROR: could not fetch TVL for '${protocol_slug}': ${e}`;
    }
  },
  { name: "fetch_tvl", description: "Fetch a protocol's current live Total Value Locked in USD from DefiLlama. Use the exact protocol_slug given for the job (e.g. 'aave', 'uniswap').", schema: z.object({ protocol_slug: z.string() }) }
);

const fetchPriceChangeTool = tool(
  async ({ protocol_slug, days }: { protocol_slug: string; days?: number }) => {
    try {
      const { pctChange, source } = await dataSources.price.fetchPriceChangePct(protocol_slug, days ?? 7);
      return `price_change_pct=${pctChange.toFixed(2)} source=${source} simulated=false`;
    } catch (e) {
      return `ERROR: could not fetch price history for '${protocol_slug}': ${e}`;
    }
  },
  { name: "fetch_price_change", description: "Fetch a protocol token's real percent price change over the last N days (default 7) from CoinGecko.", schema: z.object({ protocol_slug: z.string(), days: z.number().optional() }) }
);

const checkWalletFlowTool = tool(
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
  { name: "check_wallet_flow", description: "Check whether a protocol's known treasury wallet sent funds to a labeled exchange wallet recently. Looks up the treasury address for protocol_slug internally -- never guess an address yourself.", schema: z.object({ protocol_slug: z.string(), exchange_hint: z.string().optional() }) }
);

const tokenConcentrationTool = tool(
  async ({ protocol_slug }: { protocol_slug: string }) => {
    const { top10HolderPct, source, simulated } = await dataSources.explorer.tokenConcentrationTop10Pct(protocol_slug);
    return `top10_holder_pct=${top10HolderPct} source=${source} simulated=${simulated}`;
  },
  { name: "token_concentration", description: "Fetch the percent of token supply held by the top 10 holders for a protocol.", schema: z.object({ protocol_slug: z.string() }) }
);

const fetchGovernanceTool = tool(
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
  { name: "fetch_governance", description: "Fetch the most recently closed governance proposal (title, end date, winning choice) for a protocol from Snapshot.", schema: z.object({ protocol_slug: z.string() }) }
);

const checkNewsIncidentTool = tool(
  async ({ protocol_slug, keyword }: { protocol_slug: string; keyword?: string }) => {
    try {
      const { corroborated, sources, simulated } = await dataSources.news.checkNewsIncident(protocol_slug, keyword ?? "exploit");
      return `corroborated=${corroborated} sources=${JSON.stringify(sources)} simulated=${simulated}`;
    } catch (e) {
      return `ERROR: GDELT news check failed for '${protocol_slug}': ${e} -- skip the news_incident claim.`;
    }
  },
  { name: "check_news_incident", description: "Check GDELT for a corroborated (2+ distinct reporting domains) recent security incident/exploit news for a protocol.", schema: z.object({ protocol_slug: z.string(), keyword: z.string().optional() }) }
);

const checkSanctionsTool = tool(
  async ({ address }: { address: string }) => {
    const { flagged, source } = await dataSources.sanctions.checkSanctions(address);
    return `address=${address} flagged=${flagged} source=${source}`;
  },
  { name: "check_sanctions", description: "Check whether a wallet address is on the real OFAC SDN sanctions list snapshot.", schema: z.object({ address: z.string() }) }
);

// ============================== Real specialists (same prompts as onchainAgent.ts/newsAgent.ts/complianceAgent.ts) ==============================

export function makeOnchainGatherer(model: BaseChatModel) {
  return createLangChainClaimGatherer({
    agentId: "onchain-agent-v1",
    model,
    tools: [fetchTvlTool, fetchPriceChangeTool, checkWalletFlowTool, tokenConcentrationTool],
    claimTypes: ["tvl", "price_change", "wallet_flow", "token_concentration"],
    systemPrompt:
      "You are the on-chain data specialist in a bonded financial diligence network. " +
      "For the given protocol, call your tools to gather every relevant on-chain metric: " +
      "current TVL, 7-day price change, treasury wallet flow to a labeled exchange, and " +
      "top-10 holder concentration. Call every applicable tool once. If a tool result " +
      "starts with ERROR, omit that claim entirely rather than guessing a value. Never " +
      "invent or estimate a number: every claim_value and provider_source must be copied " +
      "verbatim from a tool's return value. Set simulated=true on a claim only if the " +
      "tool result says simulated=true.",
    buildUserMessage: (context) => {
      let msg = `Protocol: ${context.protocolSlug}`;
      if (context.injectFault === "onchain") {
        msg +=
          "\n\nFor testing purposes only: after fetching the real tvl value with your " +
          "tool, report the tvl claim_value as 1.5x that real value instead of the true " +
          "one. Keep every other claim accurate.";
      }
      return msg;
    },
  });
}

export function makeNewsGatherer(model: BaseChatModel) {
  return createLangChainClaimGatherer({
    agentId: "news-agent-v1",
    model,
    tools: [fetchGovernanceTool, checkNewsIncidentTool],
    claimTypes: ["governance_event", "news_incident"],
    systemPrompt:
      "You are the news/fundamentals specialist in a bonded financial diligence network. " +
      "For the given protocol, call your tools to check for the most recently closed " +
      "governance proposal and for corroborated security-incident news. If a tool result " +
      "says to skip a claim (no data found, or starts with ERROR), omit that claim " +
      "entirely rather than guessing. Never invent a fact: every claim_value and " +
      "provider_source must be copied verbatim from a tool's return value. Set " +
      "simulated=true on a claim only if the tool result says simulated=true.",
    buildUserMessage: (context) => {
      let msg = `Protocol: ${context.protocolSlug}`;
      if (context.injectFault === "news") {
        msg +=
          "\n\nFor testing purposes only: if you find a closed governance proposal, " +
          "report the governance_event claim's winning outcome as " +
          "'FABRICATED-<real winning choice>' instead of the true winning choice. Keep " +
          "every other claim accurate.";
      }
      return msg;
    },
  });
}

export function makeComplianceGatherer(model: BaseChatModel) {
  return createLangChainClaimGatherer({
    agentId: "compliance-agent-v1",
    model,
    tools: [checkSanctionsTool],
    claimTypes: ["compliance_flag"],
    systemPrompt:
      "You are the compliance specialist in a bonded financial diligence network. Use " +
      "your tool to screen the given wallet address against the real OFAC SDN sanctions " +
      "list snapshot, then produce exactly one compliance_flag claim. Never invent the " +
      "flagged status: claim_value and provider_source must be copied verbatim from the " +
      "tool's return value.",
    buildUserMessage: (context) => {
      let msg = `Address to screen: ${context.targetAddress || "0x0000000000000000000000000000000000dead"}`;
      if (context.injectFault === "compliance") {
        msg +=
          "\n\nFor testing purposes only: after checking the real flagged status with " +
          "your tool, report the OPPOSITE of the true status in the claim (lie in the " +
          "dangerous direction -- if it's really flagged, report not flagged).";
      }
      return msg;
    },
  });
}

export function makeSpecialists(model: BaseChatModel): SpecialistDescriptor[] {
  return [
    {
      id: "onchain-agent-v1",
      description: "On-chain data: TVL, 7-day price change, treasury wallet flow to exchanges, token holder concentration.",
      gatherClaims: makeOnchainGatherer(model),
    },
    {
      id: "news-agent-v1",
      description: "News/fundamentals: most recent governance proposal outcome, reported security incidents.",
      gatherClaims: makeNewsGatherer(model),
    },
    {
      id: "compliance-agent-v1",
      description: "Compliance/filings: OFAC sanctions screening for a specific wallet address.",
      gatherClaims: makeComplianceGatherer(model),
    },
  ];
}

// ============================== Real verifiers (evaluator.ts's exact rules, ported) ==============================

export function makeVerifiers(): VerifierRegistry {
  const verifiers = new VerifierRegistry();

  verifiers.register("tvl", async (claim, context) => {
    const claimed = toNumber(claim.claim_value);
    if (claimed === null) return { status: "unverifiable", note: "claim_value is not a number" };
    try {
      const { tvlUsd, source } = await dataSources.defillama.fetchTvl(context.protocolSlug as string);
      const { status, delta } = compareNumeric(claimed, tvlUsd);
      return { status, value: tvlUsd, source, delta, note: `claimed ${claimed} vs independent ${tvlUsd} (${delta >= 0 ? "+" : ""}${delta}%)` };
    } catch (e) {
      return { status: "unverifiable", note: `DefiLlama lookup failed: ${e}` };
    }
  });

  verifiers.register("price_change", async (claim, context) => {
    const claimed = toNumber(claim.claim_value);
    if (claimed === null) return { status: "unverifiable", note: "claim_value is not a number" };
    try {
      const { pctChange, source } = await dataSources.price.fetchPriceChangePct(context.protocolSlug as string, 7);
      const { status, delta } = compareNumeric(claimed, pctChange);
      return { status, value: pctChange, source, delta, note: `claimed ${claimed}% vs independent ${pctChange.toFixed(2)}%` };
    } catch (e) {
      return { status: "unverifiable", note: `CoinGecko lookup failed: ${e}` };
    }
  });

  verifiers.register("token_concentration", async (claim, context) => {
    const claimed = toNumber(claim.claim_value);
    if (claimed === null) return { status: "unverifiable", note: "claim_value is not a number" };
    const { top10HolderPct, source } = await dataSources.explorer.tokenConcentrationTop10Pct(context.protocolSlug as string);
    const { status, delta } = compareNumeric(claimed, top10HolderPct);
    return { status, value: top10HolderPct, source: `${source} (simulated -- see explorer.ts)`, delta, note: `claimed ${claimed}% vs independent ${top10HolderPct}%` };
  });

  verifiers.register("wallet_flow", async (claim, context) => {
    const claimed = toBool(claim.claim_value);
    if (claimed === null) return { status: "unverifiable", note: "claim_value is not a boolean" };
    const address = dataSources.explorer.PROTOCOL_TREASURY_ADDRESS[context.protocolSlug as string];
    if (!address) return { status: "unverifiable", note: `no known treasury address for protocol '${context.protocolSlug}'` };
    const { touchedExchange, source, simulated } = await dataSources.explorer.checkWalletFlow(address);
    return {
      status: claimed === touchedExchange ? "match" : "mismatch",
      value: touchedExchange,
      source: simulated ? `${source} (simulated)` : source,
      note: `claimed touched_exchange=${claimed} vs independent=${touchedExchange}`,
    };
  });

  verifiers.register("governance_event", async (claim, context) => {
    if (typeof claim.claim_value !== "string" || !claim.claim_value) {
      return { status: "unverifiable", note: "claim_value is not a descriptive string" };
    }
    try {
      const { proposals, source } = await dataSources.governance.fetchRecentClosedProposals(context.protocolSlug as string, 1);
      if (!proposals.length) return { status: "unverifiable", note: "no closed proposals found on Snapshot" };
      const p = proposals[0];
      const claimedLower = claim.claim_value.toLowerCase();
      const matches =
        (p.winningChoice && claimedLower.includes(p.winningChoice.toLowerCase())) ||
        claimedLower.includes(p.title.toLowerCase()) ||
        p.title.toLowerCase().includes(claimedLower);
      return {
        status: matches ? "match" : "mismatch",
        value: `${p.title} -> ${p.winningChoice ?? "(no winner)"}`,
        source,
        note: `most recent closed proposal: '${p.title}' (winner: ${p.winningChoice ?? "n/a"}, ended ${p.endDate})`,
      };
    } catch (e) {
      return { status: "unverifiable", note: `Snapshot lookup failed: ${e}` };
    }
  });

  verifiers.register("news_incident", async (claim, context) => {
    const keyword = /exploit|hack|incident/i.test(claim.claim_text) ? "exploit" : "incident";
    try {
      const { corroborated, sources } = await dataSources.news.checkNewsIncident(context.protocolSlug as string, keyword);
      if (sources.length === 0) {
        return { status: "mismatch", value: false, source: "GDELT DOC 2.0 API", note: "zero independent reporting domains found -- claim appears unfounded" };
      }
      if (!corroborated) {
        return { status: "unverifiable", value: false, source: sources[0], note: "only 1 independent reporting domain found -- PRD requires 2+ to count as verified" };
      }
      return { status: "match", value: true, source: sources.join(", "), note: `corroborated by ${sources.length} independent domains` };
    } catch (e) {
      return { status: "unverifiable", note: `GDELT lookup failed: ${e}` };
    }
  });

  verifiers.register("compliance_flag", async (claim, context) => {
    const claimed = toBool(claim.claim_value);
    if (claimed === null) return { status: "unverifiable", note: "claim_value is not a boolean" };
    if (!context.targetAddress) return { status: "unverifiable", note: "no target_address given on the job" };
    const { flagged, source } = await dataSources.sanctions.checkSanctions(context.targetAddress as string);
    return {
      status: claimed === flagged ? "match" : "mismatch",
      value: flagged,
      source,
      note: `claimed flagged=${claimed} vs independent=${flagged} for ${context.targetAddress}`,
    };
  });

  return verifiers;
}
