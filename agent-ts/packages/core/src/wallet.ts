/**
 * Real wallet operations for internal (role-to-role) transfers -- escrow
 * locking/releasing between roles this system already knows about
 * (requester, escrow, each specialist). Cross-boundary payments
 * (orchestrator paying a specialist over HTTP) go through x402.ts instead,
 * since those need a real address/tx-hash on the wire, not a local role
 * name. Ported from agent/payments/wallet.py.
 *
 * Every read here is a live RPC call to Arc testnet and every transfer is a
 * real mined transaction (chain.ts) -- there is no local balance file and
 * nothing to "reset" between runs; state lives on the chain.
 */
import { WALLETS, type Role } from "./config.js";
import { getBalanceUsdc, transfer as chainTransfer, type OnChainTransfer } from "./chain.js";

function wallet(role: Role) {
  const w = WALLETS[role];
  if (!w || !w.address) {
    throw new Error(`no wallet configured for role '${role}' -- check .env`);
  }
  return w;
}

export function roleAddress(role: Role): string {
  return wallet(role).address;
}

export async function balance(role: Role): Promise<number> {
  return getBalanceUsdc(wallet(role).address);
}

export async function allBalances(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    (Object.keys(WALLETS) as Role[])
      .filter((role) => WALLETS[role].address)
      .map(async (role) => [role, await getBalanceUsdc(WALLETS[role].address)] as const)
  );
  return Object.fromEntries(entries);
}

export async function transfer(
  fromRole: Role,
  toRole: Role,
  amount: number,
  memo = ""
): Promise<OnChainTransfer> {
  const fromWallet = wallet(fromRole);
  const toWallet = wallet(toRole);
  if (!fromWallet.privateKey) {
    throw new Error(`no private key configured for role '${fromRole}' -- check .env`);
  }
  return chainTransfer(fromWallet.privateKey, toWallet.address, amount, memo);
}

/**
 * Withheld funds simply stay put in the role's own wallet -- there's no
 * separate "hold" action on a real chain. Exists so settlement code reads
 * the same regardless of outcome (see settlement.ts).
 */
export function refundOrHold(role: Role, amount: number, memo = ""): void {
  console.log(`[wallet] held ${amount.toFixed(6)} USDC in ${role} (${memo}) -- not released`);
}

export const ledger = { balance, allBalances, transfer, refundOrHold, roleAddress };
