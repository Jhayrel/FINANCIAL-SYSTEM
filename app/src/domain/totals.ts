/**
 * Totals and rankings: SYSTEM-ANALYSIS rules 3.2 to 3.5.
 *
 * These port a set of Excel formulas that are subtly inconsistent with one
 * another. That inconsistency is faithfully preserved, because each figure is
 * checked against the workbook's own displayed value:
 *
 *   - Monthly fees      require type='Transfer' AND item='Transaction Fee',
 *                       with NO category condition.
 *   - Annual "Money Send" uses `total` on type='Transfer' rows only, because
 *                       Spending-type Money Send rows are already counted by
 *                       the first term.
 *   - Ranked "Money Send" uses `amount` on category='Spending' rows, a
 *                       different set and a different column. 17,061.00 vs
 *                       4,100.00; both are correct for their own context.
 *
 * If you are tempted to unify them, read the parity tests first.
 */

import type { Centavos } from "./money";
import { getMonth, getYear, isWithin } from "./dates";
import { leftYourAccounts, transferBucket, transferCost } from "./transfers";
import type {
  DateRange,
  IsoDate,
  MonthTotals,
  RankedAmount,
  SpendingType,
  Transaction,
} from "./types";

const eq = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Restrict to an inclusive date window. `undefined` means all time. */
export function inRange(
  transactions: readonly Transaction[],
  range?: DateRange,
): readonly Transaction[] {
  if (!range) return transactions;
  return transactions.filter((t) => isWithin(t.date, range.start, range.end));
}

export function inMonth(
  transactions: readonly Transaction[],
  year: number,
  month: number,
): Transaction[] {
  return transactions.filter(
    (t) => getYear(t.date) === year && getMonth(t.date) === month,
  );
}

// ── Rule 3.2, the month's spend, split the way INSIGHTS splits it ─────────

/**
 * Totals for a set of transactions (already filtered to the period).
 *
 * Verified: August 2026 gives 6,943.58 + 3,886.79 + 443.00 + 18.00 =
 * 11,291.37, matching INSIGHTS!I16.
 */
export function totalsFor(transactions: readonly Transaction[]): MonthTotals {
  let spending = 0;
  let bills = 0;
  let subscriptions = 0;
  let fees = 0;
  let interest = 0;
  let revenue = 0;

  for (const t of transactions) {
    if (t.type === "Spending") {
      if (t.category === "Spending") spending += t.total;
      else if (t.category === "Bills") bills += t.total;
      else if (t.category === "Subscriptions") subscriptions += t.total;
    } else if (t.type === "Revenue" && t.category !== "Opening") {
      /**
       * An Opening row is money you already had on the day you started
       * counting. It credits the wallet, because rule 3.1 credits any
       * destination, but it is not income and must never reach this line.
       * The Excel had no such category and booked PHP 953.89 of carried
       * balance as 2026 earnings. See `domain/opening.ts`.
       */
      revenue += t.total;
    }

    /**
     * Derived, not typed. A transfer to a blank destination left your accounts
     * and is spending; a transfer to one of your own accounts is not, and only
     * its fee costs anything. See `domain/transfers.ts`.
     *
     * The Excel asked you to pick "Money Send" or "Transaction Fee" by hand and
     * lost the money whenever you did not. It also never added Money Send to
     * this monthly split at all, so the ranking and the month total disagreed
     * by PHP 4,100.00 across 2026.
     */
    if (t.type === "Transfer") {
      if (leftYourAccounts(t)) spending += transferCost(t);
      else fees += transferCost(t);
    }

    /**
     * Debt interest and fees are genuine expense (rule 5.2); repaying
     * principal is not. Without this the month total drops by exactly the
     * interest whenever a repayment is split.
     */
    if (t.type === "Debt" && (t.debtEffect === "interest" || t.debtEffect === "fee")) {
      interest += t.total;
    }
  }

  return {
    spending,
    bills,
    subscriptions,
    fees,
    interest,
    total: spending + bills + subscriptions + fees + interest,
    revenue,
  };
}

export function monthTotals(
  transactions: readonly Transaction[],
  year: number,
  month: number,
): MonthTotals {
  return totalsFor(inMonth(transactions, year, month));
}

export function rangeTotals(
  transactions: readonly Transaction[],
  start: IsoDate,
  end: IsoDate,
): MonthTotals {
  return totalsFor(inRange(transactions, { start, end }));
}

/** Totals for all twelve months of a year, index 0 = January. */
export function monthlyTotalsForYear(
  transactions: readonly Transaction[],
  year: number,
): MonthTotals[] {
  const buckets: Transaction[][] = Array.from({ length: 12 }, () => []);
  for (const t of transactions) {
    if (getYear(t.date) === year) {
      const m = getMonth(t.date) - 1;
      buckets[m]?.push(t);
    }
  }
  return buckets.map((b) => totalsFor(b));
}

// ── Rule 3.3, annual spending (SUMMARY!D4) ────────────────────────────────

