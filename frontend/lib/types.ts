export interface JobResponse {
  job_id: string;
  requester_id: string;
  template: string;
  request_text: string;
  protocol_slug: string;
  budget_usdc: number;
  status: "accepted" | "partial_accepted" | "rejected";
  created_at: string;
  subtasks: string[];
  final_memo: string;
  overall_verdict: "accept" | "partial" | "reject";
  total_paid_usdc: number;
  claims: Claim[];
  payouts: Payout[];
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
  template: string;
  budget_usdc: number;
  protocol_slug: string;
  requester_wallet?: string;
  payment_tx_hash?: string;
}

export interface BackendConfig {
  arc_chain_id: number;
  arc_rpc_url: string;
  arc_explorer_url: string;
  escrow_address: string;
  nanopayment_usdc: number;
}

export interface JobHistoryItem {
  job_id: string;
  protocol_slug: string;
  overall_verdict: "accept" | "partial" | "reject";
  total_paid_usdc: number;
  created_at: string;
}
