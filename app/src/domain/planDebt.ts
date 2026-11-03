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
    };
  });
}