/**
 * The workbook's headline spending figure.
 *
 * Verified: 217,701.14 + 443.00 + 4,100.00 = 222,244.14, matching SUMMARY!D4.
 */
export function totalSpending(
  transactions: readonly Transaction[],
  range?: DateRange,
): Centavos {
  let total = 0;
  for (const t of inRange(transactions, range)) {
    if (t.type === "Spending" && t.category === "Spending") {
      total += t.total;
    } else if (t.type === "Transfer") {
      total += transferCost(t);
    }
  }
  return total;
}

/**
 * Total revenue (SUMMARY!D5).
 *
 * Requires type='Revenue' AND category='Revenue', and sums `amount` rather
 * than `total`. Verified: 245,715.96.
 */
export function totalRevenue(
  transactions: readonly Transaction[],
  range?: DateRange,
): Centavos {
  let total = 0;
  for (const t of inRange(transactions, range)) {
    if (t.type === "Revenue" && t.category === "Revenue") total += t.amount;
  }
  return total;
}

/** Subscriptions paid (SUMMARY!D6). Verified: 3,743.00. */
export function totalSubscriptions(
  transactions: readonly Transaction[],
  range?: DateRange,
): Centavos {
  let total = 0;
  for (const t of inRange(transactions, range)) {
    if (t.type === "Spending" && t.category === "Subscriptions") total += t.total;
  }
  return total;
}

/** Bills paid (SUMMARY!D7). Verified: 12,073.79. */
export function totalBills(
  transactions: readonly Transaction[],
  range?: DateRange,
): Centavos {
  let total = 0;
  for (const t of inRange(transactions, range)) {
    if (t.type === "Spending" && t.category === "Bills") total += t.total;
  }
  return total;
}

// ── Rule 3.4, spending ranking ────────────────────────────────────────────

/** The bucket used for spending rows that carry no item. */
export const UNCATEGORISED = "Uncategorised";

/**
 * Attribute every peso of `totalSpending` to exactly one bucket.
 *
 * The workbook encoded three mutually inconsistent fee definitions
 * (₱513 / ₱443 / ₱428) and a Money Send rule that silently dropped a ₱10 fee,
 * so its ranking cells did not sum to its own headline figure. Rather than
 * reproduce all three, this attributes each row exactly once:
 *
 *   Spending + category Spending  -> `total`, to the row's item
 *   Transfer  + Transaction Fee   -> `fee`,   to "Transaction Fee"
 *   Transfer  + Money Send        -> `total`, to "Money Send"
 *
 * The buckets therefore sum to `totalSpending` by construction, a property
 * the parity tests assert, and one the Excel never had.
 *
 * Two knock-on differences from the workbook's displayed cells, both traced
 * to source data rather than to this rule (see SYSTEM-ANALYSIS 3.5.1):
 *
 *   Transaction Fee  we include record #280, a ₱4,000 "Send to PNB used in
 *                    grocery" mis-filed under item "Transaction Fee". The
 *                    integrity check flags it; correcting the row to
 *                    "Money Send" brings this in line.
 *   Money Send       includes record #429's ₱10 fee, which the workbook's
 *                    `amount`-only rule dropped.
 */
export function spendingAttribution(
  transactions: readonly Transaction[],
  range?: DateRange,
): Map<string, Centavos> {
  const buckets = new Map<string, Centavos>();

  const attribute = (name: string, amount: Centavos): void => {
    if (amount === 0) return;
    const key = name.trim() || UNCATEGORISED;
    buckets.set(key, (buckets.get(key) ?? 0) + amount);
  };

  for (const t of inRange(transactions, range)) {
    if (t.type === "Spending" && t.category === "Spending") {
      attribute(t.item, t.total);
    } else if (t.type === "Transfer") {
      const bucket = transferBucket(t);
      if (bucket) attribute(bucket, transferCost(t));
    }
  }

  return buckets;
}

/** Total attributed to one spending type. */
export function spendingTypeTotal(
  transactions: readonly Transaction[],
  typeName: string,
  range?: DateRange,
): Centavos {
  const buckets = spendingAttribution(transactions, range);
  for (const [name, amount] of buckets) {
    if (eq(name, typeName)) return amount;
  }
  return 0;
}

/**
 * Spending ranked highest first.
 *
 * Restricted to the user's declared spending types, plus any bucket holding
 * real money that is not on that list. Ranking raw ledger items instead would
 * let revenue items dominate: "Framelink" (151,566.80) and "Allowance"
 * (74,815.83) both outrank every genuine expense.
 */
