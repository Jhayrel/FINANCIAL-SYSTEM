/**
 * The Budget screen's month view.
 *
 * The first block is the one that matters: the view adds to rule 3.6 and must
 * carry its verdicts and figures exactly. The rest pins the additions, and
 * that every card asking the same question gets the same figure.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { assessMonthFor, budgetForYear, dailyPacing } from "./budget";
import {
  applyPlan,
  categoryLines,
  copyPlanForward,
  monthBills,
  monthPlanView,
  phaseOf,
  planSuggestions,
  previousPlan,
  withMonthPlan,
} from "./budgetView";
import { firstOfMonth, getMonth, getYear, lastOfMonth } from "./dates";
import { monthTotals, spendingAttribution } from "./totals";
import type { Budgets, Transaction } from "./types";

const fx = loadFixture();
const AS_OF = fx.expected.asOf;
const YEAR = getYear(AS_OF);
const MONTH = getMonth(AS_OF);

const view = (month: number) => monthPlanView(fx.transactions, fx.budgets, YEAR, month, AS_OF);

describe("the month view carries rule 3.6 and changes none of it", () => {
  it("gives the same two-track verdict as assessMonthFor, figure for figure", () => {
    for (let m = 1; m <= 12; m++) {
      expect(view(m).assessment).toEqual(assessMonthFor(fx.transactions, fx.budgets, YEAR, m));
    }
  });

  it("paces the running month exactly as the Dashboard does", () => {
    const v = view(MONTH);
    const pace = dailyPacing(fx.transactions, fx.budgets, AS_OF);
    expect(v.phase).toBe("current");
    expect(v.daysLeft).toBe(pace.daysLeft);
    expect(v.projected).toBe(pace.projected);
    expect(v.perDay).toBe(pace.perDay);
  });

  it("keeps what came in less what went out", () => {
    const t = monthTotals(fx.transactions, YEAR, MONTH);
    const v = view(MONTH);
    expect(v.revenue).toBe(t.revenue);
    expect(v.kept).toBe(t.revenue - t.total);
  });

  it("closes a month that is over and has not started one that is ahead", () => {
    expect(view(MONTH - 1)).toMatchObject({ phase: "past", elapsed: 1, daysLeft: 0, perDay: 0, projected: null });
    expect(view(MONTH + 1)).toMatchObject({ phase: "future", elapsed: 0, projected: null });
    expect(phaseOf(YEAR + 1, 1, AS_OF)).toBe("future");
    expect(phaseOf(YEAR - 1, 12, AS_OF)).toBe("past");
  });
});

// ── Where it went ──────────────────────────────────────────────────────────

const spend = (date: string, item: string, total: number): Transaction => ({
  id: `${date}-${item}`,
  recordNumber: 1,
  date,
  type: "Spending",
  fromWallet: "Cash",
  toWallet: "",
  category: "Spending",
  item,
  description: "",
  amount: total,
  fee: 0,
  total,
  notes: "",
  status: "Paid",
});

describe("where the month went", () => {
  it("is the month's spending attribution, biggest first, and nothing else", () => {
    const lines = categoryLines(fx.transactions, YEAR, MONTH);
    const attributed = [
      ...spendingAttribution(fx.transactions, {
        start: firstOfMonth(YEAR, MONTH),
        end: lastOfMonth(YEAR, MONTH),
      }).values(),
    ]
      .filter((v) => v > 0)
      .reduce((a, v) => a + v, 0);

    expect(lines.reduce((a, l) => a + l.spent, 0)).toBe(attributed);
    expect(lines.every((l, i) => i === 0 || (lines[i - 1]?.spent ?? 0) >= l.spent)).toBe(true);
  });

  it("takes the usual from months that had spending, not from empty ones", () => {
    const rows = [
      spend("2026-06-10", "Food", 100000),
      spend("2026-08-10", "Food", 300000),
      spend("2026-09-05", "Food", 250000),
    ];
    // July had nothing at all, so it is not counted as a month of spending nothing.
    expect(categoryLines(rows, 2026, 9)[0]?.usual).toBe(200000);
  });

  it("is not dragged up by one unusually large month", () => {
    const rows = [
      spend("2026-06-10", "Food", 100000),
      spend("2026-07-10", "Food", 900000),
      spend("2026-08-10", "Food", 120000),
      spend("2026-09-05", "Food", 150000),
    ];
    expect(categoryLines(rows, 2026, 9)[0]?.usual).toBe(120000);
  });

  it("has no usual before there is any history", () => {
    expect(categoryLines([spend("2026-01-04", "Food", 5000)], 2026, 1)[0]?.usual).toBeNull();
  });

  it("gives every line its share of the month", () => {
    const rows = [spend("2026-09-01", "Food", 7500), spend("2026-09-02", "Gas", 2500)];
    expect(categoryLines(rows, 2026, 9).map((l) => l.share)).toEqual([0.75, 0.25]);
  });
});

// ── The month's bills ──────────────────────────────────────────────────────

describe("a month's bills, one definition", () => {
  const running = monthBills(fx.transactions, fx.reference, YEAR, MONTH, AS_OF);

  it("adds up: paid and still expected make the month's total", () => {
    expect(running.total).toBe(running.paid + running.stillExpected);
    expect(running.paid).toBe(running.bills.filter((b) => b.state === "paid").reduce((a, b) => a + b.amount, 0));
  });

  it("lists what needs doing first and what is paid last", () => {
    const order = ["late", "soon", "due", "expected", "missed", "paid"];
    const ranks = running.bills.map((b) => order.indexOf(b.state));
    expect(ranks.every((r, i) => i === 0 || (ranks[i - 1] ?? 0) <= r)).toBe(true);
  });

  it("names a bill never paid instead of counting it as nothing due", () => {
    expect(running.bills.some((b) => running.neverPaid.includes(b.item))).toBe(false);
  });

  it("expects nothing more of a month that is over", () => {
    const over = monthBills(fx.transactions, fx.reference, YEAR, MONTH - 1, AS_OF);
    expect(over.stillExpected).toBe(0);
    expect(over.bills.every((b) => b.state === "paid" || b.state === "missed")).toBe(true);
  });

  it("expects every bill of a month ahead", () => {
    const ahead = monthBills(fx.transactions, fx.reference, YEAR, MONTH + 1, AS_OF);
    expect(ahead.paid).toBe(0);
    expect(ahead.bills.every((b) => b.state === "expected")).toBe(true);
  });
});

// ── Setting a plan ─────────────────────────────────────────────────────────

describe("setting a plan once", () => {
  const plan = budgetForYear(fx.budgets, YEAR);

  it("copies a month's plan to every month after it, and to none before", () => {
    const next = copyPlanForward(plan, MONTH);
    for (let i = 0; i < 12; i++) {
      if (i < MONTH) {
        expect(next.spending[i]).toBe(plan.spending[i]);
        expect(next.billsSubs[i]).toBe(plan.billsSubs[i]);
      } else {
        expect(next.spending[i]).toBe(plan.spending[MONTH - 1]);
        expect(next.billsSubs[i]).toBe(plan.billsSubs[MONTH - 1]);
      }
    }
  });

  it("sets one month and leaves the other eleven alone", () => {
    const next = withMonthPlan(plan, 9, { spending: 800000, billsSubs: 170000 });
    expect(next.spending[8]).toBe(800000);
    expect(next.billsSubs[8]).toBe(170000);
    expect(next.spending.filter((_, i) => i !== 8)).toEqual(plan.spending.filter((_, i) => i !== 8));
  });

  it("finds the nearest earlier month with a plan", () => {
    expect(previousPlan(fx.budgets, YEAR, MONTH + 1)).toMatchObject({
      year: YEAR,
      month: MONTH,
      spending: plan.spending[MONTH - 1],
      billsSubs: plan.billsSubs[MONTH - 1],
    });
  });

  it("looks back to the December before for a January", () => {
    const budgets: Budgets = {
      "2025": {
        spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 500000],
        billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    };
    expect(previousPlan(budgets, 2026, 1)).toMatchObject({ year: 2025, month: 12, spending: 500000 });
  });

  it("finds nothing when no month has a plan", () => {
    expect(previousPlan({}, 2026, 5)).toBeNull();
  });
});

describe("which months a budget is saved to", () => {
  const plan = budgetForYear(fx.budgets, YEAR);
  const value = { spending: 900000, billsSubs: 150000 };

  it("saves to the month alone", () => {
    const next = applyPlan(plan, 9, value, "month");
    expect([next.spending[8], next.billsSubs[8]]).toEqual([900000, 150000]);
    expect(next.spending[9]).toBe(plan.spending[9]);
    expect(next.spending[7]).toBe(plan.spending[7]);
  });

  it("saves to the month and every month after it", () => {
    const next = applyPlan(plan, 9, value, "rest");
    expect(next.spending[7]).toBe(plan.spending[7]);
    expect(next.spending.slice(8)).toEqual([900000, 900000, 900000, 900000]);
    expect(next.billsSubs.slice(8)).toEqual([150000, 150000, 150000, 150000]);
  });

  it("saves to every month of the year", () => {
    const next = applyPlan(plan, 9, value, "year");
    expect(next.spending.every((v) => v === 900000)).toBe(true);
    expect(next.billsSubs.every((v) => v === 150000)).toBe(true);
  });
});

// ── Planning from history ──────────────────────────────────────────────────

describe("a budget that starts from the ledger", () => {
  const next = MONTH + 1;
  const s = planSuggestions(fx.transactions, fx.reference, fx.budgets, YEAR, next, AS_OF);

  it("offers the plan of the month before", () => {
    expect(s.previous).toMatchObject({ year: YEAR, month: MONTH });
  });

  it("takes last month's spending from the spending track, as rule 3.6 counts it", () => {
    expect(s.spendingLastMonth).toBe(assessMonthFor(fx.transactions, fx.budgets, YEAR, MONTH).spending.spent);
  });

  it("takes the usual income from the middle of the three months before", () => {
    const incomes = [MONTH, MONTH - 1, MONTH - 2]
      .map((m) => monthTotals(fx.transactions, YEAR, m).revenue)
      .sort((a, b) => a - b);
    expect(s.usualIncome).toBe(incomes[1]);
  });

  it("shows the planner the very bills the Bills card shows", () => {
    expect(s.bills).toEqual(monthBills(fx.transactions, fx.reference, YEAR, next, AS_OF));
  });

  it("measures a month ahead against the usual income", () => {
    expect(s.incomeSoFar).toBe(0);
    expect(s.expectedFrom).toBe("usual");
    expect(s.expectedIncome).toBe(s.usualIncome);
  });

  it("measures the running month against what came in, once that is more than usual", () => {
    const now = planSuggestions(fx.transactions, fx.reference, fx.budgets, YEAR, MONTH, AS_OF);
    const soFar = monthTotals(fx.transactions, YEAR, MONTH).revenue;
    expect(now.incomeSoFar).toBe(soFar);
    expect(now.expectedIncome).toBe(Math.max(soFar, now.usualIncome ?? 0));
  });

  it("keeps a fifth of income, in whole hundreds of pesos", () => {
    const income = s.usualIncome ?? 0;
    const expected = Math.max(0, Math.round((Math.round(income * 0.8) - s.bills.total) / 10000) * 10000);
    expect(s.spendingKeepFifth).toBe(expected);
    expect(Math.abs((s.spendingKeepFifth ?? 0) % 10000)).toBe(0);
  });

  it("suggests nothing it has no history for", () => {
    const empty = planSuggestions([], fx.reference, {}, 2026, 1, "2026-01-15");
    expect(empty).toMatchObject({
      usualIncome: null,
      expectedIncome: null,
      spendingUsual: null,
      spendingLastMonth: null,
      spendingKeepFifth: null,
      previous: null,
    });
    expect(empty.bills.total).toBe(0);
  });
});
