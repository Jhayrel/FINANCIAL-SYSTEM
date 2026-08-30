/**
 * Predicting the entry before it is typed.
 *
 * ── What the VBA did, and what was missing here ───────────────────────────
 *
 * Module8's `DoAutofill` ran eight rules in order, each one narrowing as the
 * form filled. Seven of them are already in `autofill.ts`. The one that was
 * not is rule 5a, and it was the best of them:
 *
 *     ' === RULE 5a: BILLS/SUBSCRIPTIONS PRIORITY (LEARNS DUE DATES) ===
 *
 * A bill due today outranks whatever you usually buy. If Globe was paid on the
 * 30th of every month for a year, then on the 30th the item is almost
 * certainly Globe, and proposing "Food" because food is more frequent overall
 * is confidently wrong. `billsDueNear` computed exactly this and nothing ever
 * called it.
 *
 * ── What is added beyond the VBA ──────────────────────────────────────────
 *
 * The amount. The VBA never predicted one, and for a recurring bill it is the
 * most predictable field on the form: the same figure, every month. It is
 * offered, never filled, because an amount that is silently almost right is
 * the one mistake in this app that quietly corrupts a balance.
 *
 * Every prediction carries the reason it was made. A suggestion you cannot
 * question is one you either accept blindly or distrust entirely, and both are
 * worse than a sentence saying where it came from.
 */

import { billsDueNear } from "./autofill";
import type { Draft } from "./entry";
import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface DueBill {
  readonly item: string;
  readonly category: "Bills" | "Subscriptions";
  /** What it came to last time, fee included. */
  readonly expected: Centavos;
  readonly dueDate: IsoDate;
  /** Negative when it is already late. */
  readonly daysAway: number;
  /** Where it is usually paid from. Empty when that has varied. */
  readonly wallet: string;
  readonly why: string;
}

/**
 * Bills and subscriptions worth logging right now.
 *
 * The window is wider behind than ahead: a bill three days late still needs
 * entering, whereas one due in a week is not yet a thing that happened.
 */
export function billsToLog(
  transactions: readonly Transaction[],
  asOf: IsoDate,
  windowDays = 4,
): DueBill[] {
  const due = billsDueNear(transactions, asOf, windowDays);
  const target = new Date(asOf).getTime();

  return due
    .map((d) => {
      const history = transactions.filter(
        (t) => t.type === "Spending" && t.item === d.item,
      );
      const last = history[history.length - 1];
      const daysAway = Math.round((new Date(d.dueDate).getTime() - target) / 86_400_000);

      return {
        item: d.item,
        category: (last?.category === "Subscriptions" ? "Subscriptions" : "Bills") as
          | "Bills"
          | "Subscriptions",
        expected: d.expected,
        dueDate: d.dueDate,
        daysAway,
        wallet: steadyValue(history.map((t) => t.fromWallet)),
        why: describeDue(daysAway),
      };
    })
    // Already paid this month is not due: the prediction is one month on from
    // the last payment, so a payment already logged moves it out of the window.
    .filter((d) => !paidSince(transactions, d.item, d.dueDate))
    .sort((a, b) => a.daysAway - b.daysAway);
}

function describeDue(daysAway: number): string {
  if (daysAway < -1) return `${Math.abs(daysAway)} days late, going by last month`;
  if (daysAway === -1) return "Due yesterday, going by last month";
  if (daysAway === 0) return "Due today, going by last month";
  if (daysAway === 1) return "Due tomorrow, going by last month";
  return `Due in ${daysAway} days, going by last month`;
}

function paidSince(
  transactions: readonly Transaction[],
  item: string,
  dueDate: IsoDate,
): boolean {
  // Anything logged within a fortnight before the predicted date is this
  // month's payment, arriving early.
  const from = new Date(dueDate);
  from.setDate(from.getDate() - 14);
  const cutoff = from.toISOString().slice(0, 10);

  return transactions.some(
    (t) => t.type === "Spending" && t.item === item && t.date >= cutoff,
  );
}

/**
 * A value only counts as learned when it is actually consistent.
 *
 * "Usually Maya" is useful. "Maya four times out of nine" is a coin toss
 * dressed up as a suggestion, so it returns nothing instead.
 */
function steadyValue(values: readonly string[], threshold = 0.6): string {
  const counts = new Map<string, number>();
  let total = 0;

  for (const v of values) {
    const key = v.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  if (total === 0) return "";

  let best = "";
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }

  return bestCount / total >= threshold ? best : "";
}

export interface AmountGuess {
  readonly amount: Centavos;
  readonly why: string;
}

/**
 * What this entry probably costs.
 *
 * Uses the most common recent total rather than an average, for the same
 * reason `predictFee` does: a bill is one of a few fixed figures, and the mean
 * of PHP 599 and PHP 799 is PHP 699, which has never been charged and never
 * will be.
 *
 * Returns nothing unless the item has been paid at least twice at the same
 * figure. One past payment is a fact, not a pattern.
 */
export function predictAmount(
  transactions: readonly Transaction[],
  draft: Draft,
): AmountGuess | null {
  const item = draft.item.trim();
  if (!draft.flow || !item) return null;

  const history = transactions
    .filter((t) => t.type === draft.flow && t.item === item && t.total > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12);

  if (history.length < 2) return null;

  const counts = new Map<Centavos, number>();
  for (const t of history) counts.set(t.total, (counts.get(t.total) ?? 0) + 1);

  let amount: Centavos = 0;
  let seen = 0;
  for (const [value, count] of counts) {
    if (count > seen) {
      amount = value;
      seen = count;
    }
  }

  if (seen < 2) {
    /**
     * Every past amount differed, so there is no repeated figure to offer.
     * The most recent one is still worth proposing for something like fares,
     * but it is labelled as the guess it is.
     */
    const last = history[0];
    return last ? { amount: last.total, why: `Last time it was this. The amount varies.` } : null;
  }

  return {
    amount,
    why: `${seen} of the last ${history.length} were this amount`,
  };
}

export interface Reason {
  readonly field: string;
  readonly why: string;
}

/**
 * Why each proposal was made, for the fields the form is filling in.
 *
 * Deliberately plain: these are shown next to the field, and "conditioned on
 * the antecedent category" is not a sentence that helps anyone.
 */
export function reasons(draft: Draft, transactions: readonly Transaction[]): Reason[] {
  const out: Reason[] = [];
  const sameFlow = transactions.filter((t) => t.type === draft.flow);
  if (sameFlow.length === 0) return out;

  const count = (predicate: (t: Transaction) => boolean): number =>
    sameFlow.filter(predicate).length;

  if (draft.item.trim()) {
    const n = count((t) => t.item === draft.item.trim());
    if (n > 0) out.push({ field: "item", why: `Entered ${n} time${n === 1 ? "" : "s"} before` });
  }

  if (draft.fromWallet && draft.item.trim()) {
    const n = count((t) => t.item === draft.item.trim() && t.fromWallet === draft.fromWallet);
    if (n > 0) {
      out.push({ field: "fromWallet", why: `Paid from here ${n} time${n === 1 ? "" : "s"}` });
    }
  }

  return out;
}
