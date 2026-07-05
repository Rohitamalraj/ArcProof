// Mirrors agent-ts/packages/core/src/schema.ts -- keep these two in sync by hand
// (no shared package boundary between the Next.js app and the Node backend).

export interface JobResponse {
  job_id: string;
  requester_id: string;
  template: string;
  request_text: string;
  protocol_slug: string;
  budget_usdc: number;
  status: "pending" | "in_progress" | "accepted" | "partial_accepted" | "rejected" | "failed";
  created_at: string;
  subtasks: string[];
  final_memo: string;
  overall_verdict: "accept" | "partial" | "reject";
  total_paid_usdc: number;
  claims: Claim[];
  payouts: Payout[];
  // Real on-chain tx hashes for the job-level escrow calls.
  lock_tx_hash?: string | null;
  finalize_tx_hash?: string | null;
  refund_tx_hash?: string | null;
}

export interface Claim {
  claim_id: string;
  job_id: string;
  provider_agent_id: string;
  claim_type:
    | "tvl"
    | "price_change"
    | "wallet_flow"
    | "token_concentration"
    | "governance_event"
    | "news_incident"
    | "compliance_flag";
  claim_text: string;
  claim_value: number | boolean | string | null;
  provider_source: string;
  simulated: boolean;
  // A completed job's claims are always resolved to one of these three by
  // the evaluator -- "pending" (the schema's wire default) never reaches
  // the frontend since normalizeClaim() in lib/api.ts falls back to
  // "unverifiable" for anything else.
  verification_status: "match" | "mismatch" | "unverifiable";
  verification_source: string;
  verification_value: number | boolean | string | null;
  verification_delta: number | null;
  verification_note: string;
}

export interface Payout {
  provider_agent_id: string;
  claims_checked: number;
  matches: number;
  mismatches: number;
  unverifiable: number;
  allocated_usdc: number;
  paid_usdc: number;
  fraction_paid: number;
  outcome: "full" | "partial" | "withheld";
  // Real on-chain tx hashes for this specialist's two payments.
  nanopayment_tx_hash?: string | null;
  settlement_tx_hash?: string | null;
}

export interface ReputationRecord {
  provider_agent_id: string;
  total_jobs: number;
  accepted_claims: number;
  mismatched_claims: number;
  unverifiable_claims: number;
  accuracy_score: number;
  last_updated: string;
}

export interface ReputationResponse {
  [agent_id: string]: ReputationRecord;
}

export interface JobRequest {
  request_text: string;
  // Free-form label/hint -- omit it and the orchestrator's LLM invents a
  // fitting one from request_text (agent-ts's JobRequestSchema.template).
  template?: string;
  budget_usdc: number;
  protocol_slug: string;
  // Wallet checked by the compliance agent; the orchestrator defaults this
  // to a clean demo address if omitted.
  target_address?: string;
  // Demo-only: force a specialist to fabricate a claim, so the evaluator
  // catching it can actually be demonstrated live.
  inject_fault?: "onchain" | "news" | "compliance";
  // Set together, by a connected browser wallet that already called
  // VeriFiEscrow.lock() itself -- see lib/wallet.ts's lockBudget().
  requester_wallet?: string;
  job_id?: string;
  payment_tx_hash?: string;
}

export interface BackendConfig {
  arc_chain_id: number;
  arc_rpc_url: string;
  arc_explorer_url: string;
  escrow_contract_address: string;
  nanopayment_usdc: number;
}

export interface JobLogEntry {
  ts: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
  txHash?: string;
  explorerUrl?: string;
  // Who-talked-to-whom metadata (agent-ts's jobLog.ts) -- drives the 3D
  // agent-network scene's traveling packets. Actor ids: "requester",
  // "orchestrator", "onchain-agent-v1", "news-agent-v1",
  // "compliance-agent-v1", "evaluator-v1", "escrow".
  from?: string;
  to?: string;
  kind?: "call" | "payment" | "response" | "verdict" | "settlement" | "system";
}

export interface JobHistoryItem {
  job_id: string;
  protocol_slug: string;
  overall_verdict: "accept" | "partial" | "reject";
  total_paid_usdc: number;
  created_at: string;
}
