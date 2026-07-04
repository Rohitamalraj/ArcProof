/**
 * Real on-chain escrow via the deployed VeriFiEscrow contract
 * (../../contracts/VeriFiEscrow.sol) instead of plain wallet-to-wallet
 * transfers. Lock/release/finalize/refund are all real contract calls,
 * mined on Arc testnet -- this is what makes escrow a smart contract
 * enforcing the lock/release/withhold rules on-chain, not just
 * application-level bookkeeping moving funds between two EOAs (see
 * settlement.ts for the verdict/payout math that decides *what* to call
 * here). Ported from agent/payments/escrow_contract.py.
 *
 * jobId (a string like "job_3d3f9481fa") is addressed on-chain as
 * keccak256(jobId) -- the contract only ever sees the hash, the off-chain
 * JobRecord keeps the human-readable id.
 *
 * Deliberate change from the Python version: BOTH the `requester` role
 * (lock) and the `orchestrator` role (release/finalize/refund) can route
 * through a real Circle-managed wallet independently, when
 * CIRCLE_WALLET_ID_REQUESTER / CIRCLE_WALLET_ID_ORCHESTRATOR are
 * configured -- not just `requester` as in the Python version.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  keccak256,
  toBytes,
  parseEther,
  formatEther,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ARC_RPC_URL, ARC_CHAIN_ID, ARC_EXPLORER_URL, WALLETS, CIRCLE_WALLETS, type Role } from "./config.js";
import { arcTestnet } from "./chain.js";
import * as circleWallet from "./circleWallet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(__dirname, "..", "..", "contracts");
const ARTIFACT_PATH = path.join(CONTRACTS_DIR, "VeriFiEscrow.json");
const DEPLOYED_ADDRESS_PATH = path.join(CONTRACTS_DIR, "deployed_address.txt");

export class EscrowContractError extends Error {}

export interface ContractTx {
  txHash: string;
  blockNumber: number;
  explorerUrl: string;
}

interface Artifact {
  abi: readonly unknown[];
  bytecode: string;
}

function loadArtifact(): Artifact {
  return JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
}

export function contractAddress(): string {
  if (!fs.existsSync(DEPLOYED_ADDRESS_PATH)) {
    throw new EscrowContractError(
      "VeriFiEscrow not deployed yet -- run `npm run deploy-contract` first (see packages/contracts/deploy.ts)."
    );
  }
  return fs.readFileSync(DEPLOYED_ADDRESS_PATH, "utf-8").trim();
}

export function jobIdToBytes32(jobId: string): `0x${string}` {
  return keccak256(toBytes(jobId));
}

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });

function walletClientFor(role: Role) {
  const w = WALLETS[role];
  if (!w.privateKey) throw new EscrowContractError(`no private key configured for role '${role}' -- check .env`);
  const account = privateKeyToAccount(w.privateKey as `0x${string}`);
  return createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC_URL) });
}

async function sendContractCall(
  role: Role,
  functionName: string,
  args: unknown[],
  valueWei = 0n
): Promise<ContractTx> {
  const { abi } = loadArtifact();
  const address = getAddress(contractAddress());
  const wallet = walletClientFor(role);

  const txHash = await wallet.writeContract({
    address,
    abi: abi as any,
    functionName,
    args,
    value: valueWei,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
  if (receipt.status !== "success") {
    throw new EscrowContractError(`contract call reverted: ${txHash}`);
  }
  return { txHash, blockNumber: Number(receipt.blockNumber), explorerUrl: `${ARC_EXPLORER_URL}/tx/${txHash}` };
}

/**
 * Requester locks a job's budget into the contract (a real payable call).
 * Uses a real Circle-managed wallet for the `requester` role when
 * CIRCLE_WALLET_ID_REQUESTER is configured -- falls back to the role's
 * plain private key otherwise. Either way the contract sees a real
 * `msg.sender` it records as that job's requester.
 */
export async function lock(jobId: string, requesterRole: Role, amountUsdc: number): Promise<ContractTx> {
  const circleEntry = requesterRole === "requester" ? CIRCLE_WALLETS.requester : undefined;
  if (circleEntry) {
    const jobIdHex = jobIdToBytes32(jobId);
    const circleResult = await circleWallet.executeContract(
      circleEntry.walletId,
      contractAddress(),
      "lock(bytes32)",
      [jobIdHex],
      amountUsdc
    );
    // Circle's waitForTxHash only guarantees Circle's own systems have
    // broadcast the tx and know its hash -- it does NOT guarantee the
    // public Arc RPC node has indexed a receipt for it yet. A plain
    // getTransactionReceipt() here raced ahead of that propagation delay
    // and threw TransactionReceiptNotFoundError on a transaction that had
    // genuinely succeeded, which failed the whole job and refunded a
    // legitimate payout. waitForTransactionReceipt polls instead of
    // one-shot failing, matching what the non-Circle branch below already
    // does correctly.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: circleResult.txHash as Hash, timeout: 90_000 });
    const result: ContractTx = {
      txHash: circleResult.txHash,
      blockNumber: Number(receipt.blockNumber),
      explorerUrl: circleResult.explorerUrl,
    };
    console.log(`[escrow-contract] lock(${jobId}) ${amountUsdc.toFixed(6)} USDC via Circle wallet | tx ${result.txHash} | block ${result.blockNumber}`);
    return result;
  }

  const valueWei = parseEther(amountUsdc.toString());
  const result = await sendContractCall(requesterRole, "lock", [jobIdToBytes32(jobId)], valueWei);
  console.log(`[escrow-contract] lock(${jobId}) ${amountUsdc.toFixed(6)} USDC | tx ${result.txHash} | block ${result.blockNumber}`);
  return result;
}

