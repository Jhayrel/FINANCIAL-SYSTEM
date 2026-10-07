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
import { costOf, inRange, spendingAttribution, UNCATEGORISED, writtenOffAsSpending } from "./totals";
import { transferBucket } from "./transfers";
import type { DateRange, RankedAmount, Transaction } from "./types";

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
    /*
     * Money advanced for someone and written off is spending on what it
     * bought, or, with no kind picked, money given away: Money Send, the name
     * money sent to someone already goes by (`entry.ts`, 3 October 2026).
     */
    if (writtenOffAsSpending(t)) return t.item.trim() || "Money Send";
    if (t.debtEffect === "interest" || t.debtEffect === "fee" || t.debtEffect === "charge") {
      return `Interest and fees, ${debts.find((d) => d.id === t.debtId)?.name ?? "a debt"}`;
    }
    // Only the fee to send a payment, or to pass money on, cost anything.
    return "Transaction Fee";
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

// ── The spending track, by kind: what a limit is held to ───────────────────

/**
 * The kind a row's spending-track cost is filed under, for a limit, or null
 * when the row costs the spending track nothing.
 *
 * The Budget screen's kinds, the note after saving and the Add form's limit
 * line read only spending rows and transfers. Food bought for someone and
 * written off counted as Food on the Dashboard and in the spending track,
 * and never against the Food limit, which said there was room left when
 * there was none (7 October 2026 limits audit). Bills and subscriptions are
 * not here: they have their own track and are followed one by one.
 */
export function limitKindOf(t: Transaction): string | null {
  if (t.type === "Spending") return t.category === "Spending" ? t.item.trim() || UNCATEGORISED : null;
  if (t.type === "Transfer") return transferBucket(t);
  if (t.type === "Debt") {
    if (writtenOffAsSpending(t) && t.category === "Spending") return t.item.trim() || "Money Send";
    if (t.fee > 0) return "Transaction Fee";
  }
  return null;
}

/**
 * The spending track split by kind, so the kinds add up to the track.
 *
 * `spendingAttribution` (the workbook's split, which the parity tests hold)
 * plus what it leaves out of the track: money written off for someone under
 * a kind of spending, the fee to send a debt payment, and what a lender
 * added, named after the lender. With these the Budget screen's "Where it
 * went" came PHP 500.00 short of the spending figure above it (October 2026,
 * a write-off with no kind, which is Money Send).
 */
export function spendingTrackByKind(
  transactions: readonly Transaction[],
  range?: DateRange,
  debts: readonly Debt[] = [],
): Map<string, Centavos> {
  const out = spendingAttribution(transactions, range);
  const add = (name: string, amount: Centavos): void => {
    if (amount !== 0) out.set(name, (out.get(name) ?? 0) + amount);
  };
  for (const t of inRange(transactions, range)) {
    if (t.type !== "Debt") continue;
    if (writtenOffAsSpending(t) && t.category === "Spending") add(t.item.trim() || "Money Send", t.amount);
    if (t.debtEffect === "interest" || t.debtEffect === "fee" || t.debtEffect === "charge") {
      add(`Interest and fees, ${debts.find((d) => d.id === t.debtId)?.name ?? "a debt"}`, t.amount);
    }
    if (t.fee > 0) add("Transaction Fee", t.fee);
  }
  return out;
}

/**
 * Whether a limit can count anything under this name. Bills and
 * subscriptions are not filed as kinds of spending: a limit on
 * "Subscriptions" read PHP 0.00 while Spotify was paid, because no spending
 * row is ever called that (7 October 2026 limits audit). They are budgeted
 * by their own track and followed one by one.
 */
export const limitable = (name: string): boolean =>
  !/^(?:bills?|subscriptions?|spending|revenue|income|transfer|debt|opening|paid|received|pending)$/i.test(name.trim());
