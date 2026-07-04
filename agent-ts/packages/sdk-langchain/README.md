# @arcproof/sdk-langchain

LangChain.js adapter for [`@arcproof/sdk`](../sdk): turn any LangChain.js tool-calling agent into a `gatherClaims()` function usable by `runTrustedJob()`.

## Install

```bash
npm install @arcproof/sdk @arcproof/sdk-langchain @langchain/core @langchain/langgraph
```

## Usage

This is real, working code from [`examples/lending-apr-agent`](../../examples/lending-apr-agent) (`src/shared.ts`) -- not illustrative pseudo-code with placeholder names. Every function below is verified live on Arc testnet with real transactions; the full source (fixture loading, tool definitions, `getModel()`'s provider fallback) is in that example.

```ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLangChainClaimGatherer } from "@arcproof/sdk-langchain";

// A tool the specialist can call -- looks up a loan's real terms and
// computes the true all-in APR (marketed rate + fees, amortized).
const lookupLoanTerms = tool(
  async ({ loanId }: { loanId: string }) => JSON.stringify(await lookUpLoanTermsFromYourPlatform(loanId)),
  { name: "lookup_loan_terms", description: "Looks up a loan's all-in APR and fee terms.", schema: z.object({ loanId: z.string() }) }
);

// The specialist: a real LangChain.js tool-calling agent that drafts claims.
const aprGatherer = createLangChainClaimGatherer({
  agentId: "lending-apr-agent-v1",
  model, // e.g. new ChatGroq({ model: "llama-3.3-70b-versatile", apiKey: process.env.GROQ_API_KEY })
  tools: [lookupLoanTerms],
  claimTypes: ["apr_rate", "processing_fee", "documentation_charge"],
  systemPrompt:
    "You are a lending-cost specialist. Given a loan id, call lookup_loan_terms to find the TRUE all-in APR " +
    "(not just the marketed rate) plus the processing fee and documentation charge, and draft one claim per " +
    "data point. Copy every value verbatim from the tool's response -- never estimate.",
  buildUserMessage: (context) => `Loan id: ${context.loanId}. Request: ${context.requestText}`,
});

const result = await runTrustedJob(
  { network: ARC_TESTNET, contractAddress, verifiers /* @arcproof/sdk's VerifierRegistry, .register() per claim_type */ },
  {
    jobId: "job-1",
    budgetAmount: 0.06,
    requester, settler, // WalletCredential
    providerAddresses: { "lending-apr-agent-v1": "0x..." },
    gatherClaims: aprGatherer,
    context: { loanId: "loan-001", requestText: "What is the true APR?" },
  }
);
```

Multiple specialists, always engaged: `combineClaimGatherers([aprGatherer, eligibilityGatherer])`.

Multiple specialists, an LLM decides which ones this specific request needs (the orchestrator layer -- matches the reference apps' `orchestrator.ts`/`langchainPlanner.ts` pattern, generalized). This is the actual second specialist and orchestrator wiring from the same example:

```ts
import { createLangChainOrchestrator, type SpecialistDescriptor } from "@arcproof/sdk-langchain";

// A second, real specialist -- checks borrower region eligibility (its own
// tool + claim type, e.g. "borrower_eligibility_flag"), built the same way
// as aprGatherer above. Full implementation: shared.ts's makeEligibilityGatherer().
const eligibilityGatherer = createLangChainClaimGatherer({
  agentId: "lending-eligibility-agent-v1",
  model,
  tools: [checkEligibility],
  claimTypes: ["borrower_eligibility_flag"],
  systemPrompt: "You are a lending-eligibility specialist. Call check_borrower_eligibility and draft exactly one claim.",
  buildUserMessage: (context) => `Loan id: ${context.loanId}. Request: ${context.requestText}`,
});

const specialists: SpecialistDescriptor[] = [
  { id: "lending-apr-agent-v1", description: "Checks a loan's true all-in APR and fees -- engage for any cost/APR/fee question.", gatherClaims: aprGatherer },
  { id: "lending-eligibility-agent-v1", description: "Checks borrower region eligibility -- engage for any eligibility/compliance/region question.", gatherClaims: eligibilityGatherer },
];

const gatherClaims = createLangChainOrchestrator({ model, specialists });
// Verified live: "what's the true APR" engages only lending-apr-agent-v1.
// "Is this borrower eligible, and what's the true APR?" engages both.
```

This is the full three-layer pattern, each with a clean separation of concerns:

```text
orchestrator (createLangChainOrchestrator)  -- decides which specialists this request needs
specialist   (createLangChainClaimGatherer) -- checks and drafts claims
evaluator    (@arcproof/sdk's VerifierRegistry) -- independently verifies, zero LLM calls
```

If the planning call itself fails outright (not "returned zero valid ids," which defaults to engaging every specialist -- an actual throw), it propagates up to `runTrustedJob`'s existing refund path rather than silently falling back -- same "agent or loud failure" rule as everywhere else in this SDK.

## Why `claim_value`/`simulated` are plain strings in the structured-output schema

Two real, independently-observed provider incompatibilities, not a stylistic choice:

- Gemini's function-calling schema translator rejects JSON Schema `anyOf` unions nested inside array-of-object properties, at any branch count -- including the 2-branch `[string, null]` shape `.nullable()` produces.
- Groq has been observed returning the JSON string `"false"` for a `z.boolean()` field (`"expected boolean, but got string"`).

A plain string field with an explicit `"true"`/`"false"` convention, coerced back to a real boolean in JS, sidesteps both without depending on either provider fixing their schema translation. If you add new structured-output fields to a similar schema, keep this in mind.

## Resilience

If the underlying LLM call fails (quota, outage, malformed generation), `createLangChainClaimGatherer` logs and returns zero claims rather than throwing. `runTrustedJob`'s built-in `hasCheckableClaims` guard already handles "this provider contributed nothing" correctly (refund, not a false accept) -- a single flaky provider never has to crash the whole job.

## License

MIT
