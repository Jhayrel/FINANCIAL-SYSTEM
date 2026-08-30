/**
 * Bills and subscriptions: spec rule 5.9, ported from VBA Module7/Module10.
 *
 * A recurring item is predicted one month after it was last paid. That is the
 * Excel's rule and it is deliberately simple: it needs no schedule to be
 * configured, and it self-corrects the moment a bill is actually paid.
 */

import { addMonths, daysBetween, getMonth, getYear, today } from "./dates";
import type { Centavos } from "./money";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export interface BillStatus {
  readonly item: string;
  readonly category: "Bills" | "Subscriptions";
  /** Most recent payment, if there has ever been one. */
  readonly lastPaid?: IsoDate | undefined;
  readonly lastAmount: Centavos;
  /** lastPaid + 1 month. Undefined when the bill has never been paid. */
  readonly nextDue?: IsoDate | undefined;
  /** Negative when overdue. */
  readonly daysToDue?: number | undefined;
  /** Already paid within the month being viewed. */
  readonly paidThisMonth: boolean;
  readonly paidThisMonthAmount: Centavos;
  /** Typical amount across every payment seen. */
  readonly averageAmount: Centavos;
  readonly timesPaid: number;
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

    const nextDue = last ? addMonths(last.date, 1) : undefined;

    out.push({
      item,
      category,
      lastPaid: last?.date,
      lastAmount: last?.amount ?? 0,
      nextDue,
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
