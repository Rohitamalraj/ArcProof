/**
 * Env loading + role/wallet config, ported from agent/shared/config.py.
 *
 * Deliberate change from the Python version: EVERY role can have a real
 * Circle Developer-Controlled Wallet, not just `requester`. Each role's
 * CIRCLE_WALLET_ID_<ROLE> is optional and independent -- any role left
 * unset simply falls back to its plain viem-generated private key (see
 * wallet.ts / circleWallet.ts for how callers pick between the two).
 */
import "dotenv/config";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw ? parseInt(raw, 10) : fallback;
}

export const ORCHESTRATOR_PORT = envInt("ORCHESTRATOR_PORT", 8000);
export const ONCHAIN_AGENT_PORT = envInt("ONCHAIN_AGENT_PORT", 8001);
export const NEWS_AGENT_PORT = envInt("NEWS_AGENT_PORT", 8002);
export const COMPLIANCE_AGENT_PORT = envInt("COMPLIANCE_AGENT_PORT", 8003);
export const EVALUATOR_PORT = envInt("EVALUATOR_PORT", 8004);

// --- Arc testnet (real, public, no signup -- docs.arc.io/arc/references/connect-to-arc) ---
export const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
export const ARC_CHAIN_ID = envInt("ARC_CHAIN_ID", 5042002);
export const USDC_CONTRACT_ADDRESS =
  process.env.USDC_CONTRACT_ADDRESS || "0x3600000000000000000000000000000000000000";
export const ARC_EXPLORER_URL = process.env.ARC_EXPLORER_URL || "https://testnet.arcscan.app";

export type Role =
  | "requester"
  | "orchestrator"
  | "escrow"
  | "onchain-agent-v1"
  | "news-agent-v1"
  | "compliance-agent-v1";

export const ALL_ROLES: Role[] = [
  "requester",
  "orchestrator",
  "escrow",
  "onchain-agent-v1",
  "news-agent-v1",
  "compliance-agent-v1",
];

interface WalletEntry {
  address: string;
  privateKey: string;
}

const roleEnvPrefix: Record<Role, string> = {
  requester: "REQUESTER",
  orchestrator: "ORCHESTRATOR",
  escrow: "ESCROW",
  "onchain-agent-v1": "ONCHAIN_AGENT",
  "news-agent-v1": "NEWS_AGENT",
  "compliance-agent-v1": "COMPLIANCE_AGENT",
};

// --- Real EVM wallets, one per agent role. Generated via viem, funded via faucet.circle.com ---
export const WALLETS: Record<Role, WalletEntry> = Object.fromEntries(
  ALL_ROLES.map((role) => {
    const prefix = roleEnvPrefix[role];
    return [
      role,
      {
        address: process.env[`${prefix}_ADDRESS`] || "",
        privateKey: process.env[`${prefix}_PRIVATE_KEY`] || "",
      },
    ];
  })
) as Record<Role, WalletEntry>;

export const ONCHAIN_AGENT_URL = `http://127.0.0.1:${ONCHAIN_AGENT_PORT}`;
export const NEWS_AGENT_URL = `http://127.0.0.1:${NEWS_AGENT_PORT}`;
export const COMPLIANCE_AGENT_URL = `http://127.0.0.1:${COMPLIANCE_AGENT_PORT}`;
export const EVALUATOR_URL = `http://127.0.0.1:${EVALUATOR_PORT}`;
export const ORCHESTRATOR_URL = `http://127.0.0.1:${ORCHESTRATOR_PORT}`;

export const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
// OpenRouter: OpenAI-API-compatible, so it's just ChatOpenAI pointed at a
// different baseURL (see services/src/llm.ts). Checked first, ahead of the
// Google keys -- added specifically to route around Gemini's free-tier
// daily quota (20 requests/day/key) getting exhausted mid-demo.
// Default model is a free-tier, tool-calling-capable OpenRouter model
// (verified live against GET /api/v1/models -- filtered for id ending
// ":free" AND supported_parameters including "tools") -- gpt-4o-mini
// (a metered, non-free model) 402'd immediately against a $0-funded
// free-tier key.
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "qwen/qwen3-coder:free";

// Groq: dedicated LangChain.js integration (@langchain/groq), not an
// OpenAI-compatibility shim. Checked first of all (see services/src/llm.ts)
// -- added after both Gemini's daily quota and OpenRouter's free-tier
// rate limit got exhausted mid-demo; Groq's free tier has much more
// generous per-minute/per-day limits and its hosted Llama models have
// solid native tool-calling support.
export const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
export const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// --- Circle Developer-Controlled Wallets (circleWallet.ts) ---
// Shared client credentials. Every role below is independently optional --
// unlike the Python version (which only ever wired the `requester` role),
// any subset of roles can be Circle-backed at once.
export const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || "";
export const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || "";
export const CIRCLE_WALLET_SET_ID = process.env.CIRCLE_WALLET_SET_ID || "";

interface CircleWalletEntry {
  walletId: string;
  address: string;
}

// role -> {walletId, address} if CIRCLE_WALLET_ID_<ROLE> is configured, else undefined
export const CIRCLE_WALLETS: Partial<Record<Role, CircleWalletEntry>> = Object.fromEntries(
  ALL_ROLES.map((role) => {
    const prefix = roleEnvPrefix[role];
    const walletId = process.env[`CIRCLE_WALLET_ID_${prefix}`] || "";
    const address = process.env[`CIRCLE_ADDRESS_${prefix}`] || "";
    return [role, walletId ? { walletId, address } : undefined];
  }).filter(([, v]) => v !== undefined)
) as Partial<Record<Role, CircleWalletEntry>>;

export function circleConfigured(): boolean {
  return Boolean(CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET);
}

// Optional: one Gemini API key per agent role. Google's free tier is a
// 20-requests/DAY cap *per key*, and every agent makes real LLM calls (see
// llm.ts) -- five agents sharing one key exhausts it after a couple of jobs.
// Set these to five separate keys (aistudio.google.com/apikey, one per
// Google account/project) to give each agent its own 20/day bucket. Any role
// left unset falls back to the shared GOOGLE_API_KEY above.
export const GOOGLE_API_KEYS_BY_ROLE: Record<string, string> = {
  orchestrator: process.env.GOOGLE_API_KEY_ORCHESTRATOR || GOOGLE_API_KEY,
  "onchain-agent-v1": process.env.GOOGLE_API_KEY_ONCHAIN || GOOGLE_API_KEY,
  "news-agent-v1": process.env.GOOGLE_API_KEY_NEWS || GOOGLE_API_KEY,
  "compliance-agent-v1": process.env.GOOGLE_API_KEY_COMPLIANCE || GOOGLE_API_KEY,
  evaluator: process.env.GOOGLE_API_KEY_EVALUATOR || GOOGLE_API_KEY,
};

// Flat per-call nanopayment fee (PRD S7 step 4): paid immediately via x402
// regardless of verification outcome -- it's the "you responded" fee, not
// the conditional payment. Real on-chain transfer, same as any other amount
// here -- see chain.ts.
export const NANOPAYMENT_USDC = 0.01;

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/core/src -> packages/core -> packages -> agent-ts (repo root)
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const FIXTURES_DIR = path.join(REPO_ROOT, "fixtures");
