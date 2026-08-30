/**
 * Wallet balances: SYSTEM-ANALYSIS rule 3.1.
 *
 * Ported from the Excel formula used in BACKEND!AB, SUMMARY!D13 and the
 * VBA balance check in Module1.AddOrUpdateRecord:
 *
 *   balance(w) = SUM(total)  WHERE type = 'Revenue' AND fromWallet = w
 *              + SUM(amount) WHERE toWallet = w
 *              - SUM(total)  WHERE fromWallet = w AND type <> 'Revenue'
 *
 * Two asymmetries are DELIBERATE. Do not "fix" them:
 *
 *  1. Revenue names its wallet in either `fromWallet` OR `toWallet`, the data
 *     uses both conventions across the 440 historical rows. The first two
 *     terms absorb both. A Revenue row naming the wallet in `fromWallet` is an
 *     inflow, not an outflow, which is why term 3 excludes Revenue.
 *
 *  2. Money IN uses `amount`; money OUT uses `total`. The transaction fee is
 *     therefore charged entirely to the source wallet, and the destination
 *     receives only the net amount. This is correct for real transfers.
 *
 * Verified against the workbook: Maya 5,795.74 / Cash 161.00 / Gcash 155.71 /
 * Maya Bank (Personal savings) 1,527.58.
 */

import { type Centavos } from "./money";
import type { Transaction, WalletBalance } from "./types";

/** Balance of a single wallet across the given transactions. */
export function walletBalance(
  transactions: readonly Transaction[],
  wallet: string,
): Centavos {
  if (!wallet) return 0;

  let balance = 0;
  for (const t of transactions) {
    // Term 1: Revenue booked against `fromWallet` is an inflow.
    if (t.type === "Revenue" && t.fromWallet === wallet) {
      balance += t.total;
    }
    // Term 2: anything arriving at this wallet, net of fee.
    if (t.toWallet === wallet) {
      balance += t.amount;
    }
    // Term 3: anything leaving this wallet, fee included.
    if (t.fromWallet === wallet && t.type !== "Revenue") {
      balance -= t.total;
    }
  }
  return balance;
}

/**
 * Balances for every wallet in one pass.
 *
 * Returns a map keyed by wallet name, including wallets that appear only in
 * history. Callers decide which to display; see `walletBalances` below.
 */
export function allWalletBalances(
  transactions: readonly Transaction[],
): Map<string, Centavos> {
  const balances = new Map<string, Centavos>();

  const bump = (name: string, delta: Centavos): void => {
    if (!name) return;
    balances.set(name, (balances.get(name) ?? 0) + delta);
  };

  for (const t of transactions) {
    if (t.type === "Revenue" && t.fromWallet) bump(t.fromWallet, t.total);
    if (t.toWallet) bump(t.toWallet, t.amount);
    if (t.fromWallet && t.type !== "Revenue") bump(t.fromWallet, -t.total);
  }

  return balances;
}

/**
 * Balances for a named list of wallets, in list order.
 *
 * Wallets with no transactions come back at zero rather than being dropped, so
 * a newly added wallet still shows on the dashboard.
 */
export function walletBalances(
  transactions: readonly Transaction[],
  wallets: readonly string[],
  savings: readonly string[] = [],
): WalletBalance[] {
  const computed = allWalletBalances(transactions);
  const savingsSet = new Set(savings);

  return wallets.map((name) => ({
    name,
    balance: computed.get(name) ?? 0,
    isSavings: savingsSet.has(name),
  }));
}

/**
 * Every wallet that has ever appeared, including retired ones.
 *
 * The ledger references wallets absent from the active CATEGORIES list
 * ("Hidden cash (fieldtrip)", "Maya Bank (Drone)", "Maya Bank (New Phone)").
 * Use this for audit views and for the migration's balance check; use
 * `walletBalances` for the dashboard.
 */
export function historicalWalletBalances(
  transactions: readonly Transaction[],
  savings: readonly string[] = [],
): WalletBalance[] {
  const savingsSet = new Set(savings);
  return [...allWalletBalances(transactions)]
    .map(([name, balance]) => ({ name, balance, isSavings: savingsSet.has(name) }))
    .sort((a, b) => b.balance - a.balance);
}

/** Combined balance of the active (non-savings) wallets. */
export function totalWalletBalance(
  transactions: readonly Transaction[],
  wallets: readonly string[],
): Centavos {
  const computed = allWalletBalances(transactions);
  let total = 0;
  for (const w of wallets) total += computed.get(w) ?? 0;
  return total;
}

/** Combined balance of the savings accounts. */
export function totalSavingsBalance(
  transactions: readonly Transaction[],
  savings: readonly string[],
): Centavos {
  return totalWalletBalance(transactions, savings);
}

/**
 * Balance a wallet would have after applying a prospective transaction.
 *
 * Powers the entry form's insufficient-balance and savings-withdrawal
 * warnings (Module1). When `excludeId` is supplied the existing version of
 * that transaction is ignored, so editing an entry compares against the
 * balance without it rather than double-counting.
 */
export function projectedBalance(
  transactions: readonly Transaction[],
  wallet: string,
  outgoing: Centavos,
  excludeId?: string,
): Centavos {
  const base = excludeId
    ? transactions.filter((t) => t.id !== excludeId)
    : transactions;
  return walletBalance(base, wallet) - outgoing;
}

/** Heuristic used by Module1 to decide whether to warn on withdrawal. */
export function isSavingsWallet(
  wallet: string,
  savings: readonly string[] = [],
): boolean {
  if (savings.includes(wallet)) return true;
  return wallet.toLowerCase().includes("saving");
}
