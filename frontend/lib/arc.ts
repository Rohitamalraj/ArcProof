// Real, public Arc testnet network parameters -- matches agent-ts/packages/core/src/chain.ts.
// No signup, no API key.
export const ARC_CHAIN_ID = 5042002;
export const ARC_CHAIN_ID_HEX = `0x${ARC_CHAIN_ID.toString(16)}`;
export const ARC_RPC_URL = "https://rpc.testnet.arc.network";
export const ARC_EXPLORER_URL =
  process.env.NEXT_PUBLIC_ARC_EXPLORER || "https://testnet.arcscan.app";
export const ARC_FAUCET_URL = "https://faucet.circle.com";

export const ARC_ADD_CHAIN_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: [ARC_RPC_URL],
  blockExplorerUrls: [ARC_EXPLORER_URL],
};

// Minimal ABI fragment for VeriFiEscrow.lock(bytes32) -- see
// agent-ts/packages/contracts/VeriFiEscrow.json for the full ABI. Only
// this one function is ever called from the browser; everything else
// (release/finalize/refund) is settler-only and stays server-side.
export const VERIFI_ESCROW_LOCK_ABI = [
  {
    type: "function",
    name: "lock",
    stateMutability: "payable",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [],
  },
] as const;

export function explorerAddressUrl(address: string): string {
  return `${ARC_EXPLORER_URL}/address/${address}`;
}

export function explorerTxUrl(txHash: string): string {
  return `${ARC_EXPLORER_URL}/tx/${txHash}`;
}
