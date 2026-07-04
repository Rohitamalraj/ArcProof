/**
 * One-time provisioning helper for real Circle Developer-Controlled
 * Wallets: creates one wallet set and one Circle-managed wallet per role
 * you ask for, and prints the CIRCLE_WALLET_ID_<ROLE>/CIRCLE_ADDRESS_<ROLE>
 * env lines to paste into agent-ts/.env.
 *
 * Prerequisites (see README.md "Circle Wallets setup"):
 *   1. CIRCLE_API_KEY set in .env (console.circle.com/api-keys).
 *   2. CIRCLE_ENTITY_SECRET set in .env -- generate one with:
 *        node -e "require('@circle-fin/developer-controlled-wallets').generateEntitySecret()"
 *      then register it once with:
 *        node -e "require('@circle-fin/developer-controlled-wallets').registerEntitySecretCiphertext({apiKey: process.env.CIRCLE_API_KEY, entitySecret: process.env.CIRCLE_ENTITY_SECRET}).then(r => console.log(r.data?.recoveryFile))"
 *
 * Run with (choose any subset of roles as args, default = all 5):
 *   npx tsx scripts/circle-setup.ts requester orchestrator onchain-agent-v1 news-agent-v1 compliance-agent-v1
 */
import { createWalletSet, createWallet } from "../packages/core/src/circleWallet.js";
import { CIRCLE_WALLET_SET_ID } from "../packages/core/src/config.js";

const roleEnvPrefix: Record<string, string> = {
  requester: "REQUESTER",
  orchestrator: "ORCHESTRATOR",
  "onchain-agent-v1": "ONCHAIN_AGENT",
  "news-agent-v1": "NEWS_AGENT",
  "compliance-agent-v1": "COMPLIANCE_AGENT",
};

async function main() {
  const roles = process.argv.slice(2);
  const targetRoles = roles.length ? roles : Object.keys(roleEnvPrefix);
  for (const role of targetRoles) {
    if (!roleEnvPrefix[role]) throw new Error(`unknown role '${role}' -- must be one of ${Object.keys(roleEnvPrefix).join(", ")}`);
  }

  let walletSetId = CIRCLE_WALLET_SET_ID;
  if (!walletSetId) {
    walletSetId = await createWalletSet("arcproof-agent-ts");
    console.log(`\nPaste this into .env: CIRCLE_WALLET_SET_ID=${walletSetId}\n`);
  } else {
    console.log(`Reusing existing wallet set from .env: ${walletSetId}\n`);
  }

  const lines: string[] = [];
  for (const role of targetRoles) {
    const { walletId, address } = await createWallet(walletSetId);
    const prefix = roleEnvPrefix[role];
    lines.push(`CIRCLE_WALLET_ID_${prefix}=${walletId}`);
    lines.push(`CIRCLE_ADDRESS_${prefix}=${address}`);
    console.log(`${role.padEnd(20)} wallet ${walletId} -> ${address}`);
  }

  console.log("\n--- .env lines (paste into agent-ts/.env) ---\n");
  console.log(lines.join("\n"));
  console.log(
    "\nFund each printed address at https://faucet.circle.com (select Arc testnet) before running jobs through them."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
