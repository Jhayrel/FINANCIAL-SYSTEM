/**
 * Bills and subscriptions: spec rule 5.9, ported from VBA Module7/Module10.
 *
 * A recurring item was predicted exactly one month after it was last paid.
 * That is the Excel's rule, and it is wrong for anything that does not run on
 * calendar months: a bill that has landed every 28 days for a year was called
 * late for two days out of every four weeks, and one that comes round every 45
 * days was called late for a fortnight.
 *
 * The rhythm is read from the payments themselves now, the way
 * `allocation.ts` already reads the rhythm of ordinary spending. Where that
 * rhythm is a month, the calendar month is kept: a bill paid on the 31st is
 * due on the 31st, not 30 days later, which is how the biller counts it.
 *
 * Either way the next date is worked out from the most recent payment alone,
 * so a cycle genuinely skipped does not leave a backlog of missed dates: the
 * bill simply becomes due a rhythm after the payment that did happen.
 */

import { addDays, addMonths, daysBetween, daysInMonth, getDay, getMonth, getYear, today } from "./dates";
import type { Centavos } from "./money";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

/** Payments needed before a rhythm is read from them rather than assumed. */
const RHYTHM_FROM = 3;
/**
 * How far the day of the month may wander and still count as monthly.
 *
 * The test is the day of the month, not the length of the gap. A bill paid on
 * the 30th of each month averages a gap of about 30 days, and so does one paid
 * every 28 days, but the first belongs on the 30th and the second drifts
 * backwards through the calendar: June 7, July 5, August 2. Reading the gap
 * alone put the four-weekly one on the wrong date every month.
 */
const DAY_DRIFT = 2;
/** Gaps outside this range are not a billing rhythm at all. */
const SHORTEST = 5;
const LONGEST = 120;
/** How far gaps may sit from their own average and still count as a rhythm. */
const SPREAD = 0.25;

export interface BillStatus {
  readonly item: string;
  readonly category: "Bills" | "Subscriptions";
  /** Most recent payment, if there has ever been one. */
  readonly lastPaid?: IsoDate | undefined;
  readonly lastAmount: Centavos;
  /** When it is next expected, from the most recent payment. Undefined when never paid. */
  readonly nextDue?: IsoDate | undefined;
  /** How the date was worked out. */
  readonly rhythm: "monthly" | "days" | "never";
  /** The days between payments, when they are regular enough to read one. */
  readonly everyDays?: number | undefined;
  /** Negative when overdue. */
  readonly daysToDue?: number | undefined;
  /** Already paid within the month being viewed. */
  readonly paidThisMonth: boolean;
  readonly paidThisMonthAmount: Centavos;
  /** Typical amount across every payment seen. */
  readonly averageAmount: Centavos;
  readonly timesPaid: number;
}

/** The days between payments, when they are regular enough to call a rhythm. */
export function rhythmDays(dates: readonly IsoDate[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const gap = daysBetween(dates[i - 1] as IsoDate, dates[i] as IsoDate);
    // Two payments on one day are one payment split, not a cycle.
    if (gap > 0) gaps.push(gap);
  }
  if (dates.length < RHYTHM_FROM || gaps.length < 2) return null;

  const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (average < SHORTEST || average > LONGEST) return null;
  // Every gap has to agree with the average, or it is not a rhythm.
  if (gaps.some((g) => Math.abs(g - average) > average * SPREAD)) return null;

  return Math.round(average);
}

/**
 * Whether a bill keeps to a day of the month.
 *
 * A day past the end of a short month is clamped to its last day by whoever
 * charges it, so a run of 31, 28, 31 is still the 31st. The last days of each
 * month are treated as the same day for that reason.
 */
