import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { getMonth, getYear } from "./dates";
import { formatMoney } from "./money";
import {
  assessMonthFor,
  budgetForMonth,
  budgetSummary,
  budgetYearTotals,
  dailyPacing,
} from "./budget";

const fx = loadFixture();
const YEAR = getYear(fx.expected.asOf);
const MONTH = getMonth(fx.expected.asOf);

describe("parity: budgets", () => {
  it("reads the captured month's two budget lines from INSIGHTS", () => {
    const b = budgetForMonth(fx.budgets, YEAR, MONTH);
    expect(b.spending).toBe(fx.expected.insights.spendingBudget);
    expect(b.billsSubs).toBe(fx.expected.insights.billsSubsBudget);
  });

  /**
   * Money the owner sent to another person is spending, and the budget has to
   * see it or the budget is measuring the wrong thing. The workbook's monthly
   * split left it out; ours does not. See `domain/transfers.ts` and the same
   * delta in `totals.test.ts`.
   *
   * January: PHP 2,000.00 (#13) + PHP 100.00 (#28) + PHP 15.00 (#8)
   * June:    PHP 2,000.00 (#369)
   */
  const MONTHLY_DELTA = [211500, 0, 0, 0, 0, 200000, 0, 0, 0, 0, 0, 0];

  it("reproduces the BUDGETING summary row for row, plus the money that left", () => {
    const rows = budgetSummary(fx.transactions, fx.budgets, YEAR);

    fx.expected.monthlyBudgetSummary.forEach((want, i) => {
      const got = rows[i]!;
      const delta = MONTHLY_DELTA[i] ?? 0;
      expect(got.budget, `${want.month} budget`).toBe(want.budget);
      expect(
        got.spent,
        `${want.month} spent: got ${formatMoney(got.spent)}, expected ${formatMoney(want.spending + delta)}`,
      ).toBe(want.spending + delta);
      expect(got.remaining, `${want.month} remaining`).toBe(want.remaining - delta);
    });
  });

  it("leaves the ten months the workbook got right untouched", () => {
    const rows = budgetSummary(fx.transactions, fx.budgets, YEAR);
    fx.expected.monthlyBudgetSummary.forEach((want, i) => {
      if (MONTHLY_DELTA[i] !== 0) return;
      expect(rows[i]!.spent, want.month).toBe(want.spending);
    });
  });

  it("reproduces the workbook's year totals, plus PHP 4,115.00", () => {
    const rows = budgetSummary(fx.transactions, fx.budgets, YEAR);
    const totals = budgetYearTotals(rows);

    const wantBudget = fx.expected.monthlyBudgetSummary.reduce((a, r) => a + r.budget, 0);
    const wantSpent = fx.expected.monthlyBudgetSummary.reduce((a, r) => a + r.spending, 0);
    const delta = MONTHLY_DELTA.reduce((a, b) => a + b, 0);

    expect(delta).toBe(411500);
    expect(totals.budget).toBe(wantBudget);
    expect(totals.spent).toBe(wantSpent + delta);
    expect(totals.remaining).toBe(wantBudget - wantSpent - delta);
  });

  it("reaches the same verdict as the workbook for the captured month", () => {
    const a = assessMonthFor(fx.transactions, fx.budgets, YEAR, MONTH);
    expect(a.combined.status).toBe(fx.expected.insights.status);
  });
});

describe("two-track assessment", () => {
  const a = assessMonthFor(fx.transactions, fx.budgets, YEAR, MONTH);

  /**
   * Reproduces the workbook's own AI insight report for August 2026:
   *
   *   Spending: OVER THE BUDGET by Php 961.58
   *   Bills and Subscription: OVER THE BUDGET by Php 2,629.79
   *
   * The ₱6,961.58 spending figure also settles SYSTEM-ANALYSIS defect 2: the
   * report folds transfer fees into the spending track (6,943.58 + 18.00),
   * whereas INSIGHTS!I16 keeps them in a fourth bucket. Both reach the same
   * grand total; we follow the report, so the two tracks add up to it.
   */
  it("judges spending and bills independently, matching the workbook's report", () => {
    expect(a.spending.status).toBe("OVER THE BUDGET");
    expect(a.spending.spent).toBe(696158);
    expect(-a.spending.remaining).toBe(96158);

    expect(a.billsSubs.status).toBe("OVER THE BUDGET");
    expect(a.billsSubs.spent).toBe(432979);
    expect(-a.billsSubs.remaining).toBe(262979);
  });

  it("keeps the combined track consistent with the month total", () => {
    expect(a.combined.spent).toBe(a.spending.spent + a.billsSubs.spent);
    expect(a.combined.budget).toBe(a.spending.budget + a.billsSubs.budget);
    expect(a.combined.remaining).toBe(a.combined.budget - a.combined.spent);
  });

  it("reports NO BUDGET SET rather than a false pass", () => {
    // September onwards has no budget; calling that "within budget" would be
    // misleading.
    const rows = budgetSummary(fx.transactions, fx.budgets, YEAR);
    expect(rows[11]!.status).toBe("NO BUDGET SET");
    expect(rows[11]!.usage).toBe(0);
  });
});

describe("daily pacing", () => {
  it("splits the remaining budget across the days left", () => {
    const p = dailyPacing(fx.transactions, fx.budgets, "2026-08-15");
    expect(p.daysInMonth).toBe(31);
    expect(p.daysLeft).toBe(17);
    expect(p.daysElapsed).toBe(15);
    expect(p.daysElapsed + p.daysLeft).toBe(p.daysInMonth + 1);
  });

  it("never proposes a negative daily allowance", () => {
    // August is over budget, so `remaining` is negative.
    const p = dailyPacing(fx.transactions, fx.budgets, "2026-08-29");
    expect(p.remaining).toBeLessThan(0);
    expect(p.perDay).toBe(0);
  });

  it("flags an overspend projection from the burn rate", () => {
    const p = dailyPacing(fx.transactions, fx.budgets, "2026-08-29");
    expect(p.burnRate).toBeGreaterThan(0);
    expect(p.onTrackToOverspend).toBe(true);
  });

  it("handles the last day of a month without dividing by zero", () => {
    const p = dailyPacing(fx.transactions, fx.budgets, "2026-08-31");
    expect(p.daysLeft).toBe(1);
    expect(Number.isFinite(p.perDay)).toBe(true);
  });
});
