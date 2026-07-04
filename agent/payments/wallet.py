"""Real wallet operations for internal (role-to-role) transfers -- escrow
locking/releasing between roles this system already knows about
(requester, escrow, each specialist). Cross-boundary payments (orchestrator
paying a specialist over HTTP) go through payments/x402.py instead, since
those need a real address/tx-hash on the wire, not a local role name.

Every read here is a live RPC call to Arc testnet and every transfer is a
real mined transaction (payments/chain.py) -- there is no local balance
file and nothing to "reset" between runs; state lives on the chain.
"""
from __future__ import annotations

from shared.config import WALLETS
from payments.chain import get_balance_usdc, transfer as chain_transfer, OnChainTransfer
from shared.console import log


def _wallet(role: str) -> dict:
    w = WALLETS.get(role)
    if not w or not w.get("address"):
        raise ValueError(f"no wallet configured for role '{role}' -- check .env")
    return w


def role_address(role: str) -> str:
    return _wallet(role)["address"]


def balance(role: str) -> float:
    return get_balance_usdc(_wallet(role)["address"])


def all_balances() -> dict[str, float]:
    return {role: get_balance_usdc(w["address"]) for role, w in WALLETS.items() if w.get("address")}


def transfer(from_role: str, to_role: str, amount: float, memo: str = "") -> OnChainTransfer:
    from_wallet = _wallet(from_role)
    to_wallet = _wallet(to_role)
    if not from_wallet.get("private_key"):
        raise ValueError(f"no private key configured for role '{from_role}' -- check .env")
    return chain_transfer(from_wallet["private_key"], to_wallet["address"], amount, memo=memo)


def transfer_to_address(from_role: str, to_address: str, amount: float, memo: str = "") -> OnChainTransfer:
    """Same as transfer(), but for paying an arbitrary real address (e.g. a
    connected browser wallet) rather than another known role -- refunding a
    real requester wallet isn't a role-to-role move, so it can't go through
    `transfer()`'s role lookup on the recipient side."""
    from_wallet = _wallet(from_role)
    if not from_wallet.get("private_key"):
        raise ValueError(f"no private key configured for role '{from_role}' -- check .env")
    return chain_transfer(from_wallet["private_key"], to_address, amount, memo=memo)


def refund_or_hold(role: str, amount: float, memo: str = "") -> None:
    """Withheld funds simply stay put in the role's own wallet -- there's no
    separate 'hold' action on a real chain. Exists so settlement code reads
    the same regardless of outcome (see settlement/escrow.py)."""
    log("wallet", f"held {amount:.6f} USDC in {role} ({memo}) -- not released", style="grey62")


class _Ledger:
    """Thin object wrapper so existing call sites (`ledger.transfer(...)`)
    don't need to change shape, only semantics (role names, real chain)."""

    balance = staticmethod(balance)
    all_balances = staticmethod(all_balances)
    transfer = staticmethod(transfer)
    transfer_to_address = staticmethod(transfer_to_address)
    refund_or_hold = staticmethod(refund_or_hold)
    role_address = staticmethod(role_address)


ledger = _Ledger()
