"""Deploys VeriFiEscrow to Arc testnet using the `escrow` role's wallet as
deployer/owner, with the `orchestrator` role's wallet set as the settler
(the only address allowed to release/finalize/refund a job -- matches who
already executes settlement/escrow.py's settle() today).

Writes the deployed address to contracts/deployed_address.txt so
payments/escrow_contract.py can pick it up without redeploying every run.

Run standalone:
    python -m contracts.deploy
"""
from __future__ import annotations
import json
import os

from web3 import Web3

from shared.config import ARC_RPC_URL, ARC_CHAIN_ID, WALLETS
from contracts.compile import compile_contract, ARTIFACT_PATH, CONTRACTS_DIR

DEPLOYED_ADDRESS_PATH = os.path.join(CONTRACTS_DIR, "deployed_address.txt")


def deploy() -> str:
    if os.path.exists(ARTIFACT_PATH):
        with open(ARTIFACT_PATH) as f:
            artifact = json.load(f)
    else:
        artifact = compile_contract()

    w3 = Web3(Web3.HTTPProvider(ARC_RPC_URL))
    deployer = WALLETS["escrow"]
    settler_address = WALLETS["orchestrator"]["address"]

    contract = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
    tx = contract.constructor(Web3.to_checksum_address(settler_address)).build_transaction({
        "from": Web3.to_checksum_address(deployer["address"]),
        "nonce": w3.eth.get_transaction_count(Web3.to_checksum_address(deployer["address"]), "pending"),
        "gas": 1_500_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": ARC_CHAIN_ID,
    })
    signed = w3.eth.account.sign_transaction(tx, deployer["private_key"])
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"deploy tx: {tx_hash.hex()} -- waiting for receipt...")
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=90)
    if receipt["status"] != 1:
        raise RuntimeError(f"deployment reverted: {tx_hash.hex()}")

    address = receipt["contractAddress"]
    print(f"VeriFiEscrow deployed at {address} (block {receipt['blockNumber']}, settler={settler_address})")

    with open(DEPLOYED_ADDRESS_PATH, "w") as f:
        f.write(address)
    return address


if __name__ == "__main__":
    deploy()