export function keepsDayOfMonth(dates: readonly IsoDate[]): boolean {
  if (dates.length < 2) return true;
  const days = dates.map((d) => {
    const day = getDay(d);
    const last = daysInMonth(getYear(d), getMonth(d));
    // Anything on the last two days of a short month reads as a late-month day.
    return day >= last - 1 ? 31 : day;
  });
  const highest = Math.max(...days);
  const lowest = Math.min(...days);
  return highest - lowest <= DAY_DRIFT;
}

/**
 * Status of every known bill and subscription.
 *
 * Driven by the reference lists rather than by whatever happens to be in the
 * ledger, so a bill you have declared but never paid still shows up, that is
 * usually the one worth knowing about.
 */
export function billStatuses(
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  asOf: IsoDate = today(),
): BillStatus[] {
  const year = getYear(asOf);
  const month = getMonth(asOf);

  interface Acc {
    category: "Bills" | "Subscriptions";
    payments: { date: IsoDate; amount: Centavos }[];
  }

  const acc = new Map<string, Acc>();
  const declare = (item: string, category: "Bills" | "Subscriptions"): void => {
    if (item && !acc.has(item)) acc.set(item, { category, payments: [] });
  };

  for (const b of reference.bills) declare(b, "Bills");
  for (const s of reference.subscriptions) declare(s, "Subscriptions");

  for (const t of transactions) {
    if (t.type !== "Spending") continue;
    if (t.category !== "Bills" && t.category !== "Subscriptions") continue;
    if (!t.item) continue;

    declare(t.item, t.category);
    acc.get(t.item)?.payments.push({ date: t.date, amount: t.total });
  }

  const out: BillStatus[] = [];

  for (const [item, { category, payments }] of acc) {
    payments.sort((a, b) => a.date.localeCompare(b.date));
    const last = payments.at(-1);

    const thisMonth = payments.filter(
      (p) => getYear(p.date) === year && getMonth(p.date) === month,
    );

    const dates = payments.map((p) => p.date);
    const every = rhythmDays(dates);
    const monthly = every === null || keepsDayOfMonth(dates);
    const nextDue = last ? (monthly ? addMonths(last.date, 1) : addDays(last.date, every)) : undefined;

    out.push({
      item,
      category,
      lastPaid: last?.date,
      lastAmount: last?.amount ?? 0,
      nextDue,
      rhythm: last ? (monthly ? "monthly" : "days") : "never",
      ...(every !== null ? { everyDays: every } : {}),
      daysToDue: nextDue ? daysBetween(asOf, nextDue) : undefined,
      paidThisMonth: thisMonth.length > 0,
      paidThisMonthAmount: thisMonth.reduce((a, p) => a + p.amount, 0),
      averageAmount:
        payments.length > 0
          ? Math.round(payments.reduce((a, p) => a + p.amount, 0) / payments.length)
          : 0,
      timesPaid: payments.length,
    });
  }

  // Soonest first; never-paid items sink to the bottom.
  return out.sort((a, b) => {
    if (a.daysToDue === undefined) return 1;
    if (b.daysToDue === undefined) return -1;
    return a.daysToDue - b.daysToDue;
  });
}

/** Bills already settled in the month being viewed. */
export const paidThisMonth = (statuses: readonly BillStatus[]): BillStatus[] =>
  statuses.filter((s) => s.paidThisMonth);

/** Still outstanding, soonest first. */
export const upcoming = (statuses: readonly BillStatus[], withinDays = 45): BillStatus[] =>
  statuses.filter(
    (s) => !s.paidThisMonth && s.daysToDue !== undefined && s.daysToDue <= withinDays,
  );

/** Overdue: predicted due date has passed and it has not been paid. */
export const overdue = (statuses: readonly BillStatus[]): BillStatus[] =>
  statuses.filter((s) => !s.paidThisMonth && s.daysToDue !== undefined && s.daysToDue < 0);

/** What the rest of this month's bills are expected to cost. */
export function outstandingBillTotal(statuses: readonly BillStatus[]): Centavos {
  return upcoming(statuses).reduce((a, s) => a + (s.lastAmount || s.averageAmount), 0);
}
