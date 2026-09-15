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
 *   - where the money went, against what each kind of spending usually costs,
 *     and against its own limit where one is set
 *   - the month's bills, paid and still to come
 *   - a plan that starts from the ledger and can be saved to several months
 *
 * ── One figure per question ───────────────────────────────────────────────
 *
 * The screen answered "what do my bills cost" three ways at once: ₱1,641.00
 * in the planner, ₱454.00 paid plus ₱1,357.00 expected in the bills card, and
 * a usual income of ₱7,338.22 beside ₱1,005,006.95 that had come in. Every
 * card now reads the same functions: `monthBills` for bills, and one
 * `expectedIncome` for what a plan is measured against.
 *
 * ── Two levels of budget ──────────────────────────────────────────────────
 *
 * The two tracks stay the budget: they are what rule 3.6 judges, what the
 * Dashboard reports and what every earlier year was set in. A kind of
 * spending can also have a limit of its own, inside the spending track, for
 * the few that move month to month. Bills need none: each is already followed
 * by name. A limit is advice about the track, never a third verdict.
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

/** Whether a month is over, running, or ahead, as of a day. */
export function phaseOf(year: number, month: number, asOf: IsoDate): MonthPhase {
  const here = year * 12 + month;
  const now = getYear(asOf) * 12 + getMonth(asOf);
  return here < now ? "past" : here > now ? "future" : "current";
}

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

// ── The month ──────────────────────────────────────────────────────────────

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
  const phase = phaseOf(year, month, asOf);

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
   * The middle figure for this kind of spending over the months before,
   * counting only months that had any spending at all. Null when there are
   * none: a month before the ledger began is not a month of spending nothing.
   */
  readonly usual: Centavos | null;
  /** Share of the month's spending by type. */
  readonly share: number;
  /** The limit set for this kind of spending this month, or null for none. */
  readonly limit: Centavos | null;
}

const monthRange = (year: number, month: number) => ({
  start: firstOfMonth(year, month),
  end: lastOfMonth(year, month),
});

/**
 * The spending attribution for a month, biggest first, with the usual beside
 * it. A kind of spending with a limit is listed even before anything is spent
 * on it, so a limit set at the start of a month is visible from day one.
 */
export function categoryLines(
  transactions: readonly Transaction[],
  year: number,
  month: number,
  lookback = 3,
  limits: ReadonlyMap<string, Centavos> = new Map(),
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
  const names = new Set<string>();
  for (const [name, value] of current) {
    if (value > 0) {
      total += value;
      names.add(name);
    }
  }
  for (const name of limits.keys()) names.add(name);

  return [...names]
    .map((name) => {
      const spent = current.get(name) ?? 0;
      return {
        name,
        spent: Math.max(0, spent),
        usual: middle(history.map((h) => h.get(name) ?? 0)),
        share: total > 0 ? Math.max(0, spent) / total : 0,
        limit: limits.get(name) ?? null,
      };
    })
    .sort((a, b) => b.spent - a.spent || (b.limit ?? 0) - (a.limit ?? 0) || a.name.localeCompare(b.name));
}

// ── The month's bills ──────────────────────────────────────────────────────

/**
 * Where a bill stands in the month.
 *
 * `late`, `soon` and `due` only happen in the month that is running;
 * `expected` in a month ahead; `missed` in a month that is over.
 */
export type BillState = "paid" | "late" | "soon" | "due" | "expected" | "missed";

export interface MonthBill {
  readonly item: string;
  readonly category: "Bills" | "Subscriptions";
  readonly state: BillState;
  /** What it cost this month when paid; otherwise the last amount paid. */
  readonly amount: Centavos;
  /** Negative when late. Going by one month after the last payment. */
  readonly daysToDue?: number | undefined;
  /** When it is expected: one month after the last payment. */
  readonly dueOn?: IsoDate | undefined;
  /** When it was paid in this month, the latest payment if more than one. */
  readonly paidOn?: IsoDate | undefined;
}

export interface MonthBills {
  /** Late first, then soonest, then paid. */
  readonly bills: readonly MonthBill[];
  readonly paid: Centavos;
  /** Not yet paid this month, at the last amount paid. 0 once the month is over. */
  readonly stillExpected: Centavos;
  /** `paid + stillExpected`: what this month's bills come to. */
  readonly total: Centavos;
  /** Declared in Settings and never paid, so there is no amount to expect. */
  readonly neverPaid: readonly string[];
}

