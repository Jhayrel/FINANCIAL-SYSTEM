/**
 * Forecast: spec rule 5.8, ported from VBA Module4.
 *
 * Spending, in priority order:
 *   1. the same month last year × 1.03
 *   2. the mean of the last 3 months × 1.03
 *   3. the overall mean × 1.03
 *
 * Bills use the most recent non-zero month and are never forecast below it,
 * bills do not tend to fall.
 *
 * NEW beyond the Excel: scheduled debt repayments are added as a known,
 * non-estimated line, so a month with a repayment due does not look cheap.
 */

import type { Centavos } from "./money";
import type { Debt } from "./debt";
import { outstandingOf } from "./debt";
import { getMonth, getYear } from "./dates";
import { monthlyTotalsForYear } from "./totals";
import type { Transaction } from "./types";

/** The 3% buffer the Excel applies to every estimate. */
const GROWTH = 1.03;

export type ForecastBasis =
  | "actual"
  | "same-month-last-year"
  | "recent-average"
  | "overall-average"
  | "none";

export interface MonthForecast {
  readonly month: number;
  readonly spending: Centavos;
  readonly billsSubs: Centavos;
  /** Known debt repayments: not an estimate. */
  readonly debtService: Centavos;
  readonly total: Centavos;
  readonly basis: ForecastBasis;
  /** True once the month has actually happened. */
  readonly isActual: boolean;
}

function mean(values: readonly Centavos[]): Centavos {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Twelve months of forecast for a year.
 *
 * Months that have already happened report their actual figures; the rest are
 * estimated. `asOfMonth` is injected rather than read from the clock so the
 * output is deterministic in tests.
 */
export function forecastYear(
  transactions: readonly Transaction[],
  year: number,
  asOfMonth: number,
  debts: readonly Debt[] = [],
): MonthForecast[] {
  const thisYear = monthlyTotalsForYear(transactions, year);
  const lastYear = monthlyTotalsForYear(transactions, year - 1);

  // Only months with real activity inform an estimate.
  const spendHistory = thisYear
    .slice(0, asOfMonth)
    .map((m) => m.spending + m.fees + m.interest)
    .filter((v) => v > 0);

  const billsHistory = thisYear
    .slice(0, asOfMonth)
    .map((m) => m.bills + m.subscriptions)
    .filter((v) => v > 0);

  const lastNonZeroBills = [...billsHistory].pop() ?? 0;

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const actual = thisYear[i];

    if (month <= asOfMonth && actual) {
      return {
        month,
        spending: actual.spending + actual.fees + actual.interest,
        billsSubs: actual.bills + actual.subscriptions,
        debtService: 0,
        total: actual.total,
        basis: "actual" as const,
        isActual: true,
      };
    }

    // ── Spending, in the documented priority order ────────────────────────
    let spending = 0;
    let basis: ForecastBasis = "none";

    const sameMonthLastYear = lastYear[i];
    const lastYearValue = sameMonthLastYear
      ? sameMonthLastYear.spending + sameMonthLastYear.fees + sameMonthLastYear.interest
      : 0;

    if (lastYearValue > 0) {
      spending = Math.round(lastYearValue * GROWTH);
      basis = "same-month-last-year";
    } else if (spendHistory.length >= 3) {
      spending = Math.round(mean(spendHistory.slice(-3)) * GROWTH);
      basis = "recent-average";
    } else if (spendHistory.length > 0) {
      spending = Math.round(mean(spendHistory) * GROWTH);
      basis = "overall-average";
    }

    // ── Bills: the most recent non-zero month, and never below it ─────────
    const billsSubs = Math.max(lastNonZeroBills, mean(billsHistory));

    /**
     * Debt service is known, not estimated: whatever is still outstanding is
     * expected back. Only projected into the first forecast month so it is
     * not double-counted across the rest of the year.
     */
    const debtService =
      month === asOfMonth + 1
        ? debts.reduce((a, d) => a + Math.max(0, outstandingOf(transactions, d.id)), 0)
        : 0;

    return {
      month,
      spending,
      billsSubs,
      debtService,
      total: spending + billsSubs + debtService,
      basis,
      isActual: false,
    };
  });
}

/** Human-readable explanation of where a forecast came from. */
export function explainBasis(basis: ForecastBasis): string {
  switch (basis) {
    case "actual":
      return "Actual: this month has happened";
    case "same-month-last-year":
      return "Same month last year, plus 3%";
    case "recent-average":
      return "Average of the last 3 months, plus 3%";
    case "overall-average":
      return "Average of every month so far, plus 3%";
    default:
      return "Not enough history to forecast";
  }
}

// ── Net cash flow, the BUDGETING sheet's bottom table ─────────────────────

export interface CashFlowRow {
  readonly month: number;
  readonly revenue: Centavos;
  readonly expense: Centavos;
  readonly transfer: Centavos;
  /** revenue − expense */
  readonly net: Centavos;
}

export function cashFlow(
  transactions: readonly Transaction[],
  year: number,
): CashFlowRow[] {
  const totals = monthlyTotalsForYear(transactions, year);

  const transfers = new Array<Centavos>(12).fill(0);
  for (const t of transactions) {
    if (t.type !== "Transfer" || getYear(t.date) !== year) continue;
    const i = getMonth(t.date) - 1;
    transfers[i] = (transfers[i] ?? 0) + t.amount;
  }

  return totals.map((m, i) => ({
    month: i + 1,
    revenue: m.revenue,
    expense: m.total,
    transfer: transfers[i] ?? 0,
    net: m.revenue - m.total,
  }));
}
