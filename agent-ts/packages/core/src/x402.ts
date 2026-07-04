/**
 * x402 ("HTTP 402 Payment Required") handshake, settled for real on Arc
 * testnet. Ported from agent/payments/x402.py.
 *
 * What's real: the payment itself, AND the wire format. The 402 response
 * body below is a genuine x402 PaymentRequired shape (x402Version, accepts:
 * PaymentRequirements[]) and the retry payload is a genuine PaymentPayload
 * -- any x402-aware client can parse these without knowing anything about
 * this project. When a client hits a priced endpoint with no proof, it
 * gets a real 402. To proceed, it broadcasts a real, signed Arc testnet
 * transaction (chain.ts) moving real USDC from its own wallet to the
 * address the server named -- not a database write, a mined block. The
 * server then verifies the payment by reading the transaction back from
 * the chain itself (chain.verifyTransfer), the same "don't trust the
 * claim, re-derive the fact independently" principle this project's
 * evaluator applies to specialist claims, applied here to payment claims.
 *
 * Why this file hand-defines the wire schema instead of importing the real
 * `x402` npm package's types: that package's current schema (checked
 * against x402@1.2.0's exports at packages/core/src/x402.ts write-time)
 * locks `scheme` to the literal "exact" and `network` to a fixed enum of
 * specific chains (base, avalanche, polygon, ...) that does not include Arc
 * testnet, and requires fields (resource/description/mimeType) this
 * project's flow doesn't produce. The schema below is still genuinely
 * spec-shaped (x402Version / accepts / scheme / network / asset / amount /
 * payTo / maxTimeoutSeconds / extra -- the same field set the Python
 * version's older x402 package exposed) and is parseable by anything that
 * understands the x402 HTTP 402 convention -- it's just not literally
 * imported from the npm package, because that package's *current* release
 * can't represent this chain/scheme combination. Same reasoning the Python
 * version documents for using a custom `scheme="exact-native"` instead of
 * the package's registered EIP-3009 "exact" EVM mechanism (which requires
 * a real ERC-20 `transferWithAuthorization` function Arc's native-currency
 * USDC doesn't have).
 */
import { z } from "zod";
import { parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ARC_CHAIN_ID, USDC_CONTRACT_ADDRESS } from "./config.js";
import { transfer as chainTransfer, verifyTransfer } from "./chain.js";

export const SCHEME = "exact-native";
export const NETWORK_ID = `eip155:${ARC_CHAIN_ID}`; // Arc testnet
export const X402_VERSION = 1;

export const PaymentRequirementsSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  asset: z.string(),
  amount: z.string(), // wei-denominated string, matches chain.ts's 18-decimal native unit
  payTo: z.string(),
  maxTimeoutSeconds: z.number(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

export const PaymentRequiredSchema = z.object({
  x402Version: z.number(),
  error: z.string(),
  resource: z.string().nullable().optional(),
  accepts: z.array(PaymentRequirementsSchema),
});
export type PaymentRequired = z.infer<typeof PaymentRequiredSchema>;

export const PaymentPayloadSchema = z.object({
  x402Version: z.number(),
  payload: z.record(z.string(), z.unknown()),
  accepted: PaymentRequirementsSchema,
  resource: z.string().nullable().optional(),
});
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

const PAYMENT_HEADER = "x-payment";

function usdcToWeiStr(amountUsdc: number): string {
  return parseEther(amountUsdc.toString()).toString();
}

function weiStrToUsdc(amountWei: string): number {
  return parseFloat(formatEther(BigInt(amountWei)));
}

function encodeProof(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function decodeProof(headerValue: string): PaymentPayload {
  const raw = JSON.parse(Buffer.from(headerValue, "base64").toString("utf-8"));
  return PaymentPayloadSchema.parse(raw);
}

export type PaymentCheckResult =
  | { ok: true; proof: { payerAddress: string; txHash: string } }
  | { ok: false; statusCode: number; body: unknown };

/**
 * Server-side check: given the raw `x-payment` header value (or undefined),
 * either returns the verified {payerAddress, txHash} proof, or a 402/400
 * response body the caller's Fastify route should send as-is.
 */
export async function requirePayment(
  headerValue: string | undefined,
  priceUsdc: number,
  payToAddress: string,
  memo: string
): Promise<PaymentCheckResult> {
  if (!headerValue) {
    console.log(`[x402] 402 Payment Required -> ${payToAddress.slice(0, 10)}.. wants ${priceUsdc.toFixed(6)} USDC for '${memo}'`);
    const requirements: PaymentRequirements = {
      scheme: SCHEME,
      network: NETWORK_ID,
      asset: USDC_CONTRACT_ADDRESS,
      amount: usdcToWeiStr(priceUsdc),
      payTo: payToAddress,
      maxTimeoutSeconds: 90,
      extra: { memo },
    };
    const paymentRequired: PaymentRequired = {
      x402Version: X402_VERSION,
      error: "X-Payment header is required",
      resource: null,
      accepts: [requirements],
    };
    return { ok: false, statusCode: 402, body: paymentRequired };
  }

  let payment: PaymentPayload;
  let txHash: string;
  let payerAddress: string;
  try {
    payment = decodeProof(headerValue);
    txHash = payment.payload.tx_hash as string;
    payerAddress = payment.payload.payer_address as string;
  } catch {
    return { ok: false, statusCode: 400, body: { error: "malformed X-Payment header" } };
  }

  const minAmount = weiStrToUsdc(payment.accepted.amount);
  const verified = await verifyTransfer(txHash, payerAddress, payToAddress, minAmount);
  if (!verified) {
    console.log(`[x402] payment REJECTED -- tx ${txHash} does not independently verify on-chain`);
    return { ok: false, statusCode: 402, body: { error: "payment could not be verified on-chain" } };
  }

  console.log(`[x402] payment verified on-chain: ${payerAddress.slice(0, 10)}.. paid ${minAmount.toFixed(6)} USDC (tx ${txHash})`);
  return { ok: true, proof: { payerAddress, txHash } };
}

/** Client-side x402 flow: try unpaid, pay for real on 402, retry with proof. */
export async function x402Post(url: string, payerPrivateKey: string, jsonBody: unknown): Promise<Response> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(jsonBody),
  });
  if (resp.status !== 402) return resp;

  const paymentRequired = PaymentRequiredSchema.parse(await resp.json());
  const requirements = paymentRequired.accepts[0];
  const priceUsdc = weiStrToUsdc(requirements.amount);
  const memo = (requirements.extra?.memo as string | undefined) ?? url;

  const tx = await chainTransfer(payerPrivateKey, requirements.payTo, priceUsdc, `x402 nanopayment: ${memo}`);
  const payerAddress = privateKeyToAccount(payerPrivateKey as `0x${string}`).address;

  const payment: PaymentPayload = {
    x402Version: X402_VERSION,
    payload: { payer_address: payerAddress, tx_hash: tx.txHash },
    accepted: requirements,
    resource: null,
  };
  const proofHeader = encodeProof(payment);

  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", [PAYMENT_HEADER]: proofHeader },
    body: JSON.stringify(jsonBody),
  });
}
