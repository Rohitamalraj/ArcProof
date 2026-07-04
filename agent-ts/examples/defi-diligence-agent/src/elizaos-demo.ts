/**
 * Same real onchain/news/compliance specialists and real verifiers as
 * index.ts (shared.ts), composed through @arcproof/sdk-elizaos instead of
 * calling the LangChain orchestrator directly -- proves the ORIGINAL
 * DeFi diligence vertical, not just a new one, also works identically
 * through the ElizaOS adapter.
 *
 * Run from agent-ts/:
 *   npx tsx examples/defi-diligence-agent/src/elizaos-demo.ts uniswap "Assess Uniswap before treasury deployment."
 */
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";

import { escrow, ARC_TESTNET, type TrustedAgentConfig, type WalletCredential } from "@arcproof/sdk";
import { createLangChainOrchestrator } from "@arcproof/sdk-langchain";
import { createArcProofAction, type ElizaMemory } from "@arcproof/sdk-elizaos";
import { getModel, makeSpecialists, makeVerifiers } from "./shared.js";

const CLEAN_DEMO_ADDRESS = "0x0000000000000000000000000000000000dead";

async function main() {
  const protocolSlug = process.argv[2] ?? "uniswap";
  const requestText = process.argv[3] || "Assess this protocol before treasury deployment.";
  const targetAddress = process.argv[4] || CLEAN_DEMO_ADDRESS;
  const injectFault = process.argv[5];

  const model = await getModel();
  const specialists = makeSpecialists(model);
  const verifiers = makeVerifiers();

  const gatherClaims = createLangChainOrchestrator({
    model,
    specialists,
    buildPlanningMessage: (context) => `Request: ${context.requestText}\nProtocol slug: ${context.protocolSlug}`,
  });

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
