// Real, public Arc testnet network parameters -- verified against
// docs.arc.io/arc/references/connect-to-arc. No signup, no API key.
// USDC is Arc's native gas-equivalent currency (18 decimals); the ERC-20
// view (0x3600...) is a separate optional read-path we don't use here.
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

export function explorerAddressUrl(address: string): string {
  return `${ARC_EXPLORER_URL}/address/${address}`;
}

export function explorerTxUrl(txHash: string): string {
  return `${ARC_EXPLORER_URL}/tx/${txHash}`;
}