const BILL_ORDER: Record<BillState, number> = {
  late: 0,
  soon: 1,
  due: 2,
  expected: 3,
  missed: 4,
  paid: 5,
};

/**
 * The bills of a month, one definition for every card that shows them.
 *
 * A bill belongs to the month when it was paid in it, or was last paid within
 * the two months before it started: a subscription cancelled in March is not
 * still expected in September. A bill never paid has no amount to expect, so
 * it is named rather than counted as ₱0.00 due.
 */
export function monthBills(
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  year: number,
  month: number,
  asOf: IsoDate,
): MonthBills {
  const phase = phaseOf(year, month, asOf);
  const start = firstOfMonth(year, month);
  const at = phase === "current" ? asOf : phase === "past" ? lastOfMonth(year, month) : start;

  const bills: MonthBill[] = [];
  const neverPaid: string[] = [];

  for (const b of billStatuses(transactions, reference, at)) {
    if (b.timesPaid === 0) {
      neverPaid.push(b.item);
      continue;
    }
    const recent =
      b.paidThisMonth || (b.lastPaid !== undefined && daysBetween(b.lastPaid, start) <= 62);
    if (!recent) continue;

    let state: BillState;
    if (b.paidThisMonth) state = "paid";
    else if (phase === "past") state = "missed";
    else if (phase === "future") state = "expected";
    else if (b.daysToDue !== undefined && b.daysToDue < 0) state = "late";
    else if (b.daysToDue !== undefined && b.daysToDue <= 3) state = "soon";
    else state = "due";

    let paidOn: IsoDate | undefined;
    if (b.paidThisMonth) {
      for (const t of transactions) {
        if (
          t.type === "Spending" &&
          t.category === b.category &&
          t.item === b.item &&
          getYear(t.date) === year &&
          getMonth(t.date) === month &&
          (!paidOn || t.date > paidOn)
        ) {
          paidOn = t.date;
        }
      }
    }

    bills.push({
      item: b.item,
      category: b.category,
      state,
      amount: b.paidThisMonth ? b.paidThisMonthAmount : b.lastAmount || b.averageAmount,
      daysToDue: b.daysToDue,
      dueOn: b.nextDue,
      paidOn,
    });
  }

  bills.sort(
    (x, y) =>
      BILL_ORDER[x.state] - BILL_ORDER[y.state] ||
      (x.daysToDue ?? 999) - (y.daysToDue ?? 999) ||
      y.amount - x.amount,
  );

  const paid = bills.filter((b) => b.state === "paid").reduce((a, b) => a + b.amount, 0);
  const stillExpected =
    phase === "past" ? 0 : bills.filter((b) => b.state !== "paid").reduce((a, b) => a + b.amount, 0);

  return { bills, paid, stillExpected, total: paid + stillExpected, neverPaid };
}

// ── Setting a plan ─────────────────────────────────────────────────────────

type Amounts = BudgetYear["spending"];

const NOTHING: Amounts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * One month's plan set, every other month left as it was.
 *
 * Every function here spreads the year it was given, so the limits for kinds
 * of spending travel with a saved budget instead of being dropped by it.
 */
