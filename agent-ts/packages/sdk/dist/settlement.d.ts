/**
 * Verdict + per-provider payout math, then real on-chain settlement.
 * Ported from agent-ts's core/src/settlement.ts, generalized: that
 * version bakes in one DeFi-specific rule ("a compliance_flag mismatch is
 * a floor on the verdict") which doesn't make sense as a library default
 * -- a lending-APR agent has no compliance_flag claim type at all. Verdict
 * math here is purely a function of match/mismatch counts; if your domain
 * needs a floor rule like that, apply it to the result of
 * computeJobVerdict() yourself (see README for the pattern).
 *
 * Deliberately still 100% deterministic, zero LLM calls -- this is what
 * keeps a verdict auditable and reproducible by anyone re-running the
 * same independent checks, same principle as agent-ts's evaluator.ts.
 */
import type { Claim, ProviderPayout, Verdict, SettlementResult } from "./schema.js";
import type { NetworkConfig } from "./chain.js";
import type { WalletCredential } from "./escrow.js";
/**
 * True if at least one claim can actually be judged match/mismatch. A job
 * with zero checkable claims must NOT be routed through settle() --
 * computeJobVerdict treats "no mismatches" as "accept" regardless of
 * *why* there were none, which would finalize the escrow with the
 * requester's full budget silently withheld forever if you called
 * settle() anyway. Refund instead when this returns false.
 */
export declare function hasCheckableClaims(claims: Claim[]): boolean;
export declare function computeJobVerdict(claims: Claim[], partialMismatchThreshold?: number): Verdict;
export declare function computeProviderPayout(providerAgentId: string, providerClaims: Claim[], allocatedAmount: number, partialMismatchThreshold?: number): ProviderPayout;
/**
 * Computes the verdict/payout math AND executes it as real on-chain
 * transactions: release() per provider that earned something, then
 * finalize() to close the job (any withheld remainder simply stays
 * locked in the contract, enforced by the contract itself).
 */
export declare function settle(network: NetworkConfig, contractAddress: string, jobId: string, settler: WalletCredential, budgetAmount: number, claims: Claim[], providerAddresses: Record<string, string>): Promise<SettlementResult>;
