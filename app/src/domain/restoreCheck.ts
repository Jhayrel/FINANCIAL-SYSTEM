/**
 * What restoring a binned row would do, said before it is done.
 *
 * Found by pressing every button (2 November 2026): Restore puts a row back
 * in one tap. The owner's bin holds Maya Credit payments and interest that
 * were entered again properly; restoring one counts the payment twice and
 * takes Maya below zero, and nothing said so. A restore is never refused:
 * the row may be the right one. It is said, so the owner chooses knowing.
 */
import { walletBalance, walletDelta } from "./balances";
import { formatMedium } from "./dates";
import { formatMoney } from "./money";
import type { Transaction } from "./types";

const daysApart = (a: string, b: string): number => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** The notes for one row: an entry that looks like it already in the ledger, and an account it takes below zero. */
export function restoreCheck(row: Transaction, transactions: readonly Transaction[]): string[] {
  const out: string[] = [];
  const twin = transactions.find(
    (t) =>
      t.id !== row.id &&
      t.total === row.total &&
      t.type === row.type &&
      daysApart(t.date, row.date) <= 3 &&
      ((row.fromWallet !== "" && t.fromWallet === row.fromWallet) || (row.toWallet !== "" && t.toWallet === row.toWallet)) &&
      (row.debtId === undefined || t.debtId === row.debtId),
  );
  if (twin) {
    out.push(`#${String(twin.recordNumber).padStart(4, "0")} on ${formatMedium(twin.date)} is the same ${formatMoney(twin.total)}${twin.description.trim() ? ` ("${twin.description.trim().slice(0, 60)}")` : ""}: restoring may count it twice.`);
  }
  for (const wallet of [...new Set([row.fromWallet, row.toWallet].filter(Boolean))]) {
    const now = walletBalance(transactions, wallet);
    const after = now + walletDelta(row, (w) => w === wallet);
    if (after < 0 && after < now) out.push(`It takes ${wallet} from ${formatMoney(now)} to ${formatMoney(after)}.`);
  }
  return out;
}
