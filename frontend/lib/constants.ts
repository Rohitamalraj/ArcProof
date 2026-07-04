export const AGENT_NAMES: Record<string, string> = {
  "onchain-agent-v1": "On-Chain Specialist",
  "news-agent-v1": "News Specialist",
  "compliance-agent-v1": "Compliance Specialist",
  "evaluator-v1": "Evaluator",
};

export const CLAIM_TYPE_COLORS: Record<string, string> = {
  tvl: "bg-blue-900/40 text-blue-300",
  price_change: "bg-purple-900/40 text-purple-300",
  news_incident: "bg-orange-900/40 text-orange-300",
  compliance_flag: "bg-red-900/40 text-red-300",
  governance_event: "bg-teal-900/40 text-teal-300",
  wallet_flow: "bg-indigo-900/40 text-indigo-300",
  token_concentration: "bg-cyan-900/40 text-cyan-300",
};

// agent-ts's template is a free-form LLM-inferred label, not a fixed enum --
// this just prettifies the couple of common labels people actually type;
// templateDisplayName() in lib/format.ts falls back to the raw string for
// anything not listed here.
export const TEMPLATE_LABELS: Record<string, string> = {
  protocol_treasury_diligence: "Protocol Treasury Diligence",
  yield_opportunity_review: "Yield Opportunity Review",
};

export const HISTORY_KEY = "arcproof_history";
export const BACKEND_TIMEOUT_MS = 300000; // matches agent-ts cli/runDemo.ts's own 300s job timeout -- every specialist + the evaluator is a real LLM tool-calling agent, comfortably slower than the old rule-based version
