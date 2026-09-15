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
import { draftToTransactions, type Draft } from "./entry";
import type { Centavos } from "./money";
import { costOf, monthTotals, spendingAttribution, UNCATEGORISED } from "./totals";
import { transferBucket } from "./transfers";
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
}

/** The attribution bucket a row lands in, the name limits are keyed by. */
function kindOf(row: Transaction): string | null {
  if (row.type === "Spending" && row.category === "Spending") return row.item.trim() || UNCATEGORISED;
  if (row.type === "Transfer") return transferBucket(row) ?? null;
  return null;
}

/**
 * Null when the entry is not finished, or costs nothing: income, a transfer
 * between your own accounts with no fee, repaying a debt's principal.
 */
export function entryImpact(
  draft: Draft,
  transactions: readonly Transaction[],
  budgets: Budgets,
  asOf: IsoDate,
): EntryImpact | null {
  if (!draft.flow || draft.amount === null || draft.amount <= 0 || !draft.date) return null;

  const rows = draftToTransactions(draft, 0, draft.id ?? "draft-preview");
  const cost = rows.reduce((sum, r) => sum + costOf(r), 0);
  const main = rows[0];
  if (!main || cost <= 0) return null;

  const year = getYear(draft.date);
  const month = getMonth(draft.date);

  // Editing a saved row: measure against the month without it.
  const others = draft.id
    ? transactions.filter((t) => t.id !== draft.id && t.id !== `${draft.id}-interest`)
    : transactions;

  const assessment = assessMonth(monthTotals(others, year, month), budgetForMonth(budgets, year, month));
  const track =
    main.type === "Spending" && (main.category === "Bills" || main.category === "Subscriptions")
      ? "billsSubs"
      : "spending";
  const line = assessment[track];

  const kind = kindOf(main);
  const kindBefore = kind
    ? (spendingAttribution(others, { start: firstOfMonth(year, month), end: lastOfMonth(year, month) }).get(kind) ?? 0)
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
  };
}
