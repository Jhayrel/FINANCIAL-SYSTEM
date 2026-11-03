/**
 * The loans and credit lines a plan can pay (P12; owner, 3 November 2026:
 * "what about if I want to pay a loan"), with what is owed on each and the
 * payment safe to spend already holds back for it.
 *
 * Safe to spend holds back a line's next payment when it falls due this
 * month (`monthPlan.ts`, `debtDue`). A plan to pay that line is then a
 * reminder of the day and amount meant, not a second hold: `checkPlan` says
 * so, and the form keeps "Count it in safe to spend" off for it.
 */
import { debtDue, positionsOf, type Debt } from "./debt";
import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface PlanDebtLine {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean | undefined;
  readonly owed: Centavos;
  /** The next payment safe to spend counts, when the line has a due day or a rhythm. */
  readonly scheduled: { readonly amount: Centavos; readonly on: IsoDate } | null;
  /** The day of the month its payments fall due, set in Settings; null when it has none. */
  readonly dueDay?: number | null | undefined;
}

/** Lines money is owed on, the On behalf ones aside (their own flow): loans and credit. */
export function planDebtLines(debts: readonly Debt[], transactions: readonly Transaction[], asOf: IsoDate): PlanDebtLine[] {
  return positionsOf(
    debts.filter((d) => d.kind === "payable" && d.form !== "pass-through"),
    transactions,
    asOf,
  ).map((p) => {
    const due = debtDue(p, transactions, asOf);
    return {
      id: p.debt.id,
      name: p.debt.name,
      archived: p.debt.archived,
      owed: Math.max(0, p.outstanding),
      scheduled: due.nextDue !== undefined && due.amountDue > 0 ? { amount: due.amountDue, on: due.nextDue } : null,
      dueDay: p.debt.dueDay && p.debt.dueDay >= 1 && p.debt.dueDay <= 31 ? p.debt.dueDay : null,
    };
  });
}

/**
 * A line's payment day in a month: the 31st is the month's last day in a
 * shorter one. For a line nothing is owed on yet, the plan's day.
 */
export function dueDayIn(month: IsoDate, dueDay: number): IsoDate {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month.slice(0, 7)}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
}
