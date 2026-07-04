/**
 * STANDALONE ElizaOS proof: the full orchestrator -> onchain/news/
 * compliance specialists -> evaluator pipeline using ONLY @arcproof/sdk +
 * @arcproof/sdk-elizaos (+ @arcproof/core for data). Zero @arcproof/sdk-
 * langchain, zero @langchain/* -- verified by the imports below and in
 * shared-native.ts. This is the proof that ElizaOS is a genuine drop-in
 * ALTERNATIVE to LangChain, not an add-on that requires it.
 *
 * The specialists are the same three as the LangChain path
 * (onchain-agent-v1 / news-agent-v1 / compliance-agent-v1), built with
 * @arcproof/sdk-elizaos's native createElizaClaimGatherer /
 * createElizaOrchestrator (see shared-native.ts), and driven through a
 * real createArcProofAction handler. Verification/settlement is the same
 * framework-agnostic @arcproof/sdk core as every other path.
 *
 * Run from agent-ts/:
 *   npx tsx examples/defi-diligence-agent/src/elizaos-native.ts uniswap "Assess Uniswap before treasury deployment."
 *   npx tsx examples/defi-diligence-agent/src/elizaos-native.ts uniswap "Assess Uniswap's on-chain health." "" onchain
 */
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";

import { escrow, ARC_TESTNET, type TrustedAgentConfig, type WalletCredential } from "@arcproof/sdk";
import { createArcProofAction, type ElizaMemory } from "@arcproof/sdk-elizaos";
import { makeNativeOrchestrator, makeVerifiers } from "./shared-native.js";
import { makeElizaTestRuntime } from "./elizaTestRuntime.js";

const CLEAN_DEMO_ADDRESS = "0x0000000000000000000000000000000000dead";

async function main() {
  const protocolSlug = process.argv[2] ?? "uniswap";
  const requestText = process.argv[3] || "Assess this protocol before treasury deployment.";
  const targetAddress = process.argv[4] || CLEAN_DEMO_ADDRESS;
  const injectFault = process.argv[5];

  const gatherClaims = makeNativeOrchestrator();
  const verifiers = makeVerifiers();

  const requesterKey = process.env.REQUESTER_PRIVATE_KEY;
  const settlerKey = process.env.ORCHESTRATOR_PRIVATE_KEY;
  const escrowDeployerKey = process.env.ESCROW_PRIVATE_KEY;
  const onchainAddress = process.env.ONCHAIN_AGENT_ADDRESS;
  const newsAddress = process.env.NEWS_AGENT_ADDRESS;
  const complianceAddress = process.env.COMPLIANCE_AGENT_ADDRESS;
  if (!requesterKey || !settlerKey || !escrowDeployerKey || !onchainAddress || !newsAddress || !complianceAddress) {
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
    name: "DEFI_TREASURY_DILIGENCE",
    description: "Independently verifies on-chain, news/governance, and compliance claims about a DeFi protocol before treasury deployment, paying each specialist only if its claims check out.",
    trustedAgentConfig,
    requester,
    settler,
    providerAddresses: {
      "onchain-agent-v1": onchainAddress,
      "news-agent-v1": newsAddress,
      "compliance-agent-v1": complianceAddress,
    },
    budgetAmount: 0.3,
    gatherClaims,
    buildContext: (message) => ({ protocolSlug, requestText: message.content.text, targetAddress, injectFault }),
  });

  // In a real deployment this runtime is the ElizaOS character's own; here
  // it's a thin test harness implementing runtime.useModel (see
  // elizaTestRuntime.ts). No LangChain involved.
  const runtime = makeElizaTestRuntime();

  const message: ElizaMemory = { entityId: "user-1", roomId: "room-1", content: { text: requestText } };

  console.log(`\n=== ElizaOS action "${action.name}" invoked (STANDALONE -- sdk + sdk-elizaos only) ===\n`);
  console.log(`User message: "${message.content.text}"${injectFault ? ` [FAULT INJECTED: ${injectFault}]` : ""}\n`);

  const result = await action.handler(
    runtime,
    message,
    /* state */ undefined,
    /* options */ undefined,
    async (response) => {
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
