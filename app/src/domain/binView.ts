/**
 * What is in the bin, and what bringing it back would do.
 *
 * A binned row counts toward nothing, so restoring one moves real balances.
 * The bin used to show each row's amount and nothing about its effect: bring
 * back an Allowance and a Transfer and it was left to you to work out that
 * Gcash goes up by one and down by the other. `restoreImpact` answers that
 * with the same balance rule the rest of the app uses (rule 3.1), so the
 * figure shown before restoring is the figure the wallet moves by after.
 */

import { walletBalance } from "./balances";
import type { Centavos } from "./money";
import type { Transaction, TransactionType } from "./types";

export interface TypeCount {
  readonly count: number;
  readonly total: Centavos;
}

export type BinCounts = Readonly<Record<TransactionType | "all", TypeCount>>;

export function binCounts(rows: readonly Transaction[]): BinCounts {
  const counts = {
    all: { count: 0, total: 0 },
    Revenue: { count: 0, total: 0 },
    Spending: { count: 0, total: 0 },
    Transfer: { count: 0, total: 0 },
    Debt: { count: 0, total: 0 },
  };
  for (const t of rows) {
    counts.all.count += 1;
    counts.all.total += t.total;
    const bucket = counts[t.type];
    if (bucket) {
      bucket.count += 1;
      bucket.total += t.total;
    }
  }
  return counts;
}

export interface WalletMove {
  readonly wallet: string;
  /** Positive when restoring adds to the wallet. */
  readonly change: Centavos;
}

/**
 * How much each wallet's balance moves if these rows come back.
 *
 * A balance is a sum over rows, so what a set of rows adds to a wallet is the
 * balance of that wallet over those rows alone. Wallets that net to nothing
 * are left out. Biggest movement first.
 */
export function restoreImpact(rows: readonly Transaction[]): WalletMove[] {
  const wallets = new Set<string>();
  for (const t of rows) {
    if (t.fromWallet) wallets.add(t.fromWallet);
    if (t.toWallet) wallets.add(t.toWallet);
  }
  return [...wallets]
    .map((wallet) => ({ wallet, change: walletBalance(rows, wallet) }))
    .filter((m) => m.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.wallet.localeCompare(b.wallet));
}