export function withMonthPlan(
  plan: BudgetYear,
  month: number,
  value: { readonly spending: Centavos; readonly billsSubs: Centavos },
): BudgetYear {
  const i = month - 1;
  return {
    ...plan,
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
    ...plan,
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

/** Which months a budget is saved to. */
export type PlanScope = "month" | "rest" | "year";

const inScope = (j: number, i: number, scope: PlanScope): boolean =>
  scope === "year" || j === i || (scope === "rest" && j > i);

/** A month's plan saved to that month, to it and every month after, or to the whole year. */
export function applyPlan(
  plan: BudgetYear,
  month: number,
  value: { readonly spending: Centavos; readonly billsSubs: Centavos },
  scope: PlanScope,
): BudgetYear {
  const i = month - 1;
  return {
    ...plan,
    spending: plan.spending.map((v, j) => (inScope(j, i, scope) ? value.spending : v)) as unknown as Amounts,
    billsSubs: plan.billsSubs.map((v, j) => (inScope(j, i, scope) ? value.billsSubs : v)) as unknown as Amounts,
  };
}

// ── Limits for kinds of spending ───────────────────────────────────────────

/** The limits set for one month, only those above nothing. */
/**
 * A kind of spending renamed in Settings, carried into its limits.
 *
 * The rows are renamed (`renameItem`), and a limit is keyed by the kind's
 * name, so without this the limit on "Food" stayed on a name no row used any
 * more: the Budget screen showed Meals with no limit, and the limit sat on a
 * kind with nothing in it. Where both names have a limit in a month, the one
 * already on the new name is kept. The change history keeps the old name,
 * since that is what the kind was called when it changed.
 */
export function renameLimitKind(
  budgets: Budgets,
  from: string,
  to: string,
): { readonly budgets: Budgets; readonly years: readonly string[] } {
  const was = from.trim();
  const now = to.trim();
  if (!was || !now || was === now) return { budgets, years: [] };

  const next: Record<string, BudgetYear> = { ...budgets };
  const years: string[] = [];
  for (const [year, plan] of Object.entries(budgets)) {
    const moving = plan.categories?.[was];
    if (!moving) continue;
    const categories: Record<string, Amounts> = {};
    for (const [name, amounts] of Object.entries(plan.categories ?? {})) {
      if (name !== was) categories[name] = amounts;
    }
    const kept = categories[now];
    categories[now] = kept ? (kept.map((v, i) => (v > 0 ? v : (moving[i] ?? 0))) as unknown as Amounts) : moving;
    next[year] = { ...plan, categories };
    years.push(year);
  }
  return { budgets: next, years };
}

export function categoryLimits(plan: BudgetYear | undefined, month: number): Map<string, Centavos> {
  const out = new Map<string, Centavos>();
  for (const [name, amounts] of Object.entries(plan?.categories ?? {})) {
    const value = amounts[month - 1] ?? 0;
    if (value > 0) out.set(name, value);
  }
  return out;
}

/**
 * A limit for one kind of spending, saved to the month, the rest of the year
 * or all of it. Nothing removes it, and a kind of spending left with no limit
 * in any month is taken off the year altogether. The two tracks are untouched.
 */
export function setCategoryLimit(
  plan: BudgetYear,
  name: string,
  month: number,
  value: Centavos,
  scope: PlanScope,
): BudgetYear {
  const key = name.trim();
  if (!key) return plan;

  const i = month - 1;
  const was: readonly Centavos[] = plan.categories?.[key] ?? NOTHING;
  const next = was.map((v, j) => (inScope(j, i, scope) ? Math.max(0, value) : v));

  const categories: Record<string, Amounts> = { ...(plan.categories ?? {}) };
  if (next.every((v) => v === 0)) delete categories[key];
  else categories[key] = next as unknown as Amounts;

  const { categories: _replaced, ...tracks } = plan;
  return Object.keys(categories).length > 0 ? { ...tracks, categories } : tracks;
}

// ── Planning a month from your own history ────────────────────────────────

export interface PlanSuggestions {
  /** What the month is set to now. */
  readonly current: { readonly spending: Centavos; readonly billsSubs: Centavos };
  readonly previous: ReturnType<typeof previousPlan>;
  /** The middle income of the months before that had any money moving. */
  readonly usualIncome: Centavos | null;
  /** Income already in this month. 0 for a month not started. */
  readonly incomeSoFar: Centavos;
  /**
   * What a plan for this month is measured against: the income already in
   * once it is more than usual, and otherwise the usual. Null with neither.
   */
  readonly expectedIncome: Centavos | null;
  readonly expectedFrom: "month" | "usual";
  /** The same bills the Bills card shows. */
  readonly bills: MonthBills;
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
 * to, so the plan starts there and the owner adjusts it. January looks back
 * into the December before, because the ledger does not stop at a year.
 */
export function planSuggestions(
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  budgets: Budgets,
  year: number,
  month: number,
  asOf: IsoDate,
): PlanSuggestions {
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
  const incomeSoFar =
    phaseOf(year, month, asOf) === "future" ? 0 : monthTotals(transactions, year, month).revenue;
  const fromMonth = incomeSoFar > 0 && incomeSoFar >= (usualIncome ?? 0);

  const bills = monthBills(transactions, reference, year, month, asOf);

  return {
    current: budgetForMonth(budgets, year, month),
    previous: previousPlan(budgets, year, month),
    usualIncome,
    incomeSoFar,
    expectedIncome: fromMonth ? incomeSoFar : usualIncome,
    expectedFrom: fromMonth ? "month" : "usual",
    bills,
    spendingLastMonth: lastMonth,
    spendingUsual: middle(before.map((b) => b.spending)),
    spendingKeepFifth:
      usualIncome === null
        ? null
        : Math.max(0, toNearestHundred(Math.round(usualIncome * 0.8) - bills.total)),
  };
}
