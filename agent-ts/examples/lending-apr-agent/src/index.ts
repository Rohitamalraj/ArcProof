/**
 * Worked example proving @arcproof/sdk isn't a DeFi-specific product, AND
 * that the full orchestrator -> specialists -> evaluator pattern (not
 * just a single wrapped agent) generalizes to a new vertical: a lending
 * platform's diligence network with TWO specialists --
 * `lending-apr-agent-v1` (true APR / fees) and
 * `lending-eligibility-agent-v1` (borrower region eligibility) -- and an
 * orchestrator (createLangChainOrchestrator from @arcproof/sdk-langchain)
 * that decides, per request, which of them actually apply. Ask a pure
 * APR question and only the APR agent gets engaged; ask about eligibility
 * too and both do -- exactly the dynamic-specialist-selection behavior
 * the reference apps' orchestrator.ts/langchainPlanner.ts have, pulled
 * out as a reusable SDK capability instead of reimplemented per project.
 *
 * This entrypoint runs the LangChain.js orchestrator directly. See
 * elizaos-demo.ts for the exact same specialists/verifiers (shared.ts)
 * composed through @arcproof/sdk-elizaos's Action/Plugin instead --
 * proving the trust-layer logic doesn't change depending on which agent
 * framework sits on top of it.
 *
 * Run from agent-ts/:
 *   npx tsx examples/lending-apr-agent/src/index.ts loan-001
 *   npx tsx examples/lending-apr-agent/src/index.ts loan-003 "Is this borrower eligible in their region, and what's the true APR?"
 *   npx tsx examples/lending-apr-agent/src/index.ts loan-002 "" --inject-fault
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

import { runTrustedJob, escrow, ARC_TESTNET, type TrustedAgentConfig, type WalletCredential } from "@arcproof/sdk";
import { createLangChainOrchestrator } from "@arcproof/sdk-langchain";
import { getModel, makeSpecialists, makeVerifiers } from "./shared.js";

const REPO_ROOT_ENV_HINT = "agent-ts/.env";

async function main() {
  const loanId = process.argv[2] ?? "loan-001";
  const requestText =
    process.argv[3] ||
    "What is the true APR? Discover the total cost including interest, processing fees, and documentation charges.";
  const injectFault = process.argv.includes("--inject-fault") ? "apr" : undefined;

  const model = await getModel();
  const specialists = makeSpecialists(model);
  const verifiers = makeVerifiers();

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
    throw new Error(`missing wallet env vars -- run this from agent-ts/ so it picks up ${REPO_ROOT_ENV_HINT} (see README)`);
  }

  const network = ARC_TESTNET;
  const requester: WalletCredential = { kind: "plain", privateKey: requesterKey };
  const settler: WalletCredential = { kind: "plain", privateKey: settlerKey };
  const settlerAddress = privateKeyToAccount(settlerKey as `0x${string}`).address;

  console.log(`Deploying a fresh VeriFiEscrow instance for this example (settler=${settlerAddress})...`);
  const contractAddress = await escrow.deployEscrow(network, escrowDeployerKey, settlerAddress);

  const trustedAgentConfig: TrustedAgentConfig = { network, contractAddress, verifiers };
  const jobId = `lending-job-${randomUUID().slice(0, 8)}`;

  console.log(`\n=== JOB ${jobId} -- '${requestText}' (loan ${loanId})${injectFault ? " [FAULT INJECTED]" : ""} ===\n`);

  const result = await runTrustedJob(trustedAgentConfig, {
    jobId,
    budgetAmount: 0.06,
    requester,
    settler,
    providerAddresses: {
      "lending-apr-agent-v1": aprAgentAddress,
      "lending-eligibility-agent-v1": eligibilityAgentAddress,
    },
    gatherClaims,
    context: { loanId, requestText, injectFault },
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
