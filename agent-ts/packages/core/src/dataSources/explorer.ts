/**
 * On-chain wallet flow / holder concentration. Ported from
 * agent/data_sources/explorer.py.
 *
 * wallet_flow uses the real Etherscan free-tier API when ETHERSCAN_API_KEY
 * is set. token_concentration needs Etherscan's paid "token holder list"
 * endpoint, which is out of reach for a zero-budget hackathon build, so
 * it's always a deterministic simulation here -- clearly flagged
 * `simulated: true` end to end (claim, verification record, and terminal
 * output) rather than silently faked. Swap `simulateConcentration` for a
 * real holder-list call once a paid key or a subgraph is wired in.
 */
import { createHash } from "node:crypto";
import { ETHERSCAN_API_KEY } from "../config.js";

// Etherscan retired the unversioned v1 API (api.etherscan.io/api) --
// requests to it now return HTTP 200 with {status:"0", message:"NOTOK",
// result:"...deprecated V1 endpoint..."} instead of real data, so a plain
// `!resp.ok` check doesn't catch it. v2 requires an explicit chainid
// (1 = Ethereum mainnet, where these protocols' real treasury wallets
// actually live -- unrelated to Arc, which is only where payment settles).
const ETHERSCAN_V2_URL = "https://api.etherscan.io/v2/api";
const ETHERSCAN_CHAIN_ID = "1";

// Publicly known exchange hot wallets, used only to demonstrate a real
// wallet_flow "did this address touch a labeled exchange wallet" check.
const KNOWN_EXCHANGE_WALLETS: Record<string, string> = {
  binance: "0x28c6c06298d514db089934071355e5743bf21d60",
  coinbase: "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
};

// Canonical treasury address per protocol. Both the on-chain specialist and
// the evaluator import this same mapping -- the evaluator looks the address
// up independently by protocol_slug rather than trusting the specialist's
// claim_text, since claim_text is attacker/specialist-controlled.
export const PROTOCOL_TREASURY_ADDRESS: Record<string, string> = {
  uniswap: "0x1a9c8182c09f50c8318d769245bea52c32be35bc",
  aave: "0x464c71f6c2f760dda6093dcb91c24c39e5d6e18",
};

function seed(text: string): bigint {
  const hex = createHash("sha256").update(text).digest("hex");
  return BigInt(`0x${hex}`);
}

export interface WalletFlowResult {
  touchedExchange: boolean;
  source: string;
  simulated: boolean;
}

export async function checkWalletFlow(address: string, exchangeHint = "binance"): Promise<WalletFlowResult> {
  if (ETHERSCAN_API_KEY) {
    const params = new URLSearchParams({
      chainid: ETHERSCAN_CHAIN_ID,
      module: "account",
      action: "txlist",
      address,
      sort: "desc",
      apikey: ETHERSCAN_API_KEY,
    });
    const resp = await fetch(`${ETHERSCAN_V2_URL}?${params.toString()}`);
    if (!resp.ok) throw new Error(`Etherscan request failed: ${resp.status}`);
    const data = (await resp.json()) as { status: string; message: string; result?: { from?: string; to?: string }[] | string };
    // Etherscan returns HTTP 200 even on API-level failures (bad key, rate
    // limit, deprecated endpoint) -- status "1" is the only real success
    // signal, `result` is an error string (not an array) otherwise.
    if (data.status !== "1" || !Array.isArray(data.result)) {
      throw new Error(`Etherscan API error: ${data.message} -- ${JSON.stringify(data.result)}`);
    }
    const txs = data.result;
    const target = KNOWN_EXCHANGE_WALLETS[exchangeHint] || "";
    const touchedExchange = txs.some(
      (tx) => target && ((tx.from || "").toLowerCase() === target || (tx.to || "").toLowerCase() === target)
    );
    return { touchedExchange, source: `${ETHERSCAN_V2_URL}?chainid=${ETHERSCAN_CHAIN_ID}&address=${address}`, simulated: false };
  }

  // SIMULATED fallback: deterministic so repeated demo runs are stable.
  const touchedExchange = seed(address.toLowerCase()) % 3n !== 0n;
  return { touchedExchange, source: "simulated:etherscan", simulated: true };
}

export interface TokenConcentrationResult {
  top10HolderPct: number;
  source: string;
  simulated: boolean;
}

export async function tokenConcentrationTop10Pct(protocolSlug: string): Promise<TokenConcentrationResult> {
  const pct = 20.0 + Number(seed(protocolSlug) % 4000n) / 100.0; // deterministic pseudo-value in [20, 60)
  return { top10HolderPct: Math.round(pct * 100) / 100, source: "simulated:holder-distribution", simulated: true };
}
