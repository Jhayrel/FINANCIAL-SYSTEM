/**
 * What an entry does to its month's budget, before it is saved.
 *
 * ── Why the Add form needs it ─────────────────────────────────────────────
 *
 * The form showed a wallet going from one balance to another and nothing
 * about the budget: ₱1,200.00 of food went in without a word that it took the
 * month's spending past its line, and the Budget screen said so only after.
 * The moment to know is while the amount is still in the field.
 *
 * Every figure comes from the same place the Budget screen reads: the cost of
 * a row is `costOf` (so a transfer to your own account costs its fee, and
 * repaying principal costs nothing), the track is rule 3.6's, and the kind of
 * spending is the attribution bucket the limits are keyed by.
 */

import { assessMonth, budgetForMonth } from "./budget";
import { monthLock, type MonthLock } from "./budgetLock";
import { categoryLimits } from "./budgetView";
import { firstOfMonth, getMonth, getYear, lastOfMonth } from "./dates";
import { outstandingOf, partOf, splitRepayment, withFeesPaid, type Debt } from "./debt";
import { draftToTransactions, type Draft } from "./entry";
import type { Centavos } from "./money";
import { costOf, monthTotals } from "./totals";
import { limitKindOf, spendingTrackByKind } from "./kinds";
import { borrowedMoney, lenderNames } from "./borrowed";
import type { Budgets, IsoDate, Transaction } from "./types";

export interface EntryImpact {
  readonly year: number;
  readonly month: number;
  /** What this entry adds to the month's spending. */
  readonly cost: Centavos;
  /** Rule 3.6's track it counts against. */
  readonly track: "spending" | "billsSubs";
  /** That track's budget for the month. 0 when none is set. */
  readonly budget: Centavos;
  /** That track's spending without this entry. */
  readonly spentBefore: Centavos;
  /** What would be left of the track after it. Negative when it goes over. */
  readonly leftAfter: Centavos;
  /** The kind of spending it is filed under, when it is one. */
  readonly kind: string | null;
  /** That kind's spending in the month without this entry. */
  readonly kindBefore: Centavos;
  /** That kind's limit for the month, or null for none. */
  readonly limit: Centavos | null;
  /** Whether the month still takes budget changes. Entries are never locked. */
  readonly lock: MonthLock;
  /**
   * A bill or subscription already paid in the same month: the latest such
   * payment. A second one is sometimes right (two months at once, a price
   * change) and often a payment entered twice, so it is said, never refused.
   */
  readonly paidAlready: { readonly date: IsoDate; readonly cost: Centavos } | null;
  /**
   * The part of it that would be paid with borrowed money, or money held for
   * someone, because the owner's own money in that account runs out first
   * (`borrowed.ts`). Null when their own money covers it.
   */
  readonly borrowed: { readonly amount: Centavos; readonly from: string; readonly held: boolean } | null;
}

/** The attribution bucket a row lands in, the name limits are keyed by. */
/** The kind a limit counts the row under: the spending track's own split (`kinds.ts`). */
const kindOf = limitKindOf;

/**
 * Null when the entry is not finished, or costs nothing: income, a transfer
 * between your own accounts with no fee, repaying a debt's principal.
 */
export function entryImpact(
  draft: Draft,
  transactions: readonly Transaction[],
  budgets: Budgets,
  asOf: IsoDate,
  /** Whose money is borrowed and which accounts are the owner's, to say before the save what would be borrowed. */
  context: { readonly debts?: readonly Debt[] | undefined; readonly accounts?: readonly string[] | undefined } = {},
): EntryImpact | null {
  if (!draft.flow || draft.amount === null || draft.amount <= 0 || !draft.date) return null;

  // Editing a saved row: measure against the month without it, a payment's interest row included.
  const edited = draft.id ? transactions.find((t) => t.id === draft.id) : undefined;
  const itsPart = edited ? partOf(edited, transactions) : undefined;
  const others = draft.id
    ? transactions.filter((t) => t.id !== draft.id && t.id !== itsPart?.id)
    : transactions;

  /*
   * A debt payment's interest is spending, and the budget should hear about
   * it before the save. Built without the split, the payment was one
   * repayment row that cost nothing, so ₱120.00 of interest went into the
   * month's spending without a word here.
   */
  // Interest and fees already owed, typed beside what was borrowed, are one payment and cost nothing new (`withFeesPaid`).
  const paid = withFeesPaid(draft, transactions);
  const split =
    paid.flow === "Debt" && paid.debtEffect === "repay" && paid.debtId && paid.amount !== null
      ? splitRepayment(paid.amount, outstandingOf(others, paid.debtId), paid.interest)
      : undefined;
  const rows = draftToTransactions(paid, 0, draft.id ?? "draft-preview", split);
  const cost = rows.reduce((sum, r) => sum + costOf(r), 0);
  const main = rows.find((r) => costOf(r) > 0) ?? rows[0];
  if (!main || cost <= 0) return null;

  const year = getYear(draft.date);
  const month = getMonth(draft.date);

  const assessment = assessMonth(monthTotals(others, year, month), budgetForMonth(budgets, year, month));
  const track =
    main.type === "Spending" && (main.category === "Bills" || main.category === "Subscriptions")
      ? "billsSubs"
      : "spending";
  const line = assessment[track];

  const kind = kindOf(main);
  const kindBefore = kind
    ? (spendingTrackByKind(others, { start: firstOfMonth(year, month), end: lastOfMonth(year, month) }).get(kind) ?? 0)
    : 0;

  const sameBill = (t: Transaction): boolean =>
    t.type === "Spending" &&
    t.category === main.category &&
    t.item.trim().toLowerCase() === main.item.trim().toLowerCase() &&
    getYear(t.date) === year &&
    getMonth(t.date) === month;
  const earlier =
    track === "billsSubs" && main.item.trim()
      ? others.filter(sameBill).reduce<Transaction | null>((latest, t) => (!latest || t.date > latest.date ? t : latest), null)
      : null;

  return {
    year,
    month,
    cost,
    track,
    budget: line.budget,
    spentBefore: line.spent,
    leftAfter: line.budget - line.spent - cost,
    kind,
    kindBefore,
    limit: kind ? (categoryLimits(budgets[String(year)], month).get(kind) ?? null) : null,
    lock: monthLock(year, month, asOf),
    paidAlready: earlier ? { date: earlier.date, cost: costOf(earlier) } : null,
    borrowed: (() => {
      const debts = context.debts ?? [];
      if (debts.length === 0 || !context.accounts?.length) return null;
      const b = borrowedMoney([...others, ...rows], debts, context.accounts);
      let lent = 0;
      let held = 0;
      const from = new Map<string, Centavos>();
      for (const r of rows) {
        const l = b.spent.get(r.id);
        const h = b.spentHeld.get(r.id);
        lent += l?.amount ?? 0;
        held += h?.amount ?? 0;
        for (const [id, v] of [...(l?.from ?? []), ...(h?.from ?? [])]) from.set(id, (from.get(id) ?? 0) + v);
      }
      return lent + held > 0 ? { amount: lent + held, from: lenderNames(from, debts), held: lent === 0 } : null;
    })(),
  };
}
