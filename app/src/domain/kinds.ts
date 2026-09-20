/**
 * Where the money went, by kind, for any set of rows.
 *
 * ── Why this is its own module ─────────────────────────────────────────────
 *
 * Two screens headed "Where it went" showed two different answers for the
 * same month. Insights filed every row's own cost (`costOf`), so bills,
 * subscriptions and the interest on a debt were all in it. The Dashboard read
 * `spendingAttribution`, which is the spending track's split, kept to the
 * workbook by the parity tests and silent on those three by design. On the
 * owner's ledger that is PHP 1,641.00 a month missing from one of the two
 * screens, and in a month whose largest outgoing is a bill the Dashboard left
 * the largest thing out entirely.
 *
 * Insights was fixed on its own in September 2026 and the Dashboard was not,
 * which is how one fix in one file becomes a disagreement. The split lives
 * here now and both screens call it, so there is one answer to the question
 * and only one place to change it. `agreement.test.ts` holds them to it.
 *
 * `spendingAttribution` in `totals.ts` stays exactly as it is: it answers a
 * different question (the spending track alone, the way the workbook counted
 * it) and the parity tests depend on that answer not moving.
 */

import type { Debt } from "./debt";
import type { Centavos } from "./money";
import { costOf } from "./totals";
import type { RankedAmount, Transaction } from "./types";

/**
 * The name a row's cost is filed under.
 *
 * One row, one name, chosen by what the row is rather than by what it is
 * called: money that left your accounts is Money Send whatever the item says,
 * a fee between your own accounts is a Transaction Fee, and what a lender
 * added is named after the lender so it cannot be confused with spending.
 */
export function kindOf(t: Transaction, debts: readonly Debt[] = []): string {
  if (t.type === "Transfer") return t.toWallet.trim() ? "Transaction Fee" : "Money Send";
  if (t.type === "Debt") {
    return `Interest and fees, ${debts.find((d) => d.id === t.debtId)?.name ?? "a debt"}`;
  }
  return t.item.trim() || (t.category === "Spending" ? "No item" : t.category);
}

/**
 * Every peso that left, filed once, largest first.
 *
 * The rows are taken as given: filter them to a day, a month or a year first.
 * Only what cost something is counted, so a repayment of principal, a
 * transfer with no fee and a row that brought money in are all absent, and
 * the total is exactly the `costOf` total for the same rows.
 */
export function costByKind(
  rows: readonly Transaction[],
  debts: readonly Debt[] = [],
): RankedAmount[] {
  const byKind = new Map<string, Centavos>();

  for (const t of rows) {
    const cost = costOf(t);
    if (cost <= 0) continue;
    const name = kindOf(t, debts);
    byKind.set(name, (byKind.get(name) ?? 0) + cost);
  }

  return [...byKind]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, amount]) => ({ name, amount }));
}
