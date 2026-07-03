import os
from dotenv import load_dotenv

load_dotenv()

ORCHESTRATOR_PORT = int(os.getenv("ORCHESTRATOR_PORT", 8000))
ONCHAIN_AGENT_PORT = int(os.getenv("ONCHAIN_AGENT_PORT", 8001))
NEWS_AGENT_PORT = int(os.getenv("NEWS_AGENT_PORT", 8002))
COMPLIANCE_AGENT_PORT = int(os.getenv("COMPLIANCE_AGENT_PORT", 8003))
EVALUATOR_PORT = int(os.getenv("EVALUATOR_PORT", 8004))

# --- Arc testnet (real, public, no signup -- docs.arc.io/arc/references/connect-to-arc) ---
ARC_RPC_URL = os.getenv("ARC_RPC_URL", "https://rpc.testnet.arc.network")
ARC_CHAIN_ID = int(os.getenv("ARC_CHAIN_ID", 5042002))
USDC_CONTRACT_ADDRESS = os.getenv("USDC_CONTRACT_ADDRESS", "0x3600000000000000000000000000000000000000")
ARC_EXPLORER_URL = os.getenv("ARC_EXPLORER_URL", "https://testnet.arcscan.app")

# --- Real EVM wallets, one per agent role. Generated via eth_account, funded via faucet.circle.com ---
WALLETS = {
    "requester": {"address": os.getenv("REQUESTER_ADDRESS", ""), "private_key": os.getenv("REQUESTER_PRIVATE_KEY", "")},
    "orchestrator": {"address": os.getenv("ORCHESTRATOR_ADDRESS", ""), "private_key": os.getenv("ORCHESTRATOR_PRIVATE_KEY", "")},
    "escrow": {"address": os.getenv("ESCROW_ADDRESS", ""), "private_key": os.getenv("ESCROW_PRIVATE_KEY", "")},
    "onchain-agent-v1": {"address": os.getenv("ONCHAIN_AGENT_ADDRESS", ""), "private_key": os.getenv("ONCHAIN_AGENT_PRIVATE_KEY", "")},
    "news-agent-v1": {"address": os.getenv("NEWS_AGENT_ADDRESS", ""), "private_key": os.getenv("NEWS_AGENT_PRIVATE_KEY", "")},
    "compliance-agent-v1": {"address": os.getenv("COMPLIANCE_AGENT_ADDRESS", ""), "private_key": os.getenv("COMPLIANCE_AGENT_PRIVATE_KEY", "")},
    "facilitator": {"address": os.getenv("FACILITATOR_ADDRESS", ""), "private_key": os.getenv("FACILITATOR_PRIVATE_KEY", "")},
}

# Backward-compatible alias: old code referenced WALLET_IDS[role] -> wallet_id string.
# Real wallets are addresses now, so this maps role -> address.
WALLET_IDS = {role: w["address"] for role, w in WALLETS.items()}

ONCHAIN_AGENT_URL = f"http://127.0.0.1:{ONCHAIN_AGENT_PORT}"
NEWS_AGENT_URL = f"http://127.0.0.1:{NEWS_AGENT_PORT}"
COMPLIANCE_AGENT_URL = f"http://127.0.0.1:{COMPLIANCE_AGENT_PORT}"
EVALUATOR_URL = f"http://127.0.0.1:{EVALUATOR_PORT}"
ORCHESTRATOR_URL = f"http://127.0.0.1:{ORCHESTRATOR_PORT}"

ETHERSCAN_API_KEY = os.getenv("ETHERSCAN_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")

# --- Circle Developer-Controlled Wallets (payments/circle_wallet.py) ---
CIRCLE_API_KEY = os.getenv("CIRCLE_API_KEY", "")
CIRCLE_ENTITY_SECRET = os.getenv("CIRCLE_ENTITY_SECRET", "")
CIRCLE_WALLET_SET_ID = os.getenv("CIRCLE_WALLET_SET_ID", "")
# Real Circle-managed wallet standing in for the `requester` role's
# eth_account key specifically -- see payments/escrow_contract.py's lock().
CIRCLE_REQUESTER_WALLET_ID = os.getenv("CIRCLE_REQUESTER_WALLET_ID", "")
CIRCLE_REQUESTER_ADDRESS = os.getenv("CIRCLE_REQUESTER_ADDRESS", "")

# Optional: one Gemini API key per agent role. Google's free tier is a
# 20-requests/DAY cap *per key*, and every agent now makes real LLM calls
# (see agents/llm.py) -- five agents sharing one key exhausts it after a
# couple of jobs. Set these to five separate keys (aistudio.google.com/apikey,
# one per Google account/project) to give each agent its own 20/day bucket.
# Any role left unset falls back to the shared GOOGLE_API_KEY above.
GOOGLE_API_KEY_ORCHESTRATOR = os.getenv("GOOGLE_API_KEY_ORCHESTRATOR", "") or GOOGLE_API_KEY
GOOGLE_API_KEY_ONCHAIN = os.getenv("GOOGLE_API_KEY_ONCHAIN", "") or GOOGLE_API_KEY
GOOGLE_API_KEY_NEWS = os.getenv("GOOGLE_API_KEY_NEWS", "") or GOOGLE_API_KEY
GOOGLE_API_KEY_COMPLIANCE = os.getenv("GOOGLE_API_KEY_COMPLIANCE", "") or GOOGLE_API_KEY
GOOGLE_API_KEY_EVALUATOR = os.getenv("GOOGLE_API_KEY_EVALUATOR", "") or GOOGLE_API_KEY

GOOGLE_API_KEYS_BY_ROLE = {
    "orchestrator": GOOGLE_API_KEY_ORCHESTRATOR,
    "onchain-agent-v1": GOOGLE_API_KEY_ONCHAIN,
    "news-agent-v1": GOOGLE_API_KEY_NEWS,
    "compliance-agent-v1": GOOGLE_API_KEY_COMPLIANCE,
    "evaluator": GOOGLE_API_KEY_EVALUATOR,
}

# Flat per-call nanopayment fee (PRD S7 step 4): paid immediately via x402
# regardless of verification outcome -- it's the "you responded" fee, not
# the conditional payment. Real on-chain transfer, same as any other amount
# in this file -- see payments/chain.py.
NANOPAYMENT_USDC = 0.01

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
FIXTURES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")
