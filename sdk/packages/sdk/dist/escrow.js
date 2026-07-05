/**
 * Generic on-chain conditional escrow -- lock a budget, release it to
 * providers based on a verdict, or refund it. Wraps the same VeriFiEscrow
 * contract agent-ts uses (the contract itself has zero DeFi-specific
 * logic already -- it's just bytes32 jobId -> locked/released/refunded
 * native value -- so it's reused here as-is, just deployable
 * independently of that reference app).
 *
 * Deliberate generalization vs. agent-ts's escrowContract.ts: that module
 * looks up a fixed `Role` in a global WALLETS/CIRCLE_WALLETS config object
 * built from one specific .env schema. Here, every function takes a
 * `WalletCredential` directly -- a plain private key or a Circle wallet
 * id (with its own Circle API config attached) -- so this package doesn't
 * assume anything about how its caller manages roles or credentials.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, getAddress, keccak256, toBytes, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor } from "./chain.js";
import * as circleWallet from "./circleWallet.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = path.join(__dirname, "..", "contracts", "VeriFiEscrow.json");
export class EscrowError extends Error {
}
function loadArtifact() {
    return JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
}
export function jobIdToBytes32(jobId) {
    return keccak256(toBytes(jobId));
}
/** Deploys a fresh VeriFiEscrow instance. `settlerAddress` is the only address allowed to release/finalize/refund. */
export async function deployEscrow(network, deployerPrivateKey, settlerAddress) {
    const { abi, bytecode } = loadArtifact();
    const chain = chainFor(network);
    const account = privateKeyToAccount(deployerPrivateKey);
    const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
    const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });
    const txHash = await walletClient.deployContract({ abi: abi, bytecode, args: [getAddress(settlerAddress)] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) {
        throw new EscrowError(`deployment reverted: ${txHash}`);
    }
    console.log(`[escrow] VeriFiEscrow deployed at ${receipt.contractAddress} (block ${receipt.blockNumber}, settler=${settlerAddress})`);
    return receipt.contractAddress;
}
async function sendPlain(network, contractAddress, privateKey, functionName, args, valueWei = 0n) {
    const { abi } = loadArtifact();
    const chain = chainFor(network);
    const account = privateKeyToAccount(privateKey);
    const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
    const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });
    const txHash = await walletClient.writeContract({ address: getAddress(contractAddress), abi: abi, functionName, args, value: valueWei });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
    if (receipt.status !== "success")
        throw new EscrowError(`contract call reverted: ${txHash}`);
    return { txHash, blockNumber: Number(receipt.blockNumber), explorerUrl: `${network.explorerUrl}/tx/${txHash}` };
}
async function sendCircle(network, contractAddress, credential, abiFunctionSignature, abiParameters, amountNative = 0) {
    const publicClient = createPublicClient({ chain: chainFor(network), transport: http(network.rpcUrl) });
    const { txHash } = await circleWallet.executeContract(credential.circleConfig, credential.walletId, contractAddress, abiFunctionSignature, abiParameters, amountNative);
    // Circle's own systems confirming a tx hash exists does not guarantee
    // the public RPC node has indexed a receipt for it yet -- a one-shot
    // getTransactionReceipt() here would spuriously throw
    // TransactionReceiptNotFoundError on a transaction that genuinely
    // succeeded (reproduced live while building agent-ts's escrowContract.ts
    // -- see that file's history). waitForTransactionReceipt polls instead.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
    return { txHash, blockNumber: Number(receipt.blockNumber), explorerUrl: `${network.explorerUrl}/tx/${txHash}` };
}
/** Requester locks a job's budget into the contract (a real payable call). */
export async function lock(network, contractAddress, jobId, requester, amountNative) {
    const jobIdHex = jobIdToBytes32(jobId);
    const result = requester.kind === "circle"
        ? await sendCircle(network, contractAddress, requester, "lock(bytes32)", [jobIdHex], amountNative)
        : await sendPlain(network, contractAddress, requester.privateKey, "lock", [jobIdHex], parseEther(amountNative.toString()));
    console.log(`[escrow] lock(${jobId}) ${amountNative.toFixed(6)} | tx ${result.txHash} | block ${result.blockNumber}`);
    return result;
}
/** Settler releases one provider's payout for a job. */
export async function release(network, contractAddress, jobId, settler, providerAddress, amountNative, outcome) {
    const jobIdHex = jobIdToBytes32(jobId);
    const providerChecksum = getAddress(providerAddress);
    const amountWei = parseEther(amountNative.toString());
    const result = settler.kind === "circle"
        ? await sendCircle(network, contractAddress, settler, "release(bytes32,address,uint256,string)", [jobIdHex, providerChecksum, amountWei.toString(), outcome])
        : await sendPlain(network, contractAddress, settler.privateKey, "release", [jobIdHex, providerChecksum, amountWei, outcome]);
    console.log(`[escrow] release(${jobId} -> ${providerAddress}) ${amountNative.toFixed(6)} (${outcome}) | tx ${result.txHash} | block ${result.blockNumber}`);
    return result;
}
/** Settler closes a job; any unreleased balance stays withheld in the contract. */
export async function finalize(network, contractAddress, jobId, settler) {
    const jobIdHex = jobIdToBytes32(jobId);
    const result = settler.kind === "circle"
        ? await sendCircle(network, contractAddress, settler, "finalize(bytes32)", [jobIdHex])
        : await sendPlain(network, contractAddress, settler.privateKey, "finalize", [jobIdHex]);
    console.log(`[escrow] finalize(${jobId}) | tx ${result.txHash} | block ${result.blockNumber}`);
    return result;
}
/** Settler refunds a job's full remaining locked balance to the requester. */
export async function refund(network, contractAddress, jobId, settler) {
    const jobIdHex = jobIdToBytes32(jobId);
    const result = settler.kind === "circle"
        ? await sendCircle(network, contractAddress, settler, "refund(bytes32)", [jobIdHex])
        : await sendPlain(network, contractAddress, settler.privateKey, "refund", [jobIdHex]);
    console.log(`[escrow] refund(${jobId}) | tx ${result.txHash} | block ${result.blockNumber}`);
    return result;
}
export async function getJob(network, contractAddress, jobId) {
    const { abi } = loadArtifact();
    const client = createPublicClient({ chain: chainFor(network), transport: http(network.rpcUrl) });
    const [requester, locked, released, status] = (await client.readContract({
        address: getAddress(contractAddress),
        abi: abi,
        functionName: "getJob",
        args: [jobIdToBytes32(jobId)],
    }));
    return {
        requester,
        lockedAmount: parseFloat(formatEther(locked)),
        releasedAmount: parseFloat(formatEther(released)),
        status: ["none", "locked", "settled", "refunded"][status],
    };
}
//# sourceMappingURL=escrow.js.map