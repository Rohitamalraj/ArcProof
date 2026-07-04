/**
 * Same specialists/verifiers as index.ts (shared.ts), composed through
 * @arcproof/sdk-elizaos instead of calling the LangChain orchestrator
 * directly -- proves createArcProofAction's `gatherClaims` parameter
 * genuinely accepts a full orchestrator (createLangChainOrchestrator),
 * not just a single specialist, so the three-layer pattern
 * (orchestrator -> specialists -> evaluator) works identically no matter
 * which agent framework an integrator's product is built on.
 *
 * This calls the built ElizaAction's handler directly with a realistic
 * mock message/state/callback instead of booting a full ElizaOS
 * character -- the point is to prove the wiring (ElizaOS-shaped Action ->
 * runTrustedJob -> real payment) actually fires correctly, which doesn't
 * require a running ElizaOS runtime.
 *
 * Run from agent-ts/:
 *   npx tsx examples/lending-apr-agent/src/elizaos-demo.ts loan-001 "What is the true APR including all fees?"
 *   npx tsx examples/lending-apr-agent/src/elizaos-demo.ts loan-003 "Is this borrower eligible in their region?"
 */
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";

import { escrow, ARC_TESTNET, type TrustedAgentConfig, type WalletCredential } from "@arcproof/sdk";
import { createLangChainOrchestrator } from "@arcproof/sdk-langchain";
import { createArcProofAction, type ElizaMemory } from "@arcproof/sdk-elizaos";
import { getModel, makeSpecialists, makeVerifiers } from "./shared.js";

async function main() {
  const loanId = process.argv[2] ?? "loan-001";
  const requestText =
    process.argv[3] ||
    "What is the true APR? Discover the total cost including interest, processing fees, and documentation charges.";

  const model = await getModel();
  const specialists = makeSpecialists(model);
  const verifiers = makeVerifiers();

  // The orchestrator IS the gatherClaims the ElizaOS action will call --
  // no separate ElizaOS-specific planning logic needed.
  const gatherClaims = createLangChainOrchestrator({
    model,
    specialists,
    buildPlanningMessage: (context) => `Request: ${context.requestText}\nLoan id: ${context.loanId}`,
  });

  const requesterKey = process.env.REQUESTER_PRIVATE_KEY;
  const settlerKey = process.env.ORCHESTRATOR_PRIVATE_KEY;
  const escrowDeployerKey = process.env.ESCROW_PRIVATE_KEY;
  const aprAgentAddress = process.env.ONCHAIN_AGENT_ADDRESS;
  const eligibilityAgentAddress = process.env.NEWS_AGENT_ADDRESS;
  if (!requesterKey || !settlerKey || !escrowDeployerKey || !aprAgentAddress || !eligibilityAgentAddress) {
    throw new Error("missing wallet env vars -- run this from agent-ts/ so it picks up ./.env (see README)");
  }

  const network = ARC_TESTNET;
  const requester: WalletCredential = { kind: "plain", privateKey: requesterKey };
  const settler: WalletCredential = { kind: "plain", privateKey: settlerKey };
  const settlerAddress = privateKeyToAccount(settlerKey as `0x${string}`).address;

  console.log(`Deploying a fresh VeriFiEscrow instance for this example (settler=${settlerAddress})...`);
  const contractAddress = await escrow.deployEscrow(network, escrowDeployerKey, settlerAddress);
  const trustedAgentConfig: TrustedAgentConfig = { network, contractAddress, verifiers };

  const action = createArcProofAction({
    name: "CHECK_TRUE_APR",
    description: "Independently verifies a loan's true APR and borrower eligibility before answering, paying each specialist only if their claim checks out.",
    trustedAgentConfig,
    requester,
    settler,
    providerAddresses: {
      "lending-apr-agent-v1": aprAgentAddress,
      "lending-eligibility-agent-v1": eligibilityAgentAddress,
    },
    budgetAmount: 0.06,
    gatherClaims,
    // Extracts job context from the incoming ElizaOS message -- a real
    // character would parse this out of natural language; kept simple
    // here (loan id + the raw text) since the point is proving the
    // handler wiring, not building an NLU layer.
    buildContext: (message) => ({ loanId, requestText: message.content.text }),
  });

  // A realistic incoming ElizaOS message -- normally supplied by the
  // ElizaOS runtime itself.
  const message: ElizaMemory = {
    entityId: "user-1",
    roomId: "room-1",
    content: { text: requestText },
  };

  console.log(`\n=== ElizaOS action "${action.name}" invoked ===\n`);
  console.log(`User message: "${message.content.text}"\n`);

  const result = await action.handler(
    /* runtime */ undefined,
    message,
    /* state */ undefined,
    /* options */ undefined,
    /* callback */ async (response) => {
      console.log("=== ElizaOS would reply with ===\n");
      console.log(response.text);
      return [];
    }
  );

  console.log("\n=== ActionResult ===\n");
  console.log(`success=${result?.success}`);
  if (!result?.success) console.log(`error=${result?.error}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
