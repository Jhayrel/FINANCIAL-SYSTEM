/**
 * A day, or any run of days, read out.
 *
 * ── What it is for ─────────────────────────────────────────────────────────
 *
 * The Insights calendar showed a day's spending when a day was tapped, and
 * nothing else: not a range, not a day still ahead, not what came in. The
 * owner asked for all of it. A pick on the calendar is a start and an end, one
 * day or many, in the past, ahead, or both, and across months or years.
 *
 * For the days that have happened: what went out and came in, the spending
 * per day, the heaviest day, where it went, and every entry. For the days
 * still ahead: the bills, debt payments and regular spending expected on them.
 * The same definitions every other screen uses: `costOf` for what a row cost
 * (and so for where it went), `billStatuses` for when a bill is next
 * due, `debtDue` for a debt, `learnPatterns` for a habit.
 */

import { learnPatterns } from "./allocation";
import { billStatuses } from "./bills";
import { debtDue, positionsOf, type Debt } from "./debt";
import { addDays, addMonths, daysBetween, formatMedium, getDay, getMonth, getYear, monthName } from "./dates";
import type { Centavos } from "./money";
import { costByKind } from "./kinds";
import { costOf, incomeOf } from "./totals";
import type { IsoDate, RankedAmount, ReferenceLists, Transaction } from "./types";

export interface DayRange {
  readonly start: IsoDate;
  readonly end: IsoDate;
}

/** Two picked days as a range, whichever was picked first. */
export function rangeOf(a: IsoDate, b: IsoDate): DayRange {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/** "September 5, 2026", "September 1 to 15, 2026", "December 30, 2026 to January 2, 2027". */
export function describeRange({ start, end }: DayRange): string {
  if (start === end) return formatMedium(start);
  const sy = getYear(start);
  const ey = getYear(end);
  const sm = getMonth(start);
  const em = getMonth(end);
  if (sy === ey && sm === em) return `${monthName(sm)} ${getDay(start)} to ${getDay(end)}, ${sy}`;
  if (sy === ey) return `${monthName(sm)} ${getDay(start)} to ${monthName(em)} ${getDay(end)}, ${sy}`;
  return `${formatMedium(start)} to ${formatMedium(end)}`;
}

export interface ExpectedItem {
  readonly kind: "bill" | "debt" | "habit";
  readonly name: string;
  /** The first day it is expected in the range. */
  readonly on: IsoDate;
  /** The whole amount expected in the range: a habit's is every time it comes round. */
  readonly amount: Centavos;
  /** How many times in the range, for a habit or a bill across months. */
  readonly times: number;
  readonly category?: "Bills" | "Subscriptions" | undefined;
}

export interface RangeReport {
  readonly range: DayRange;
  readonly days: number;
  /** Days up to and including today. */
  readonly pastDays: number;
  readonly futureDays: number;
  /** What the range's entries cost, `costOf`. */
  readonly spent: Centavos;
  /** Income, starting balances left out. */
  readonly cameIn: Centavos;
  /** Spending per day over the days that have happened, rounded down. */
  readonly perDay: Centavos;
  readonly biggest: { readonly date: IsoDate; readonly amount: Centavos } | null;
  readonly kinds: readonly RankedAmount[];
  /** Every entry in the range, oldest first. */
  readonly rows: readonly Transaction[];
  /** Expected on the days still ahead, soonest first. */
  readonly expected: readonly ExpectedItem[];
  readonly expectedTotal: Centavos;
}

/** Enough to cover two years of monthly bills, and a bound on a daily habit. */
const MOST_TIMES = 400;

export function rangeReport(input: {
  readonly transactions: readonly Transaction[];
  readonly reference: ReferenceLists;
  readonly debts: readonly Debt[];
  readonly range: DayRange;
  readonly asOf: IsoDate;
}): RangeReport {
  const { transactions, reference, debts, asOf } = input;
  const { start, end } = rangeOf(input.range.start, input.range.end);

  const rows = transactions
    .filter((t) => t.date >= start && t.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.recordNumber - b.recordNumber);

  const days = daysBetween(start, end) + 1;
  const pastDays = start > asOf ? 0 : daysBetween(start, end <= asOf ? end : asOf) + 1;
  const futureDays = days - pastDays;

  let spent = 0;
  let cameIn = 0;
  const byDay = new Map<IsoDate, Centavos>();
  for (const t of rows) {
    const cost = costOf(t);
    if (cost > 0) {
      spent += cost;
      byDay.set(t.date, (byDay.get(t.date) ?? 0) + cost);
    }
    cameIn += incomeOf(t);
  }

  let biggest: RangeReport["biggest"] = null;
  for (const [date, amount] of byDay) {
    if (!biggest || amount > biggest.amount) biggest = { date, amount };
  }

  /*
   * Where every peso of `spent` went, largest first, adding up to it exactly.
   *
   * `domain/kinds.ts` does the filing, because the Dashboard asks the same
   * question about the same month and the two answers drifted apart once
   * already. The screen folds the smallest kinds into one line; nothing is
   * dropped here.
   */
  const kinds = costByKind(rows, debts);

  const expected: ExpectedItem[] = [];
  if (end > asOf) {
    const from = start > asOf ? start : addDays(asOf, 1);

    // Bills and subscriptions: one month after the last payment, then monthly.
    for (const bill of billStatuses(transactions, reference, asOf)) {
      if (!bill.nextDue || bill.timesPaid === 0) continue;
      let times = 0;
      let first: IsoDate | undefined;
      for (let k = 0; k < MOST_TIMES; k++) {
        const on = addMonths(bill.nextDue, k);
        if (on > end) break;
        if (on < from) continue;
        times += 1;
        first ??= on;
      }
      if (first) {
        expected.push({
          kind: "bill",
          name: bill.item,
          on: first,
          amount: (bill.lastAmount || bill.averageAmount) * times,
          times,
          category: bill.category,
        });
      }
    }

    // Debt payments: the next one, if it falls in the range.
    for (const p of positionsOf(debts.filter((d) => !d.archived), transactions, asOf)) {
      const due = debtDue(p, transactions, asOf);
      if (!due.nextDue || due.nextDue < from || due.nextDue > end || p.debt.kind !== "payable") continue;
      expected.push({ kind: "debt", name: p.debt.name, on: due.nextDue, amount: due.amountDue, times: 1 });
    }

    // Regular spending: as often as it has come round before.
    for (const habit of learnPatterns(transactions, asOf)) {
      if (!habit.isRecurring) continue;
      const gap = Math.max(1, Math.round(habit.averageGapDays));
      let times = 0;
      let first: IsoDate | undefined;
      for (let k = 1; k < MOST_TIMES; k++) {
        const on = addDays(habit.lastDate, gap * k);
        if (on > end) break;
        if (on < from) continue;
        times += 1;
        first ??= on;
      }
      if (first) {
        expected.push({ kind: "habit", name: habit.name, on: first, amount: habit.averageAmount * times, times });
      }
    }

    expected.sort((a, b) => a.on.localeCompare(b.on) || b.amount - a.amount);
  }

  return {
    range: { start, end },
    days,
    pastDays,
    futureDays,
    spent,
    cameIn,
    perDay: pastDays > 0 ? Math.floor(spent / pastDays) : 0,
    biggest,
    kinds,
    rows,
    expected,
    expectedTotal: expected.reduce((s, e) => s + e.amount, 0),
  };
}
