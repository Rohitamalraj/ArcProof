"""Compiles VeriFiEscrow.sol with solcx and writes the ABI + bytecode to
contracts/VeriFiEscrow.json for payments/escrow_contract.py to load.

Run standalone:
    python -m contracts.compile
"""
from __future__ import annotations
import json
import os

import solcx

CONTRACTS_DIR = os.path.dirname(os.path.abspath(__file__))
SOL_PATH = os.path.join(CONTRACTS_DIR, "VeriFiEscrow.sol")
ARTIFACT_PATH = os.path.join(CONTRACTS_DIR, "VeriFiEscrow.json")
SOLC_VERSION = "0.8.24"


def compile_contract() -> dict:
    if SOLC_VERSION not in [str(v) for v in solcx.get_installed_solc_versions()]:
        solcx.install_solc(SOLC_VERSION)

    with open(SOL_PATH) as f:
        source = f.read()

    compiled = solcx.compile_source(
        source,
        output_values=["abi", "bin"],
        solc_version=SOLC_VERSION,
    )
    contract_id, contract_interface = next(iter(compiled.items()))

    artifact = {
        "contract_name": "VeriFiEscrow",
        "abi": contract_interface["abi"],
        "bytecode": contract_interface["bin"],
    }
    with open(ARTIFACT_PATH, "w") as f:
        json.dump(artifact, f, indent=2)
    return artifact


if __name__ == "__main__":
    artifact = compile_contract()
    print(f"Compiled VeriFiEscrow -- {len(artifact['abi'])} ABI entries, "
          f"{len(artifact['bytecode'])} bytecode chars -> {ARTIFACT_PATH}")
