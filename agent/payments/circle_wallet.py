"""Real Circle Developer-Controlled Wallets integration
(`circle-developer-controlled-wallets` SDK) -- creates real wallets via
Circle's own API on Arc testnet (blockchain id `ARC-TESTNET`, confirmed
supported by the SDK's EvmBlockchain enum -- Circle built Arc, so their
own wallets product targets it directly) and signs real transactions
through Circle's infrastructure instead of a raw eth_account private key.

One-time setup already completed for this project (see chat history, not
repeated by this module): `generate_entity_secret()` locally, then
`register_entity_secret_ciphertext(api_key, entity_secret)` to bind it to
CIRCLE_API_KEY. Both are semi-irreversible per-account actions, done once.

Scope: this wires the `requester` role's escrow-lock call through a real
Circle-managed wallet, proving genuine Circle Wallets usage end to end
(create wallet -> fund -> sign a real contract call -> independently
verify on-chain) -- see contracts/circle_setup.py for provisioning the
wallet set/wallet once. Every other role keeps its existing eth_account
wallet; both signing paths produce the same kind of artifact a verifier
cares about (a real mined Arc testnet tx hash), so chain.verify_transfer()
and escrow_contract.get_job() don't need to know or care which signer
produced a given transaction.
"""
from __future__ import annotations
import time
import uuid

import circle.web3.utils as circle_utils
import circle.web3.developer_controlled_wallets as dcw

from shared.config import CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, ARC_EXPLORER_URL
from shared.console import log

BLOCKCHAIN = "ARC-TESTNET"
_TERMINAL_OK = {"COMPLETE", "CONFIRMED"}
_TERMINAL_FAIL = {"FAILED", "CANCELLED", "DENIED"}


class CircleWalletError(Exception):
    pass


def _require_config() -> None:
    if not CIRCLE_API_KEY or not CIRCLE_ENTITY_SECRET:
        raise CircleWalletError("CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET not set in .env -- see contracts/circle_setup.py")


def _client():
    _require_config()
    return circle_utils.init_developer_controlled_wallets_client(api_key=CIRCLE_API_KEY, entity_secret=CIRCLE_ENTITY_SECRET)


def _ciphertext() -> str:
    # Circle requires a freshly-encrypted entity secret ciphertext on every
    # request rather than a reusable token -- generated locally each call;
    # the plaintext entity secret itself never leaves this process.
    return circle_utils.generate_entity_secret_ciphertext(api_key=CIRCLE_API_KEY, entity_secret_hex=CIRCLE_ENTITY_SECRET)


def create_wallet_set(name: str) -> str:
    api = dcw.WalletSetsApi(_client())
    req = dcw.CreateWalletSetRequest(name=name, entity_secret_ciphertext=_ciphertext(), idempotency_key=str(uuid.uuid4()))
    resp = api.create_wallet_set(req)
    wallet_set_id = resp.data.wallet_set.id
    log("circle", f"created wallet set '{name}' -> {wallet_set_id}", style="bold magenta")
    return wallet_set_id


def create_wallet(wallet_set_id: str) -> dict:
    api = dcw.WalletsApi(_client())
    req = dcw.CreateWalletRequest(
        wallet_set_id=wallet_set_id,
        blockchains=[BLOCKCHAIN],
        count=1,
        entity_secret_ciphertext=_ciphertext(),
        idempotency_key=str(uuid.uuid4()),
    )
    resp = api.create_wallet(req)
    wallet = resp.data.wallets[0]
    log("circle", f"created wallet {wallet.id} -> {wallet.address} on {BLOCKCHAIN}", style="bold magenta")
    return {"wallet_id": wallet.id, "address": wallet.address}


def get_balance_native(wallet_id: str) -> float:
    api = dcw.WalletsApi(_client())
    resp = api.list_wallet_balance(wallet_id)
    for tb in resp.data.token_balances or []:
        if tb.token.is_native:
            return float(tb.amount)
    return 0.0


def _wait_for_transaction(api, transaction_id: str, timeout: float = 90.0) -> str:
    deadline = time.time() + timeout
    last_state = None
    while time.time() < deadline:
        resp = api.get_transaction(id=transaction_id)
        txn = resp.data.transaction
        last_state = txn.state
        if txn.state in _TERMINAL_OK:
            return txn.tx_hash
        if txn.state in _TERMINAL_FAIL:
            raise CircleWalletError(f"Circle transaction {transaction_id} ended in state {txn.state}")
        time.sleep(2)
    raise TimeoutError(f"Circle transaction {transaction_id} did not settle within {timeout}s (last state: {last_state})")


def execute_contract(wallet_id: str, contract_address: str, abi_function_signature: str, abi_parameters: list, amount_native: float = 0.0) -> dict:
    """Calls a contract function through a Circle-managed wallet, waits for
    it to mine, and returns {tx_hash, explorer_url} -- same shape callers
    already use from payments/chain.py's OnChainTransfer."""
    api = dcw.TransactionsApi(_client())
    # Each parameter must be wrapped in the SDK's AbiParametersInner oneOf
    # type (str | int | bool | List[object]) -- a raw string/int fails
    # pydantic validation even though it looks like it should just work.
    wrapped_params = [dcw.AbiParametersInner(p) for p in abi_parameters]
    req = dcw.CreateContractExecutionTransactionForDeveloperRequest(
        wallet_id=wallet_id,
        contract_address=contract_address,
        abi_function_signature=abi_function_signature,
        abi_parameters=wrapped_params,
        amount=str(amount_native) if amount_native else None,
        fee_level=dcw.FeeLevel.MEDIUM,
        entity_secret_ciphertext=_ciphertext(),
        idempotency_key=str(uuid.uuid4()),
    )
    resp = api.create_developer_transaction_contract_execution(req)
    transaction_id = resp.data.id
    log("circle", f"submitted contract execution tx {transaction_id} (wallet {wallet_id} -> {contract_address})", style="bold magenta")
    tx_hash = _wait_for_transaction(api, transaction_id)
    log("circle", f"tx {transaction_id} settled on-chain: {tx_hash}", style="bold magenta")
    return {"tx_hash": tx_hash, "explorer_url": f"{ARC_EXPLORER_URL}/tx/{tx_hash}"}


def transfer(wallet_id: str, destination_address: str, amount_native: float) -> dict:
    """Simple native-value transfer through a Circle-managed wallet."""
    api = dcw.TransactionsApi(_client())
    req = dcw.CreateTransferTransactionForDeveloperRequest(
        wallet_id=wallet_id,
        destination_address=destination_address,
        amounts=[str(amount_native)],
        fee_level=dcw.FeeLevel.MEDIUM,
        entity_secret_ciphertext=_ciphertext(),
        idempotency_key=str(uuid.uuid4()),
    )
    resp = api.create_developer_transaction_transfer(req)
    transaction_id = resp.data.id
    log("circle", f"submitted transfer tx {transaction_id} (wallet {wallet_id} -> {destination_address})", style="bold magenta")
    tx_hash = _wait_for_transaction(api, transaction_id)
    log("circle", f"tx {transaction_id} settled on-chain: {tx_hash}", style="bold magenta")
    return {"tx_hash": tx_hash, "explorer_url": f"{ARC_EXPLORER_URL}/tx/{tx_hash}"}
