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

import { billStatuses } from "./bills";
import { assessMonth, budgetForMonth, dailyPacing } from "./budget";
import {
  daysBetween,
  daysInMonth,
  firstOfMonth,
  getMonth,
  getYear,
  lastOfMonth,
  MONTH_NAMES,
} from "./dates";
import type { Centavos } from "./money";
import { monthTotals, spendingAttribution } from "./totals";
import type {
  BudgetAssessment,
  BudgetYear,
  Budgets,
  IsoDate,
  ReferenceLists,
  Transaction,
} from "./types";

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

/**
 * The middle of a few months' figures, not their mean.
 *
 * One unusually large month drags a mean with it. Walking the planner on
 * 2026-09-15 offered a "usual" spend of ₱42,206.67 beside a last month of
 * ₱13,486.00, a suggestion nobody would budget by. The middle month of three
 * ignores a single outlier and still moves when two of the three do. Null
 * with nothing to go on.
 */
function middle(values: readonly Centavos[]): Centavos | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[half] ?? 0)
    : Math.round(((sorted[half - 1] ?? 0) + (sorted[half] ?? 0)) / 2);
}

export interface CategoryLine {
  readonly name: string;
  readonly spent: Centavos;
  /**
   * The middle figure for this kind of spending over the months before,
   * counting only months that had any spending at all. Null when there are
   * none: a month before the ledger began is not a month of spending nothing.
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
      usual: middle(history.map((h) => h.get(name) ?? 0)),
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

// ── Planning a month from your own history ────────────────────────────────

/** Which months a budget is saved to. */
export type PlanScope = "month" | "rest" | "year";

/** A month's plan saved to that month, to it and every month after, or to the whole year. */
export function applyPlan(
  plan: BudgetYear,
  month: number,
  value: { readonly spending: Centavos; readonly billsSubs: Centavos },
  scope: PlanScope,
): BudgetYear {
  if (scope === "year") {
    return {
      spending: plan.spending.map(() => value.spending) as unknown as Amounts,
      billsSubs: plan.billsSubs.map(() => value.billsSubs) as unknown as Amounts,
    };
  }
  const set = withMonthPlan(plan, month, value);
  return scope === "rest" ? copyPlanForward(set, month) : set;
}

export interface PlanSuggestions {
  /** What the month is set to now. */
  readonly current: { readonly spending: Centavos; readonly billsSubs: Centavos };
  readonly previous: ReturnType<typeof previousPlan>;
  /** The middle income of the months before that had any money moving. */
  readonly usualIncome: Centavos | null;
  /** The bills and subscriptions paid in the two months before, at their latest amount. */
  readonly bills: readonly { readonly item: string; readonly amount: Centavos }[];
  readonly billsTotal: Centavos;
  /** The spending track as rule 3.6 counts it, for the month before. */
  readonly spendingLastMonth: Centavos | null;
  /** The middle of the same over the months before that had any money moving. */
  readonly spendingUsual: Centavos | null;
  /**
   * What spending can be while bills and spending together stay at four
   * fifths of the usual income, so a fifth is kept. Rounded to the nearest
   * hundred pesos, because a budget is a round figure people remember.
   */
  readonly spendingKeepFifth: Centavos | null;
}

const LOOKBACK = 3;
const toNearestHundred = (c: Centavos): Centavos => Math.round(c / 10000) * 10000;

/**
 * Starting figures for a month's budget, from the ledger itself.
 *
 * The workbook's plan was twelve cells typed from memory. The ledger already
 * knows what comes in, which bills get paid and what spending usually runs
 * to, so the plan starts there and the owner adjusts it.
 */
export function planSuggestions(
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  budgets: Budgets,
  year: number,
  month: number,
): PlanSuggestions {
  const start = firstOfMonth(year, month);

  const before: { spending: Centavos; revenue: Centavos }[] = [];
  let lastMonth: Centavos | null = null;

  for (let back = 1; back <= LOOKBACK; back++) {
    const index = year * 12 + (month - 1) - back;
    const totals = monthTotals(transactions, Math.floor(index / 12), (index % 12) + 1);
    // A month before the ledger began is not a month of earning nothing.
    if (totals.total === 0 && totals.revenue === 0) continue;
    const spending = assessMonth(totals, { spending: 0, billsSubs: 0 }).spending.spent;
    if (back === 1) lastMonth = spending;
    before.push({ spending, revenue: totals.revenue });
  }

  const usualIncome = middle(before.map((b) => b.revenue));

  const bills = billStatuses(transactions, reference, start)
    .filter((b) => b.timesPaid > 0 && b.lastPaid !== undefined && daysBetween(b.lastPaid, start) <= 62)
    .map((b) => ({ item: b.item, amount: b.lastAmount }))
    .filter((b) => b.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const billsTotal = bills.reduce((a, b) => a + b.amount, 0);

  return {
    current: budgetForMonth(budgets, year, month),
    previous: previousPlan(budgets, year, month),
    usualIncome,
    bills,
    billsTotal,
    spendingLastMonth: lastMonth,
    spendingUsual: middle(before.map((b) => b.spending)),
    spendingKeepFifth:
      usualIncome === null
        ? null
        : Math.max(0, toNearestHundred(Math.round(usualIncome * 0.8) - billsTotal)),
  };
}
