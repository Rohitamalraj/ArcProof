"""x402 ("HTTP 402 Payment Required") handshake, using the real installed
x402 package's wire schema (x402.schemas.payments) for the 402 response
and payment-proof shapes, settled for real on Arc testnet.

What's real: the payment itself, AND the wire format. The 402 response
body is a genuine x402 `PaymentRequired` (accepts: list[PaymentRequirements])
and the retry payload is a genuine `PaymentPayload` -- any x402-aware
client library can parse these without knowing anything about this
project. When a client hits a priced endpoint with no proof, it gets a
real 402. To proceed, it broadcasts a real, signed Arc testnet
transaction (payments/chain.py) moving real USDC from its own wallet to
the address the server named -- not a database write, a mined block. The
server then verifies the payment by reading the transaction back from
the chain itself (`chain.verify_transfer`), the same "don't trust the
claim, re-derive the fact independently" principle this project's
evaluator applies to specialist claims, applied here to payment claims.

Why "exact-native" instead of the package's registered "exact" EVM scheme:
the real x402 package's EVM "exact" scheme (mechanisms/evm/exact/) is
built on EIP-3009 `transferWithAuthorization` -- a function only a real
ERC-20 *contract* implements. Arc's USDC is native currency (18-decimal
gas token, per docs.arc.io/arc/references/contract-addresses), not an
ERC-20 -- the 0x3600... address is documented as only an optional
read-view over the native balance, with no transferWithAuthorization to
call. Forcing the EIP-3009 scheme onto a chain that doesn't need gasless
authorization (a payer already needs native balance for gas) would add a
facilitator dependency for zero benefit and likely wouldn't work at all.
So this project uses the real x402 *wire types* (PaymentRequired,
PaymentRequirements, PaymentPayload) -- genuine, spec-compliant, parseable
by any x402 client -- with a custom `scheme="exact-native"` whose
settlement is a direct signed native transfer, independently re-verified
on-chain. See mechanisms/evm/exact/register.py in the installed package
for the EIP-3009 classes if that scheme is ever needed on a chain where
USDC really is an ERC-20.
"""
from __future__ import annotations

import base64
import json

import httpx
from eth_account import Account
from fastapi import Request, HTTPException
from web3 import Web3

from x402.schemas.payments import PaymentRequired, PaymentRequirements, PaymentPayload

from shared.console import log
from shared.config import ARC_CHAIN_ID, USDC_CONTRACT_ADDRESS
from payments import chain

PAYMENT_HEADER = "X-Payment"
PAYMENT_RESPONSE_HEADER = "Payment-Response"
NETWORK_ID = f"eip155:{ARC_CHAIN_ID}"  # Arc testnet
SCHEME = "exact-native"
X402_VERSION = 1


def _usdc_to_wei_str(amount_usdc: float) -> str:
    return str(Web3.to_wei(amount_usdc, "ether"))


def _wei_str_to_usdc(amount_wei: str) -> float:
    return float(Web3.from_wei(int(amount_wei), "ether"))


def _encode_proof(payload: PaymentPayload) -> str:
    raw = json.dumps(payload.model_dump(by_alias=True)).encode()
    return base64.b64encode(raw).decode()


def _decode_proof(header_value: str) -> PaymentPayload:
    raw = json.loads(base64.b64decode(header_value.encode()).decode())
    return PaymentPayload(**raw)


async def require_payment(request: Request, price_usdc: float, pay_to_address: str, memo: str) -> dict:
    """FastAPI dependency: 402s the request without a verified proof.

    Returns the decoded {payer_address, tx_hash} proof on success.
    """
    header_value = request.headers.get(PAYMENT_HEADER)
    if not header_value:
        log("x402", f"402 Payment Required -> {pay_to_address[:10]}.. wants {price_usdc:.6f} USDC for '{memo}'", style="grey62")
        requirements = PaymentRequirements(
            scheme=SCHEME,
            network=NETWORK_ID,
            asset=USDC_CONTRACT_ADDRESS,
            amount=_usdc_to_wei_str(price_usdc),
            pay_to=pay_to_address,
            max_timeout_seconds=90,
            extra={"memo": memo},
        )
        payment_required = PaymentRequired(
            x402_version=X402_VERSION,
            error="X-Payment header is required",
            resource=None,
            accepts=[requirements],
        )
        raise HTTPException(status_code=402, detail=payment_required.model_dump(by_alias=True))

    try:
        payment = _decode_proof(header_value)
        proof = payment.payload
        tx_hash = proof["tx_hash"]
        payer_address = proof["payer_address"]
    except Exception:
        raise HTTPException(status_code=400, detail="malformed X-Payment header")

    min_amount = _wei_str_to_usdc(payment.accepted.amount)
    verified = chain.verify_transfer(tx_hash, expected_from=payer_address, expected_to=pay_to_address, min_amount_usdc=min_amount)
    if not verified:
        log("x402", f"payment REJECTED -- tx {tx_hash} does not independently verify on-chain", style="bold red")
        raise HTTPException(status_code=402, detail="payment could not be verified on-chain")

    log("x402", f"payment verified on-chain: {payer_address[:10]}.. paid {min_amount:.6f} USDC (tx {tx_hash})", style="grey62")
    return proof


async def x402_post(client: httpx.AsyncClient, url: str, payer_private_key: str, json_body: dict) -> httpx.Response:
    """Client-side x402 flow: try unpaid, pay for real on 402, retry with proof."""
    resp = await client.post(url, json=json_body)
    if resp.status_code != 402:
        return resp

    # FastAPI wraps HTTPException(detail=...) as {"detail": <our x402 JSON>}
    payment_required = PaymentRequired(**resp.json()["detail"])
    requirements = payment_required.accepts[0]
    price_usdc = _wei_str_to_usdc(requirements.amount)
    memo = requirements.extra.get("memo", url) if requirements.extra else url

    tx = chain.transfer(payer_private_key, requirements.pay_to, price_usdc, memo=f"x402 nanopayment: {memo}")
    payer_address = Account.from_key(payer_private_key).address

    payment = PaymentPayload(
        x402_version=X402_VERSION,
        payload={"payer_address": payer_address, "tx_hash": tx.tx_hash},
        accepted=requirements,
        resource=None,
    )
    proof_header = _encode_proof(payment)
    resp2 = await client.post(url, json=json_body, headers={PAYMENT_HEADER: proof_header})
    return resp2
