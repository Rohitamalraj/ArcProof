"""Real on-chain escrow via the deployed VeriFiEscrow contract
(contracts/VeriFiEscrow.sol) instead of plain wallet-to-wallet transfers.
Lock/release/finalize/refund are all real contract calls, mined on Arc
testnet -- this is what makes escrow a smart contract enforcing the
lock/release/withhold rules on-chain, not just application-level Python
bookkeeping moving funds between two EOAs (see settlement/escrow.py for
the verdict/payout math that decides *what* to call here).

job_id (a Python string like "job_3d3f9481fa") is addressed on-chain as
keccak256(job_id) -- the contract only ever sees the hash, the off-chain
JobRecord keeps the human-readable id.
"""
from __future__ import annotations
import json
import os
from dataclasses import dataclass
from decimal import Decimal

from web3 import Web3

from shared.config import ARC_RPC_URL, ARC_CHAIN_ID, ARC_EXPLORER_URL, WALLETS, CIRCLE_REQUESTER_WALLET_ID
from shared.console import log

_CONTRACTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "contracts")
_ARTIFACT_PATH = os.path.join(_CONTRACTS_DIR, "VeriFiEscrow.json")
_DEPLOYED_ADDRESS_PATH = os.path.join(_CONTRACTS_DIR, "deployed_address.txt")

_w3 = Web3(Web3.HTTPProvider(ARC_RPC_URL))


class EscrowContractError(Exception):
    pass


@dataclass
class ContractTx:
    tx_hash: str
    block_number: int
    explorer_url: str


def _load_contract():
    if not os.path.exists(_DEPLOYED_ADDRESS_PATH):
        raise EscrowContractError(
            "VeriFiEscrow not deployed yet -- run `python -m contracts.deploy` first "
            "(see contracts/deploy.py)."
        )
    with open(_ARTIFACT_PATH) as f:
        artifact = json.load(f)
    with open(_DEPLOYED_ADDRESS_PATH) as f:
        address = f.read().strip()
    return _w3.eth.contract(address=Web3.to_checksum_address(address), abi=artifact["abi"])


def contract_address() -> str:
    with open(_DEPLOYED_ADDRESS_PATH) as f:
        return f.read().strip()


def job_id_to_bytes32(job_id: str) -> bytes:
    return Web3.keccak(text=job_id)


def _send(role: str, fn, value_wei: int = 0):
    wallet = WALLETS[role]
    account_address = Web3.to_checksum_address(wallet["address"])
    tx = fn.build_transaction({
        "from": account_address,
        "value": value_wei,
        "nonce": _w3.eth.get_transaction_count(account_address, "pending"),
        "gas": 300_000,
        "gasPrice": _w3.eth.gas_price,
        "chainId": ARC_CHAIN_ID,
    })
    signed = _w3.eth.account.sign_transaction(tx, wallet["private_key"])
    tx_hash = _w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = _w3.eth.wait_for_transaction_receipt(tx_hash, timeout=90)
    if receipt["status"] != 1:
        raise EscrowContractError(f"contract call reverted: {tx_hash.hex()}")
    return ContractTx(
        tx_hash=tx_hash.hex(),
        block_number=receipt["blockNumber"],
        explorer_url=f"{ARC_EXPLORER_URL}/tx/{tx_hash.hex()}",
    )


def lock(job_id: str, requester_role: str, amount_usdc: float) -> ContractTx:
    """Requester locks a job's budget into the contract (a real payable call).

    The `requester` role locks exclusively through its real Circle-managed
    wallet (payments/circle_wallet.py) -- there is no eth_account fallback
    for this role. Any other role name (unused by the current orchestrator,
    kept for flexibility) still signs with its own configured eth_account
    key. Either way the contract sees a real `msg.sender` it records as
    that job's requester.
    """
    if requester_role == "requester":
        if not CIRCLE_REQUESTER_WALLET_ID:
            raise EscrowContractError(
                "CIRCLE_REQUESTER_WALLET_ID is not set in .env -- the requester role locks "
                "budget exclusively through a real Circle-managed wallet now (no eth_account "
                "fallback). Provision one with contracts/circle_setup.py and set "
                "CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET/CIRCLE_WALLET_SET_ID/"
                "CIRCLE_REQUESTER_WALLET_ID/CIRCLE_REQUESTER_ADDRESS in .env."
            )
        from payments import circle_wallet
        job_id_hex = "0x" + job_id_to_bytes32(job_id).hex()
        circle_result = circle_wallet.execute_contract(
            wallet_id=CIRCLE_REQUESTER_WALLET_ID,
            contract_address=contract_address(),
            abi_function_signature="lock(bytes32)",
            abi_parameters=[job_id_hex],
            amount_native=amount_usdc,
        )
        receipt = _w3.eth.get_transaction_receipt(circle_result["tx_hash"])
        result = ContractTx(tx_hash=circle_result["tx_hash"], block_number=receipt["blockNumber"], explorer_url=circle_result["explorer_url"])
        log("escrow-contract", f"lock({job_id}) {amount_usdc:.6f} USDC via Circle wallet | tx {result.tx_hash} | block {result.block_number}", style="bold blue")
        return result

    contract = _load_contract()
    value_wei = _w3.to_wei(Decimal(str(amount_usdc)), "ether")
    result = _send(requester_role, contract.functions.lock(job_id_to_bytes32(job_id)), value_wei=value_wei)
    log("escrow-contract", f"lock({job_id}) {amount_usdc:.6f} USDC | tx {result.tx_hash} | block {result.block_number}", style="bold blue")
    return result


def release(job_id: str, provider_role: str, amount_usdc: float, outcome: str) -> ContractTx:
    """Settler (orchestrator) releases one specialist's payout for a job."""
    contract = _load_contract()
    provider_address = Web3.to_checksum_address(WALLETS[provider_role]["address"])
    amount_wei = _w3.to_wei(Decimal(str(amount_usdc)), "ether")
    result = _send("orchestrator", contract.functions.release(job_id_to_bytes32(job_id), provider_address, amount_wei, outcome))
    log("escrow-contract", f"release({job_id} -> {provider_role}) {amount_usdc:.6f} USDC ({outcome}) | tx {result.tx_hash} | block {result.block_number}", style="bold blue")
    return result


def finalize(job_id: str) -> ContractTx:
    """Settler closes a job; any unreleased balance stays withheld in the contract."""
    contract = _load_contract()
    result = _send("orchestrator", contract.functions.finalize(job_id_to_bytes32(job_id)))
    log("escrow-contract", f"finalize({job_id}) | tx {result.tx_hash} | block {result.block_number}", style="bold blue")
    return result


def refund(job_id: str) -> ContractTx:
    """Settler refunds a job's full remaining locked balance to the requester."""
    contract = _load_contract()
    result = _send("orchestrator", contract.functions.refund(job_id_to_bytes32(job_id)))
    log("escrow-contract", f"refund({job_id}) | tx {result.tx_hash} | block {result.block_number}", style="bold blue")
    return result


def get_job(job_id: str) -> dict:
    contract = _load_contract()
    requester, locked, released, status = contract.functions.getJob(job_id_to_bytes32(job_id)).call()
    return {
        "requester": requester,
        "locked_usdc": float(_w3.from_wei(locked, "ether")),
        "released_usdc": float(_w3.from_wei(released, "ether")),
        "status": ["none", "locked", "settled", "refunded"][status],
    }