export function spendingRanking(
  transactions: readonly Transaction[],
  spendingTypes: readonly (SpendingType | string)[],
  range?: DateRange,
  options: { includeZero?: boolean; includeUnlisted?: boolean } = {},
): RankedAmount[] {
  const { includeZero = false, includeUnlisted = false } = options;
  const names = spendingTypes.map((s) => (typeof s === "string" ? s : s.name));
  const buckets = spendingAttribution(transactions, range);

  const declared = names.map((name) => {
    let amount = 0;
    for (const [bucket, value] of buckets) {
      if (eq(bucket, name)) {
        amount = value;
        break;
      }
    }
    return { name, amount };
  });

  const rows = [...declared];

  if (includeUnlisted) {
    for (const [bucket, amount] of buckets) {
      if (!names.some((n) => eq(n, bucket))) rows.push({ name: bucket, amount });
    }
  }

  return rows
    .filter((r) => includeZero || r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

// ── Rule 3.5, wallet usage ────────────────────────────────────────────────

/**
 * "Most used wallet": rule 3.3's definition, grouped by source wallet.
 *
 * Verified: Cash 160,493.00 and Maya 46,125.43 match exactly. Gcash comes to
 * 15,625.71 against the workbook's 15,610.71; the 15.00 gap is record #190,
 * one of the two mis-categorised transfer fees documented in
 * SYSTEM-ANALYSIS 3.5.1: a data defect, not a rule difference.
 */
export function walletUsage(
  transactions: readonly Transaction[],
  range?: DateRange,
): RankedAmount[] {
  const usage = new Map<string, Centavos>();

  const bump = (wallet: string, amount: Centavos): void => {
    if (!wallet || amount === 0) return;
    usage.set(wallet, (usage.get(wallet) ?? 0) + amount);
  };

  for (const t of inRange(transactions, range)) {
    if (t.type === "Spending" && t.category === "Spending") {
      bump(t.fromWallet, t.total);
    } else if (t.type === "Transfer") {
      bump(t.fromWallet, transferCost(t));
    }
  }

  return [...usage]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// ── Supporting breakdowns ──────────────────────────────────────────────────

/** Bills or subscriptions in the period, ranked. Drives the INSIGHTS tables. */
export function expenseRanking(
  transactions: readonly Transaction[],
  category: "Bills" | "Subscriptions",
  range?: DateRange,
): RankedAmount[] {
  const totals = new Map<string, Centavos>();

  for (const t of inRange(transactions, range)) {
    if (t.type === "Spending" && t.category === category && t.item) {
      totals.set(t.item, (totals.get(t.item) ?? 0) + t.total);
    }
  }

  return [...totals]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Revenue in the period grouped by source item, ranked. */
export function revenueRanking(
  transactions: readonly Transaction[],
  range?: DateRange,
): RankedAmount[] {
  const totals = new Map<string, Centavos>();

  for (const t of inRange(transactions, range)) {
    if (t.type === "Revenue" && t.item) {
      totals.set(t.item, (totals.get(t.item) ?? 0) + t.amount);
    }
  }

  return [...totals]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Spend per day of a month, index 0 = the 1st. Powers the calendar heat map. */
export function dailySpending(
  transactions: readonly Transaction[],
  year: number,
  month: number,
  daysInThisMonth: number,
): Centavos[] {
  const days = new Array<Centavos>(daysInThisMonth).fill(0);

  for (const t of inMonth(transactions, year, month)) {
    const idx = Number(t.date.slice(8, 10)) - 1;
    if (idx < 0 || idx >= daysInThisMonth) continue;

    let amount = 0;
    if (t.type === "Spending") {
      amount = t.total;
    } else if (t.type === "Transfer") {
      amount = transferCost(t);
    }

    if (amount !== 0) days[idx] = (days[idx] ?? 0) + amount;
  }

  return days;
}

/** Revenue per day of a month, index 0 = the 1st. */
export function dailyRevenue(
  transactions: readonly Transaction[],
  year: number,
  month: number,
  daysInThisMonth: number,
): Centavos[] {
  const days = new Array<Centavos>(daysInThisMonth).fill(0);

  for (const t of inMonth(transactions, year, month)) {
    if (t.type !== "Revenue") continue;
    const idx = Number(t.date.slice(8, 10)) - 1;
    if (idx >= 0 && idx < daysInThisMonth) days[idx] = (days[idx] ?? 0) + t.total;
  }

  return days;
}

/** Net cash flow rows for a year: the BUDGETING sheet's bottom table. */
export interface CashFlowYear {
  readonly revenue: Centavos[];
  readonly expense: Centavos[];
  readonly transfer: Centavos[];
}

export function cashFlowForYear(
  transactions: readonly Transaction[],
  year: number,
): CashFlowYear {
  const revenue = new Array<Centavos>(12).fill(0);
  const transfer = new Array<Centavos>(12).fill(0);

  for (const t of transactions) {
    if (getYear(t.date) !== year) continue;
    const m = getMonth(t.date) - 1;

    if (t.type === "Revenue") revenue[m] = (revenue[m] ?? 0) + t.total;
    else if (t.type === "Transfer") transfer[m] = (transfer[m] ?? 0) + t.amount;
  }

  /**
   * Expense is the full month total: spending + bills + subscriptions +
   * transfer fees: not just `type='Spending'` rows. Counting only Spending
   * rows undercounts January by ₱30.00 against the workbook's own row.
   */
  const expense = monthlyTotalsForYear(transactions, year).map((m) => m.total);

  return { revenue, expense, transfer };
}
