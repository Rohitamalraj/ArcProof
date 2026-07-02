"""x402 ("HTTP 402 Payment Required") handshake, settled for real on Arc testnet.

Wire shape matches the x402 spec: server 402s with {price, pay_to, asset,
network}, client pays and retries with an `X-Payment` header, server
verifies before serving and echoes a `Payment-Response` confirmation.

What's real: the payment itself. When a client hits a priced endpoint
with no proof, it gets a real 402. To proceed, it broadcasts a real,
signed Arc testnet transaction (payments/chain.py) moving real USDC from
its own wallet to the address the server named -- not a database write, a
mined block. The server then verifies the payment by reading the
transaction back from the chain itself (`chain.verify_transfer`), the same
"don't trust the claim, re-derive the fact independently" principle this
project's evaluator applies to specialist claims, applied here to payment
claims.

Note on scope: the real `x402` PyPI package (installed in this repo)
implements the full EIP-3009 gasless-authorization "exact" EVM scheme,
which needs a running facilitator service and signer classes satisfying
its ClientEvmSigner/FacilitatorEvmSigner protocols. That's the documented
upgrade path (see mechanisms/evm/exact/register.py in the installed
package) once this baseline is proven against a funded wallet. It's not
used here because Arc's USDC is itself the native gas-equivalent currency
(docs.arc.io/arc/references/contract-addresses) -- a payer already needs
native balance for gas, so there's no "gasless" advantage to unlock on
Arc specifically, and a direct on-chain transfer is simpler to verify end
to end today.
"""
from __future__ import annotations

import base64
import json

import httpx
from eth_account import Account
from fastapi import Request, HTTPException

from shared.console import log
from shared.config import ARC_CHAIN_ID
from payments import chain

PAYMENT_HEADER = "X-Payment"
PAYMENT_RESPONSE_HEADER = "Payment-Response"
NETWORK_ID = f"eip155:{ARC_CHAIN_ID}"  # Arc testnet


def _encode_proof(payer_address: str, tx_hash: str) -> str:
    raw = json.dumps({"payer_address": payer_address, "tx_hash": tx_hash}).encode()
    return base64.b64encode(raw).decode()


def _decode_proof(header_value: str) -> dict:
    return json.loads(base64.b64decode(header_value.encode()).decode())


async def require_payment(request: Request, price_usdc: float, pay_to_address: str, memo: str) -> dict:
    """FastAPI dependency: 402s the request without a verified proof.

    Returns the decoded {payer_address, tx_hash} proof on success.
    """
    header_value = request.headers.get(PAYMENT_HEADER)
    if not header_value:
        log("x402", f"402 Payment Required -> {pay_to_address[:10]}.. wants {price_usdc:.6f} USDC for '{memo}'", style="grey62")
        raise HTTPException(
            status_code=402,
            detail={
                "price_usdc": price_usdc,
                "pay_to": pay_to_address,
                "asset": "USDC",
                "network": NETWORK_ID,
                "memo": memo,
            },
        )

    try:
        proof = _decode_proof(header_value)
        tx_hash = proof["tx_hash"]
        payer_address = proof["payer_address"]
    except Exception:
        raise HTTPException(status_code=400, detail="malformed X-Payment header")

    verified = chain.verify_transfer(tx_hash, expected_from=payer_address, expected_to=pay_to_address, min_amount_usdc=price_usdc)
    if not verified:
        log("x402", f"payment REJECTED -- tx {tx_hash} does not independently verify on-chain", style="bold red")
        raise HTTPException(status_code=402, detail="payment could not be verified on-chain")

    log("x402", f"payment verified on-chain: {payer_address[:10]}.. paid {price_usdc:.6f} USDC (tx {tx_hash})", style="grey62")
    return proof


async def x402_post(client: httpx.AsyncClient, url: str, payer_private_key: str, json_body: dict) -> httpx.Response:
    """Client-side x402 flow: try unpaid, pay for real on 402, retry with proof."""
    resp = await client.post(url, json=json_body)
    if resp.status_code != 402:
        return resp

    detail = resp.json()["detail"]
    price = detail["price_usdc"]
    pay_to = detail["pay_to"]
    memo = detail.get("memo", url)

    tx = chain.transfer(payer_private_key, pay_to, price, memo=f"x402 nanopayment: {memo}")
    payer_address = Account.from_key(payer_private_key).address

    proof_header = _encode_proof(payer_address, tx.tx_hash)
    resp2 = await client.post(url, json=json_body, headers={PAYMENT_HEADER: proof_header})
    return resp2
