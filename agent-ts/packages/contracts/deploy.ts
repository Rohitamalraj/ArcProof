/**
 * Deploys VeriFiEscrow to Arc testnet using the `escrow` role's wallet as
 * deployer/owner, with the `orchestrator` role's wallet set as the settler
 * (the only address allowed to release/finalize/refund a job -- matches
 * who already executes settlement.ts's settle() today). Ported from
 * agent/contracts/deploy.py.
 *
 * Reuses the ABI + bytecode already compiled for the Python version
 * (VeriFiEscrow.json, copied alongside this file) -- no recompile needed,
 * a contract's bytecode doesn't care what language deployed it.
 *
 * Writes the deployed address to deployed_address.txt so escrowContract.ts
 * can pick it up without redeploying every run.
 *
 * Run standalone:
 *   npx tsx packages/contracts/deploy.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { config, chain } from "@arcproof/core";

const { ARC_RPC_URL, WALLETS } = config;
const { arcTestnet } = chain;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = path.join(__dirname, "VeriFiEscrow.json");
const DEPLOYED_ADDRESS_PATH = path.join(__dirname, "deployed_address.txt");

async function deploy(): Promise<string> {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
  const deployerWallet = WALLETS.escrow;
  const settlerAddress = WALLETS.orchestrator.address;

  if (!deployerWallet.privateKey) throw new Error("no private key configured for role 'escrow' -- check .env (run npm run gen-wallets first)");
  if (!settlerAddress) throw new Error("no address configured for role 'orchestrator' -- check .env (run npm run gen-wallets first)");

  const account = privateKeyToAccount(deployerWallet.privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC_URL) });

  const txHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as `0x${string}`,
    args: [getAddress(settlerAddress)],
  });
  console.log(`deploy tx: ${txHash} -- waiting for receipt...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`deployment reverted: ${txHash}`);
  }

  const address = receipt.contractAddress;
  console.log(`VeriFiEscrow deployed at ${address} (block ${receipt.blockNumber}, settler=${settlerAddress})`);

  fs.writeFileSync(DEPLOYED_ADDRESS_PATH, address);
  console.log(`\nSave this into agent-ts/.env: ESCROW_CONTRACT_ADDRESS=${address}`);
  console.log(`(also mirrored at ${DEPLOYED_ADDRESS_PATH} for escrowContract.ts to read directly)`);
  return address;
}

deploy().catch((e) => {
  console.error(e);
  process.exit(1);
});
