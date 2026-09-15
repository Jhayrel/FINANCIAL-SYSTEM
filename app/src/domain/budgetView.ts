/**
 * The Budget screen's view of a month.
 *
 * Built on rule 3.6, never instead of it. The two tracks, their verdicts and
 * every figure come from `budget.ts` and `totals.ts` unchanged, and
 * `budgetView.test.ts` asserts that they arrive here exactly. What this adds
 * is what a budget is used for during a month rather than after it:
 *
 *   - where the month stands: what is left, what that is a day, and whether
 *     the pace so far carries it over
 *   - the plan against the money that came in, and what was kept
 *   - where the money went, against what each kind of spending usually costs
 *   - a plan that can be set once and carried forward
 */

import { assessMonth, budgetForMonth, dailyPacing } from "./budget";
import { daysInMonth, firstOfMonth, getMonth, getYear, lastOfMonth, MONTH_NAMES } from "./dates";
import type { Centavos } from "./money";
import { monthTotals, spendingAttribution } from "./totals";
import type { BudgetAssessment, BudgetYear, Budgets, IsoDate, Transaction } from "./types";

export type MonthPhase = "past" | "current" | "future";

export interface MonthPlanView {
  readonly year: number;
  readonly month: number;
  readonly monthName: string;
  readonly phase: MonthPhase;
  /** Rule 3.6, exactly as `assessMonthFor` gives it. */
  readonly assessment: BudgetAssessment;
  /** Money in. Starting balances are not income (rule Y1). */
  readonly revenue: Centavos;
  /** What came in less what the two tracks count. Negative when more went out. */
  readonly kept: Centavos;
  /** `kept` as a share of what came in. Null with no income. */
  readonly keptRate: number | null;
  /** The whole plan as a share of what came in. Null with no plan or no income. */
  readonly planShareOfIncome: number | null;
  /** How far through the month: 1 once it is over, 0 before it starts. */
  readonly elapsed: number;
  /** Days left, today included. 0 once the month is over. */
  readonly daysLeft: number;
  /** What is left of the plan spread over the days left. 0 when nothing is. */
  readonly perDay: Centavos;
  /** Month-end spend at the pace so far. Only while the month is running. */
  readonly projected: Centavos | null;
}

export function monthPlanView(
  transactions: readonly Transaction[],
  budgets: Budgets,
  year: number,
  month: number,
  asOf: IsoDate,
): MonthPlanView {
  const totals = monthTotals(transactions, year, month);
  const assessment = assessMonth(totals, budgetForMonth(budgets, year, month));

  const here = year * 12 + month;
  const now = getYear(asOf) * 12 + getMonth(asOf);
  const phase: MonthPhase = here < now ? "past" : here > now ? "future" : "current";

  const days = daysInMonth(year, month);
  const plan = assessment.combined.budget;

  let elapsed = 0;
  let daysLeft = days;
  let perDay = plan > 0 ? Math.round(plan / days) : 0;
  let projected: Centavos | null = null;

  if (phase === "past") {
    elapsed = 1;
    daysLeft = 0;
    perDay = 0;
  } else if (phase === "current") {
    // One definition of pace in the app: the Dashboard's.
    const pace = dailyPacing(transactions, budgets, asOf);
    elapsed = pace.daysElapsed / pace.daysInMonth;
    daysLeft = pace.daysLeft;
    perDay = plan > 0 ? pace.perDay : 0;
    projected = pace.projected;
  }

  const revenue = totals.revenue;
  const kept = revenue - totals.total;

  return {
    year,
    month,
    monthName: MONTH_NAMES[month - 1] ?? "",
    phase,
    assessment,
    revenue,
    kept,
    keptRate: revenue > 0 ? kept / revenue : null,
    planShareOfIncome: revenue > 0 && plan > 0 ? plan / revenue : null,
    elapsed,
    daysLeft,
    perDay,
    projected,
  };
}

// ── Where it went ──────────────────────────────────────────────────────────

export interface CategoryLine {
  readonly name: string;
  readonly spent: Centavos;
  /**
   * The average for this kind of spending over the months before, counting
   * only months that had any spending at all. Null when there are none: a
   * month before the ledger began is not a month of spending nothing.
   */
  readonly usual: Centavos | null;
  /** Share of the month's spending by type. */
  readonly share: number;
}

const monthRange = (year: number, month: number) => ({
  start: firstOfMonth(year, month),
  end: lastOfMonth(year, month),
});

/** The spending attribution for a month, biggest first, with the usual beside it. */
export function categoryLines(
  transactions: readonly Transaction[],
  year: number,
  month: number,
  lookback = 3,
): CategoryLine[] {
  const current = spendingAttribution(transactions, monthRange(year, month));

  const history: Map<string, Centavos>[] = [];
  for (let back = 1; back <= lookback; back++) {
    const index = year * 12 + (month - 1) - back;
    const past = spendingAttribution(
      transactions,
      monthRange(Math.floor(index / 12), (index % 12) + 1),
    );
    if (past.size > 0) history.push(past);
  }

  let total = 0;
  for (const value of current.values()) if (value > 0) total += value;

  return [...current.entries()]
    .filter(([, spent]) => spent > 0)
    .map(([name, spent]) => ({
      name,
      spent,
      usual:
        history.length > 0
          ? Math.round(history.reduce((sum, h) => sum + (h.get(name) ?? 0), 0) / history.length)
          : null,
      share: total > 0 ? spent / total : 0,
    }))
    .sort((a, b) => b.spent - a.spent);
}

// ── Setting a plan ─────────────────────────────────────────────────────────

type Amounts = BudgetYear["spending"];

/** One month's plan set, every other month left as it was. */
export function withMonthPlan(
  plan: BudgetYear,
  month: number,
  value: { readonly spending: Centavos; readonly billsSubs: Centavos },
): BudgetYear {
  const i = month - 1;
  return {
    spending: plan.spending.map((v, j) => (j === i ? value.spending : v)) as unknown as Amounts,
    billsSubs: plan.billsSubs.map((v, j) => (j === i ? value.billsSubs : v)) as unknown as Amounts,
  };
}

/**
 * One month's plan carried into every month after it in the year.
 *
 * The workbook needed each of twelve cells typed, which is why September to
 * December stood at zero: a plan that does not change month to month is set
 * once. Months before are left alone, because they already happened.
 */
export function copyPlanForward(plan: BudgetYear, fromMonth: number): BudgetYear {
  const i = fromMonth - 1;
  const spending = plan.spending[i] ?? 0;
  const billsSubs = plan.billsSubs[i] ?? 0;
  return {
    spending: plan.spending.map((v, j) => (j > i ? spending : v)) as unknown as Amounts,
    billsSubs: plan.billsSubs.map((v, j) => (j > i ? billsSubs : v)) as unknown as Amounts,
  };
}

/**
 * The nearest earlier month with a plan, for "use last month's plan".
 *
 * January looks back to the December before it, because a year is a filter
 * on one continuous ledger (rule Y1), not a fresh start.
 */
export function previousPlan(
  budgets: Budgets,
  year: number,
  month: number,
): { year: number; month: number; spending: Centavos; billsSubs: Centavos } | null {
  for (let m = month - 1; m >= 1; m--) {
    const p = budgetForMonth(budgets, year, m);
    if (p.spending + p.billsSubs > 0) return { year, month: m, ...p };
  }
  const december = budgetForMonth(budgets, year - 1, 12);
  return december.spending + december.billsSubs > 0 ? { year: year - 1, month: 12, ...december } : null;
}
