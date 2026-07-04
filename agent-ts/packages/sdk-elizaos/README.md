# @arcproof/sdk-elizaos

ElizaOS plugin adapter for [`@arcproof/sdk`](../sdk): expose a bonded, independently-verified, real-payment flow as a real ElizaOS `Action`/`Plugin`.

## Install

```bash
npm install @arcproof/sdk @arcproof/sdk-elizaos @elizaos/core
```

## Usage

This is real, working code from [`examples/lending-apr-agent`](../../examples/lending-apr-agent) (`src/elizaos-demo.ts` + `src/shared.ts`) -- not illustrative pseudo-code. Verified live: a real ElizaOS `Action` handler invocation, real contract lock, real orchestrator plan (both specialists engaged for a combined APR+eligibility question), real independent verification, real payout, correct `ActionResult`.

```ts
import { createArcProofAction, createArcProofPlugin } from "@arcproof/sdk-elizaos";
import { createLangChainOrchestrator } from "@arcproof/sdk-langchain";
import { VerifierRegistry, ARC_TESTNET } from "@arcproof/sdk";
import { getModel, makeSpecialists, makeVerifiers } from "./shared.js"; // same file the LangChain-only entrypoint uses

const model = await getModel();
const specialists = makeSpecialists(model); // lending-apr-agent-v1 + lending-eligibility-agent-v1
const verifiers = makeVerifiers(); // one VerifierRegistry entry per claim_type, deterministic

// The orchestrator IS the gatherClaims the ElizaOS action calls -- no
// separate ElizaOS-specific planning logic needed. Could just as easily be
// a single createLangChainClaimGatherer() instead of a full orchestrator;
// ElizaOS never has to know the difference, it just sees the reply either way.
const gatherClaims = createLangChainOrchestrator({
  model,
  specialists,
  buildPlanningMessage: (context) => `Request: ${context.requestText}\nLoan id: ${context.loanId}`,
});

const action = createArcProofAction({
  name: "CHECK_TRUE_APR",
  description: "Independently verifies a loan's true APR and borrower eligibility before answering, paying each specialist only if their claim checks out.",
  trustedAgentConfig: { network: ARC_TESTNET, contractAddress, verifiers },
  requester, // WalletCredential
  settler, // WalletCredential
  providerAddresses: { "lending-apr-agent-v1": "0x...", "lending-eligibility-agent-v1": "0x..." },
  budgetAmount: 0.06,
  gatherClaims,
  buildContext: (message) => ({ loanId: "loan-001", requestText: message.content.text }),
});

const plugin = createArcProofPlugin({
  name: "arcproof-trust-layer",
  description: "Bonded, independently-verified agent actions with real on-chain payment.",
  actions: [action],
});

// register `plugin` with your ElizaOS character/project as you would any other plugin
```

## Why this doesn't import types from `@elizaos/core`

`@elizaos/core`'s top-level barrel (`dist/index.d.ts`) re-exports both `./types` (which defines `Action`/`Plugin` as types) and `./actions` (a same-named runtime export) via `export *`. TypeScript silently drops an ambiguous re-exported name rather than erroring, so `import type { Action } from "@elizaos/core"` fails at typecheck time even though the type genuinely exists in the package (confirmed against `@elizaos/core@1.7.2`'s actual `.d.ts` files).

This package defines structurally-identical local types (`ElizaAction`, `ElizaPlugin`, etc.) instead of depending on that fragile export path. TypeScript's structural typing makes the objects this package builds assignable to the real `Action`/`Plugin` types wherever your actual ElizaOS runtime code expects them -- `@elizaos/core` is still a declared peer dependency because you need the real package installed to run an agent at all.

## License

MIT
