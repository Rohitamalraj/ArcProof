/**
 * Proves @arcproof/sdk works for the ORIGINAL DeFi treasury-diligence
 * vertical, not just the new lending-apr-agent example: the exact same
 * onchain-agent-v1/news-agent-v1/compliance-agent-v1 specialists (same
 * tools, same system prompts, same claim types) and the exact same
 * deterministic verification rules (same +/-5% numeric tolerance, same
 * boolean/governance/news-corroboration logic) as the reference apps
 * (agent-ts/packages/services, agent-ts/packages/core/evaluator.ts) --
 * ported onto the generalized SDK's VerifierRegistry + runTrustedJob
 * instead of 5 Fastify services + a fixed evaluator.ts switch.
 *
 * This entrypoint runs the LangChain.js orchestrator directly. See
 * elizaos-demo.ts for the same specialists/verifiers (shared.ts) composed
 * through @arcproof/sdk-elizaos's Action/Plugin instead.
 *
 * Run from agent-ts/:
 *   npx tsx examples/defi-diligence-agent/src/index.ts uniswap "Assess Uniswap before treasury deployment."
 *   npx tsx examples/defi-diligence-agent/src/index.ts aave "Assess Aave before treasury deployment. Screen the counterparty address against sanctions lists." 0x8589427373d6d84e98730d7795d8f6f8731fda0 compliance
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

import { runTrustedJob, escrow, ARC_TESTNET, type TrustedAgentConfig, type WalletCredential } from "@arcproof/sdk";
import { createLangChainOrchestrator } from "@arcproof/sdk-langchain";
import { getModel, makeSpecialists, makeVerifiers } from "./shared.js";

const CLEAN_DEMO_ADDRESS = "0x0000000000000000000000000000000000dead";

async function main() {
  const protocolSlug = process.argv[2] ?? "uniswap";
  const requestText = process.argv[3] || "Assess this protocol before treasury deployment.";
  const targetAddress = process.argv[4] || CLEAN_DEMO_ADDRESS;
  const injectFault = process.argv[5]; // "onchain" | "news" | "compliance" | undefined

  const model = await getModel();
  const specialists = makeSpecialists(model);
  const verifiers = makeVerifiers();

  const gatherClaims = createLangChainOrchestrator({
    model,
    specialists,
    systemPromptPrefix:
      "You are the orchestrator for a bonded financial diligence network. Given a diligence request, decide " +
      "which specialist agents to engage. Each specialist costs the requester's budget, so only pick ones " +
      "actually relevant to the request:\n\n",
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
  const jobId = `defi-job-${randomUUID().slice(0, 8)}`;

  console.log(`\n=== JOB ${jobId} -- '${requestText}' (${protocolSlug})${injectFault ? ` [FAULT INJECTED: ${injectFault}]` : ""} ===\n`);

  const result = await runTrustedJob(trustedAgentConfig, {
    jobId,
    budgetAmount: 0.3,
    requester,
    settler,
    providerAddresses: {
      "onchain-agent-v1": onchainAddress,
      "news-agent-v1": newsAddress,
      "compliance-agent-v1": complianceAddress,
    },
    gatherClaims,
    context: { protocolSlug, requestText, targetAddress, injectFault },
  });

  console.log("\n=== RESULT ===\n");
  console.log(`Verdict: ${result.overall_verdict.toUpperCase()} | total paid: ${result.total_paid_usdc.toFixed(4)}`);
  for (const c of result.claims) {
    console.log(
      `  [${c.provider_agent_id}/${c.claim_type}] claim_value=${JSON.stringify(c.claim_value)} independent_value=${JSON.stringify(c.verification_value)} -> ${c.verification_status}${c.verification_delta != null ? ` (delta ${c.verification_delta}%)` : ""} :: "${c.claim_text}"`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
