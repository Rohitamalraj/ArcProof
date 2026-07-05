const MEDIUM_FEE = { type: "level", config: { feeLevel: "MEDIUM" } };
export class CircleWalletError extends Error {
}
const clientCache = new Map();
async function client(config) {
    if (!config.apiKey || !config.entitySecret) {
        throw new CircleWalletError("CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET required -- see README 'Circle Wallets setup'");
    }
    const cacheKey = config.apiKey;
    let c = clientCache.get(cacheKey);
    if (!c) {
        const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
        c = initiateDeveloperControlledWalletsClient({ apiKey: config.apiKey, entitySecret: config.entitySecret });
        clientCache.set(cacheKey, c);
    }
    return c;
}
export async function createWalletSet(config, name) {
    const resp = await (await client(config)).createWalletSet({ name });
    const walletSetId = resp.data.walletSet.id;
    console.log(`[circle] created wallet set '${name}' -> ${walletSetId}`);
    return walletSetId;
}
export async function createWallet(config, walletSetId, blockchain) {
    const resp = await (await client(config)).createWallets({ walletSetId, blockchains: [blockchain], count: 1 });
    const w = resp.data.wallets[0];
    console.log(`[circle] created wallet ${w.id} -> ${w.address} on ${blockchain}`);
    return { walletId: w.id, address: w.address };
}
export async function getBalanceNative(config, walletId) {
    const resp = await (await client(config)).getWalletTokenBalance({ id: walletId });
    const tokenBalances = resp.data?.tokenBalances || [];
    const native = tokenBalances.find((tb) => tb.token?.isNative);
    return native ? parseFloat(native.amount) : 0;
}
async function waitForTxHash(config, transactionId) {
    const resp = await (await client(config)).getTransaction({ id: transactionId, waitForTxHash: true });
    const txHash = resp.data.transaction.txHash;
    if (!txHash)
        throw new CircleWalletError(`Circle transaction ${transactionId} resolved with no txHash`);
    return txHash;
}
/** Calls a contract function through a Circle-managed wallet, waits for it to mine. */
export async function executeContract(config, walletId, contractAddress, abiFunctionSignature, abiParameters, amountNative = 0) {
    const resp = await (await client(config)).createContractExecutionTransaction({
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        amount: amountNative ? String(amountNative) : undefined,
        fee: MEDIUM_FEE,
    });
    const transactionId = resp.data.id;
    console.log(`[circle] submitted contract execution tx ${transactionId} (wallet ${walletId} -> ${contractAddress})`);
    const txHash = await waitForTxHash(config, transactionId);
    console.log(`[circle] tx ${transactionId} settled on-chain: ${txHash}`);
    return { txHash };
}
/** Simple native-value transfer through a Circle-managed wallet. */
export async function transfer(config, walletId, destinationAddress, amountNative) {
    const resp = await (await client(config)).createTransaction({
        walletId,
        destinationAddress,
        amount: [String(amountNative)],
        tokenAddress: "",
        fee: MEDIUM_FEE,
    });
    const transactionId = resp.data.id;
    console.log(`[circle] submitted transfer tx ${transactionId} (wallet ${walletId} -> ${destinationAddress})`);
    const txHash = await waitForTxHash(config, transactionId);
    console.log(`[circle] tx ${transactionId} settled on-chain: ${txHash}`);
    return { txHash };
}
//# sourceMappingURL=circleWallet.js.map