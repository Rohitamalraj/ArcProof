"""Real on-chain payment primitives against Arc testnet.

Arc's docs (docs.arc.io/arc/references/contract-addresses) are explicit
that USDC is the *native* gas-equivalent currency on Arc: "native gas
token uses 18 decimals; ERC-20 interface uses 6 decimals" and the ERC-20
address (0x3600...) is described as an "optional" view over that same
balance. That means moving USDC on Arc is a standard native-value
transfer -- sign it with eth_account, broadcast it with web3.py, wait for
the receipt. No ERC-20 approve/transfer call, no token contract, and
critically: no Circle account or entity-secret registration needed to
hold or move funds -- any keypair generated locally works the moment it's
funded via the public, signup-free faucet at faucet.circle.com.

RPC (https://rpc.testnet.arc.network) and chain id (5042002) are public
per docs.arc.io/arc/references/connect-to-arc -- no API key.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from eth_account import Account
from web3 import Web3

from shared.config import ARC_RPC_URL, ARC_CHAIN_ID, ARC_EXPLORER_URL
from shared.console import log

_w3 = Web3(Web3.HTTPProvider(ARC_RPC_URL))


class OnChainTransferFailed(Exception):
    pass


@dataclass
class OnChainTransfer:
    tx_hash: str
    from_address: str
    to_address: str
    amount_usdc: float
    block_number: int
    explorer_url: str


def is_connected() -> bool:
    return _w3.is_connected()


def explorer_link(tx_hash: str) -> str:
    # web3.py's HexBytes.hex() strips the "0x" prefix in this version, but
    # the Blockscout explorer behind ARC_EXPLORER_URL requires it -- without
    # it the page loads (200 OK) but silently shows "not found", which looks
    # identical to a real missing transaction unless you check the RPC directly.
    normalized = tx_hash if tx_hash.startswith("0x") else f"0x{tx_hash}"
    return f"{ARC_EXPLORER_URL}/tx/{normalized}"


def get_balance_usdc(address: str) -> float:
    """Real, live balance read from Arc -- not cached, not tracked locally."""
    wei = _w3.eth.get_balance(Web3.to_checksum_address(address))
    return float(_w3.from_wei(wei, "ether"))


def transfer(from_private_key: str, to_address: str, amount_usdc: float, memo: str = "") -> OnChainTransfer:
    """Sign and broadcast a real transaction on Arc testnet, then wait for it to mine.

    Raises OnChainTransferFailed if the transaction reverts or times out --
    callers should not treat a payment as having happened until this
    returns, since a receipt with status=1 is the only real proof.
    """
    account = Account.from_key(from_private_key)
    to_checksum = Web3.to_checksum_address(to_address)
    value_wei = _w3.to_wei(Decimal(str(amount_usdc)), "ether")

    tx = {
        "from": account.address,
        "to": to_checksum,
        "value": value_wei,
        "nonce": _w3.eth.get_transaction_count(account.address, "pending"),
        "gas": 21000,
        "gasPrice": _w3.eth.gas_price,
        "chainId": ARC_CHAIN_ID,
    }
    signed = account.sign_transaction(tx)
    tx_hash = _w3.eth.send_raw_transaction(signed.raw_transaction)

    try:
        receipt = _w3.eth.wait_for_transaction_receipt(tx_hash, timeout=90)
    except Exception as e:
        raise OnChainTransferFailed(f"transaction {tx_hash.hex()} did not confirm: {e}") from e

    result = OnChainTransfer(
        tx_hash=tx_hash.hex(),
        from_address=account.address,
        to_address=to_checksum,
        amount_usdc=amount_usdc,
        block_number=receipt["blockNumber"],
        explorer_url=explorer_link(tx_hash.hex()),
    )

    if receipt["status"] != 1:
        log("chain", f"REVERTED {result.tx_hash} ({memo})", style="bold red")
        raise OnChainTransferFailed(f"transaction {result.tx_hash} reverted on-chain")

    log(
        "chain",
        f"{account.address[:10]}.. -> {to_checksum[:10]}.. : {amount_usdc:.6f} USDC "
        f"| block {result.block_number} | {result.tx_hash} ({memo})",
        style="bold blue",
    )
    return result


def verify_transfer(tx_hash: str, expected_from: str, expected_to: str, min_amount_usdc: float) -> bool:
    """Independently re-derive a payment fact from the chain itself, rather
    than trusting a caller's word for it -- same principle the evaluator
    applies to specialist claims, applied here to payment claims.
    """
    try:
        receipt = _w3.eth.get_transaction_receipt(tx_hash)
        tx = _w3.eth.get_transaction(tx_hash)
    except Exception:
        return False
    if receipt is None or receipt["status"] != 1:
        return False
    if tx["from"].lower() != expected_from.lower():
        return False
    if tx["to"] is None or tx["to"].lower() != expected_to.lower():
        return False
    amount = float(_w3.from_wei(tx["value"], "ether"))
    return amount + 1e-9 >= min_amount_usdc