/** Settler (orchestrator) releases one specialist's payout for a job. */
export async function release(
  jobId: string,
  providerRole: Role,
  amountUsdc: number,
  outcome: string
): Promise<ContractTx> {
  const providerAddress = getAddress(WALLETS[providerRole].address);
  const amountWei = parseEther(amountUsdc.toString());

  const circleEntry = CIRCLE_WALLETS.orchestrator;
  let result: ContractTx;
  if (circleEntry) {
    const jobIdHex = jobIdToBytes32(jobId);
    const circleResult = await circleWallet.executeContract(
      circleEntry.walletId,
      contractAddress(),
      "release(bytes32,address,uint256,string)",
      [jobIdHex, providerAddress, amountWei.toString(), outcome]
    );
    // Circle's waitForTxHash only guarantees Circle's own systems have
    // broadcast the tx and know its hash -- it does NOT guarantee the
    // public Arc RPC node has indexed a receipt for it yet. A plain
    // getTransactionReceipt() here raced ahead of that propagation delay
    // and threw TransactionReceiptNotFoundError on a transaction that had
    // genuinely succeeded, which failed the whole job and refunded a
    // legitimate payout. waitForTransactionReceipt polls instead of
    // one-shot failing, matching what the non-Circle branch below already
    // does correctly.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: circleResult.txHash as Hash, timeout: 90_000 });
    result = { txHash: circleResult.txHash, blockNumber: Number(receipt.blockNumber), explorerUrl: circleResult.explorerUrl };
  } else {
    result = await sendContractCall("orchestrator", "release", [jobIdToBytes32(jobId), providerAddress, amountWei, outcome]);
  }
  console.log(`[escrow-contract] release(${jobId} -> ${providerRole}) ${amountUsdc.toFixed(6)} USDC (${outcome}) | tx ${result.txHash} | block ${result.blockNumber}`);
  return result;
}

/** Settler closes a job; any unreleased balance stays withheld in the contract. */
export async function finalize(jobId: string): Promise<ContractTx> {
  const circleEntry = CIRCLE_WALLETS.orchestrator;
  let result: ContractTx;
  if (circleEntry) {
    const circleResult = await circleWallet.executeContract(circleEntry.walletId, contractAddress(), "finalize(bytes32)", [jobIdToBytes32(jobId)]);
    // Circle's waitForTxHash only guarantees Circle's own systems have
    // broadcast the tx and know its hash -- it does NOT guarantee the
    // public Arc RPC node has indexed a receipt for it yet. A plain
    // getTransactionReceipt() here raced ahead of that propagation delay
    // and threw TransactionReceiptNotFoundError on a transaction that had
    // genuinely succeeded, which failed the whole job and refunded a
    // legitimate payout. waitForTransactionReceipt polls instead of
    // one-shot failing, matching what the non-Circle branch below already
    // does correctly.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: circleResult.txHash as Hash, timeout: 90_000 });
    result = { txHash: circleResult.txHash, blockNumber: Number(receipt.blockNumber), explorerUrl: circleResult.explorerUrl };
  } else {
    result = await sendContractCall("orchestrator", "finalize", [jobIdToBytes32(jobId)]);
  }
  console.log(`[escrow-contract] finalize(${jobId}) | tx ${result.txHash} | block ${result.blockNumber}`);
  return result;
}

/** Settler refunds a job's full remaining locked balance to the requester. */
export async function refund(jobId: string): Promise<ContractTx> {
  const circleEntry = CIRCLE_WALLETS.orchestrator;
  let result: ContractTx;
  if (circleEntry) {
    const circleResult = await circleWallet.executeContract(circleEntry.walletId, contractAddress(), "refund(bytes32)", [jobIdToBytes32(jobId)]);
    // Circle's waitForTxHash only guarantees Circle's own systems have
    // broadcast the tx and know its hash -- it does NOT guarantee the
    // public Arc RPC node has indexed a receipt for it yet. A plain
    // getTransactionReceipt() here raced ahead of that propagation delay
    // and threw TransactionReceiptNotFoundError on a transaction that had
    // genuinely succeeded, which failed the whole job and refunded a
    // legitimate payout. waitForTransactionReceipt polls instead of
    // one-shot failing, matching what the non-Circle branch below already
    // does correctly.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: circleResult.txHash as Hash, timeout: 90_000 });
    result = { txHash: circleResult.txHash, blockNumber: Number(receipt.blockNumber), explorerUrl: circleResult.explorerUrl };
  } else {
    result = await sendContractCall("orchestrator", "refund", [jobIdToBytes32(jobId)]);
  }
  console.log(`[escrow-contract] refund(${jobId}) | tx ${result.txHash} | block ${result.blockNumber}`);
  return result;
}

export interface EscrowJob {
  requester: string;
  lockedUsdc: number;
  releasedUsdc: number;
  status: "none" | "locked" | "settled" | "refunded";
}

export async function getJob(jobId: string): Promise<EscrowJob> {
  const { abi } = loadArtifact();
  const address = getAddress(contractAddress());
  const [requester, locked, released, status] = (await publicClient.readContract({
    address,
    abi: abi as any,
    functionName: "getJob",
    args: [jobIdToBytes32(jobId)],
  })) as [string, bigint, bigint, number];

  return {
    requester,
    lockedUsdc: parseFloat(formatEther(locked)),
    releasedUsdc: parseFloat(formatEther(released)),
    status: (["none", "locked", "settled", "refunded"] as const)[status],
  };
}

export { loadArtifact };
