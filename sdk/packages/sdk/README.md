# @arcproof/sdk

The trust layer for AI agents: **make a claim, independently verify it against live data, release real on-chain payment only if it checks out.** Bring your own agent -- any framework, any vertical. This package is the verify+pay primitive; it is not a fixed set of agents.

Extracted from [ArcProof](https://github.com/Rohitamalraj/ArcProof)'s reference implementation (a DeFi protocol-diligence network) once that system was proven working end to end on Arc testnet with real Circle Wallets, a real deployed escrow contract, and real x402-shaped payments. Everything DeFi-specific was left behind; what's left is domain-agnostic.

## Why this exists

Payment rails (x402) and agent identity/reputation (ERC-8004-style registries) tell you money moved. They don't tell you the *work* was correct. This package is the missing verification step: a specialist agent drafts a claim, a deterministic verifier you write independently re-derives the same fact from a canonical source, and payment is a real, on-chain-enforced conditional release based on whether they agree.

```
lock budget --> gather claims (any agent) --> verify (your rules) --> release / refund
   (real tx)      (bring your own)          (deterministic,           (real tx, enforced
                                              zero LLM judgment)        by a smart contract)
```

## Install

```bash
npm install @arcproof/sdk
```

## Quickstart

```ts
import { VerifierRegistry, runTrustedJob, escrow, ARC_TESTNET, type WalletCredential } from "@arcproof/sdk";

// 1. Register how to independently check each claim_type your agents produce.
//    Deterministic, zero LLM calls -- this is what keeps a verdict auditable.
const verifiers = new VerifierRegistry();
verifiers.register("apr_rate", async (claim, context) => {
  const trueRate = await lookUpTrueApr(context.loanId); // however you get a canonical value
  const claimed = Number(claim.claim_value);
  const delta = ((claimed - trueRate) / trueRate) * 100;
  return {
    status: Math.abs(delta) <= 2 ? "match" : "mismatch",
    value: trueRate,
    source: "your-canonical-source",
    delta,
    note: `independent true rate: ${trueRate}`,
  };
});

// 2. Deploy (once) a real escrow contract -- or reuse one you already deployed.
const settlerAddress = "0x...";
const contractAddress = await escrow.deployEscrow(ARC_TESTNET, deployerPrivateKey, settlerAddress);

// 3. Run a job: lock -> gather -> verify -> settle/refund. gatherClaims can be
//    anything -- a LangChain.js agent (@arcproof/sdk-langchain), an ElizaOS
//    action (@arcproof/sdk-elizaos), or a plain async function.
const requester: WalletCredential = { kind: "plain", privateKey: requesterPrivateKey };
const settler: WalletCredential = { kind: "plain", privateKey: settlerPrivateKey };

const result = await runTrustedJob(
  { network: ARC_TESTNET, contractAddress, verifiers },
  {
    jobId: "job-123",
    budgetAmount: 0.05,
    requester,
    settler,
    providerAddresses: { "my-agent-v1": "0x..." },
    gatherClaims: async (context) => myAgent.run(context),
    context: { loanId: "loan-001" },
  }
);

console.log(result.overall_verdict, result.total_paid_usdc);
```

## What's real, not simulated

- **Payments**: real signed transactions on whatever EVM chain you point `NetworkConfig` at (defaults ship for Arc testnet, where USDC is the native gas-equivalent currency -- see `ARC_TESTNET`).
- **Escrow**: a real deployed smart contract (`escrow.deployEscrow`) enforces lock/release/finalize/refund on-chain -- withheld funds simply never leave the contract, not an application-level promise.
- **Circle Developer-Controlled Wallets**: pass a `{ kind: "circle", walletId, circleConfig }` credential anywhere a `WalletCredential` is expected instead of a plain private key -- every payment then signs through Circle's own transaction API. See "Circle Wallets setup" below.
- **Verification**: whatever your `Verifier` functions do. The SDK doesn't call an LLM anywhere in the verification path -- that's the entire point.

## Circle Wallets setup (optional, real)

```ts
import { circleWallet } from "@arcproof/sdk";

const config = { apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! };
// One-time per Circle account (semi-irreversible):
//   1. generate + register an entity secret (see Circle's docs / the
//      generateEntitySecret / registerEntitySecretCiphertext functions in
//      @circle-fin/developer-controlled-wallets)
//   2. create a wallet set + wallet:
const walletSetId = await circleWallet.createWalletSet(config, "my-app");
const wallet = await circleWallet.createWallet(config, walletSetId, "ARC-TESTNET");
// fund `wallet.address`, then use it as a WalletCredential:
const requester: WalletCredential = { kind: "circle", walletId: wallet.walletId, circleConfig: config };
```

## API surface

- **`ClaimSchema` / `Claim`** -- a claim is `{ claim_id, job_id, provider_agent_id, claim_type: string, claim_text, claim_value, provider_source, simulated, verification_* }`. `claim_type` is a plain string you define, not a fixed enum.
- **`VerifierRegistry`** -- `.register(claimType, verifier)`, `.verifyClaims(claims, context)`. A claim with no registered verifier becomes `"unverifiable"` (never counts toward mismatches or payment) rather than passing or failing.
- **`computeJobVerdict` / `computeProviderPayout` / `settle`** -- the payout math: full payout if 0 mismatches, 50% if exactly 1, withheld if 2+; job verdict accept/partial/reject by the same rule at the job level. Pure functions you can call standalone, or `settle()` which also executes the real `release()`/`finalize()` contract calls.
- **`hasCheckableClaims(claims)`** -- guards against the "every provider failed, job silently accepts with money stuck in escrow forever" trap. `runTrustedJob` already checks this for you.
- **`runTrustedJob(config, params)`** -- the one high-level helper: lock, gather, verify, settle-or-refund.
- **`chain`** -- raw `transfer`/`verifyTransfer`/`getBalance` against any EVM chain.
- **`escrow`** -- `deployEscrow`/`lock`/`release`/`finalize`/`refund`/`getJob`, every function taking a `WalletCredential` directly (no fixed role system).
- **`circleWallet`** -- thin wrapper over `@circle-fin/developer-controlled-wallets`.

## Adapters

- [`@arcproof/sdk-langchain`](../sdk-langchain) -- wraps a LangChain.js tool-calling agent as a `gatherClaims()` function, **and** a `createLangChainOrchestrator()` that dynamically decides which of several registered specialists a specific request needs (the full orchestrator → specialists → evaluator pattern, not just one wrapped agent).
- [`@arcproof/sdk-elizaos`](../sdk-elizaos) -- exposes the same flow as a real ElizaOS `Action`/`Plugin`; its `gatherClaims` can be a single gatherer or a full LangChain orchestrator.

See [`examples/lending-apr-agent`](../../examples/lending-apr-agent) for a complete, non-DeFi worked example (a lending platform's "true APR" + eligibility diligence network, two specialists behind an orchestrator) proving none of this is tied to the reference app's vertical.

## License

MIT
