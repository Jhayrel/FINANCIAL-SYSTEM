/**
 * Budgets: SYSTEM-ANALYSIS rule 3.6.
 *
 * The Excel keeps two independent tracks per month, Spending and
 * Bills & Subscriptions, each judged separately. A month can be within budget
 * on one and over on the other; the workbook shows both verdicts side by side
 * rather than collapsing them.
 */

import type { Centavos } from "./money";
import { daysInMonth, daysLeftInMonth, getMonth, getYear, today } from "./dates";
import { monthTotals } from "./totals";
import type {
  BudgetAssessment,
  BudgetTrack,
  BudgetYear,
  Budgets,
  IsoDate,
  MonthTotals,
  Transaction,
} from "./types";

const EMPTY_YEAR: BudgetYear = {
  spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export function budgetForYear(budgets: Budgets, year: number): BudgetYear {
  return budgets[String(year)] ?? EMPTY_YEAR;
}

/** Budgeted amounts for one month. `month` is 1-12. */
export function budgetForMonth(
  budgets: Budgets,
  year: number,
  month: number,
): { spending: Centavos; billsSubs: Centavos } {
  const y = budgetForYear(budgets, year);
  const i = month - 1;
  return { spending: y.spending[i] ?? 0, billsSubs: y.billsSubs[i] ?? 0 };
}

function track(budget: Centavos, spent: Centavos): BudgetTrack {
  return {
    budget,
    spent,
    remaining: budget - spent,
    status:
      budget === 0
        ? "NO BUDGET SET"
        : spent > budget
          ? "OVER THE BUDGET"
          : "WITHIN THE BUDGET",
  };
}

/**
 * Assess a month against its budget, on both tracks plus the combination.
 *
 * Bills and subscriptions share one budget line, matching BUDGETING row 12.
 * Transfer fees are folded into the spending track, since that is where the
 * month total puts them.
 */
export function assessMonth(
  totals: MonthTotals,
  budget: { spending: Centavos; billsSubs: Centavos },
): BudgetAssessment {
  const spendingSpent = totals.spending + totals.fees + totals.interest;
  const billsSpent = totals.bills + totals.subscriptions;

  return {
    spending: track(budget.spending, spendingSpent),
    billsSubs: track(budget.billsSubs, billsSpent),
    combined: track(budget.spending + budget.billsSubs, totals.total),
  };
}

export function assessMonthFor(
  transactions: readonly Transaction[],
  budgets: Budgets,
  year: number,
  month: number,
): BudgetAssessment {
  return assessMonth(
    monthTotals(transactions, year, month),
    budgetForMonth(budgets, year, month),
  );
}

/** One row of the BUDGETING summary table. */
export interface MonthBudgetRow {
  readonly month: number;
  readonly monthName: string;
  readonly budget: Centavos;
  readonly spent: Centavos;
  readonly remaining: Centavos;
  readonly status: BudgetTrack["status"];
  /** Fraction of budget consumed. 0 when no budget is set. */
  readonly usage: number;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The twelve-row budget summary for a year. */
export function budgetSummary(
  transactions: readonly Transaction[],
  budgets: Budgets,
  year: number,
): MonthBudgetRow[] {
  const y = budgetForYear(budgets, year);

  return MONTHS.map((name, i) => {
    const totals = monthTotals(transactions, year, i + 1);
    const budget = (y.spending[i] ?? 0) + (y.billsSubs[i] ?? 0);
    const spent = totals.total;

    return {
      month: i + 1,
      monthName: name,
      budget,
      spent,
      remaining: budget - spent,
      status:
        budget === 0
          ? "NO BUDGET SET"
          : spent > budget
            ? "OVER THE BUDGET"
            : "WITHIN THE BUDGET",
      usage: budget === 0 ? 0 : spent / budget,
    };
  });
}

export interface BudgetYearTotals {
  readonly budget: Centavos;
  readonly spent: Centavos;
  readonly remaining: Centavos;
}

export function budgetYearTotals(rows: readonly MonthBudgetRow[]): BudgetYearTotals {
  let budget = 0;
  let spent = 0;
  for (const r of rows) {
    budget += r.budget;
    spent += r.spent;
  }
  return { budget, spent, remaining: budget - spent };
}

// ── Daily pacing ───────────────────────────────────────────────────────────

export interface DailyPacing {
  readonly daysInMonth: number;
  readonly daysElapsed: number;
  readonly daysLeft: number;
  /** What remains of the month's budget. Negative when already over. */
  readonly remaining: Centavos;
  /** Even split of what remains across the days left. */
  readonly perDay: Centavos;
  /** Average daily spend so far this month. */
  readonly burnRate: Centavos;
  /** Projected month-end spend at the current burn rate. */
  readonly projected: Centavos;
  /** True when the projection exceeds the budget. */
  readonly onTrackToOverspend: boolean;
}

/**
 * How the month is pacing.
 *
 * Powers the Finance Alert and the insight report. `asOf` defaults to today
 * but is injectable so tests are not time-dependent.
 */
export function dailyPacing(
  transactions: readonly Transaction[],
  budgets: Budgets,
  asOf: IsoDate = today(),
): DailyPacing {
  const year = getYear(asOf);
  const month = getMonth(asOf);

  const totals = monthTotals(transactions, year, month);
  const budget = budgetForMonth(budgets, year, month);
  const totalBudget = budget.spending + budget.billsSubs;

  const inMonth = daysInMonth(year, month);
  const left = daysLeftInMonth(asOf);
  const elapsed = inMonth - left + 1;

  const remaining = totalBudget - totals.total;
  const burnRate = elapsed > 0 ? Math.round(totals.total / elapsed) : 0;
  const projected = burnRate * inMonth;

  return {
    daysInMonth: inMonth,
    daysElapsed: elapsed,
    daysLeft: left,
    remaining,
    perDay: left > 0 ? Math.round(Math.max(0, remaining) / left) : 0,
    burnRate,
    projected,
    onTrackToOverspend: totalBudget > 0 && projected > totalBudget,
  };
}
