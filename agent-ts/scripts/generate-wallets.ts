/**
 * Generates a fresh EVM keypair for each of the 6 agent-ts roles (plain
 * viem keys -- the same "any keypair generated locally is a real, fundable
 * Arc testnet wallet" principle the Python version documents, since Arc's
 * USDC is native currency and needs no Circle account to hold or move).
 *
 * This project is kept fully independent from agent/'s existing wallets/
 * deployed contract by design (see the approved plan) -- rerun this once
 * to get your own wallet set for agent-ts/, then fund `requester` and
 * `orchestrator` at https://faucet.circle.com before deploying the
 * contract or running the demo.
 *
 * Run with:
 *   npm run gen-wallets
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, "..", ".env");
const ENV_EXAMPLE_PATH = path.join(__dirname, "..", ".env.example");

const ROLES = ["requester", "orchestrator", "escrow", "onchain-agent-v1", "news-agent-v1", "compliance-agent-v1"] as const;

const roleEnvPrefix: Record<(typeof ROLES)[number], string> = {
  requester: "REQUESTER",
  orchestrator: "ORCHESTRATOR",
  escrow: "ESCROW",
  "onchain-agent-v1": "ONCHAIN_AGENT",
  "news-agent-v1": "NEWS_AGENT",
  "compliance-agent-v1": "COMPLIANCE_AGENT",
};

function main() {
  console.log("Generating a fresh wallet for each role...\n");
  const lines: string[] = [];

  for (const role of ROLES) {
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;
    const prefix = roleEnvPrefix[role];
    console.log(`${role.padEnd(20)} ${address}`);
    lines.push(`${prefix}_ADDRESS=${address}`);
    lines.push(`${prefix}_PRIVATE_KEY=${privateKey}`);
  }

  console.log("\n--- .env lines (paste into agent-ts/.env) ---\n");
  console.log(lines.join("\n"));

  if (!fs.existsSync(ENV_PATH)) {
    const example = fs.existsSync(ENV_EXAMPLE_PATH) ? fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8") : "";
    fs.writeFileSync(ENV_PATH, `${example}\n\n${lines.join("\n")}\n`);
    console.log(`\nNo .env existed yet -- created agent-ts/.env with these wallets merged into .env.example's template.`);
  } else {
    console.log(`\nagent-ts/.env already exists -- not overwriting it. Paste the lines above in yourself.`);
  }

  console.log(
    `\nNext: fund 'requester' and 'orchestrator' at https://faucet.circle.com (select Arc testnet, no account needed, ~20 USDC per address per 2 hours),\n` +
      `then run: npm run deploy-contract`
  );
}

main();
