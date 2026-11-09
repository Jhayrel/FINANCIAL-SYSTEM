/**
 * Spending still to come. The owner, 9 November 2026: "Can you show me a
 * list of future spending" was read as this month's spending, the model
 * added the plans up itself (and was flagged for it), and "Pie" drew
 * November's spending. Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { chartReading, localHint, measureOf } from "./chartAsk";
import { chartInWords } from "./charts";
import { makeAllocation, monthAllocations } from "./monthAllocation";
import { makePlan, NO_DATE, viewOf } from "./planner";
import { asksUpcoming, buildUpcomingChart, upcomingOf, upcomingWords } from "./upcoming";
import type { MonthBills } from "./budgetView";
import type { Transaction } from "./types";

const ASOF = "2026-11-09";
const DASH = String.fromCharCode(0x2014);
const plan = (title: string, amount: number, due: string, over: Record<string, unknown> = {}) =>
  makePlan({ title, amount, due, item: "Online Buy", wallet: "Cash", need: false, setAside: true, notes: "", ...over }, ASOF, "owner", `p-${title}`);
const view = (p: ReturnType<typeof plan>) => viewOf(p, { transactions: [] as Transaction[], accounts: [], asOf: ASOF });

const bills: MonthBills = {
  bills: [
    { item: "Wifi", category: "Bills", state: "soon", amount: 120_000, dueOn: "2026-11-12", daysToDue: 3 },
    { item: "Music", category: "Subscriptions", state: "due", amount: 20_000, dueOn: "2026-11-20", daysToDue: 11 },
    { item: "Phone", category: "Bills", state: "paid", amount: 30_000, paidOn: "2026-11-03" },
  ],
  paid: 30_000,
  stillExpected: 140_000,
  total: 170_000,
  neverPaid: [],
} as MonthBills;

describe("asking for spending still to come", () => {
  it("reads the owner's words, and leaves spending done and the forecast alone", () => {
    for (const q of ["Can you show me a list of future spending", "upcoming expenses", "what do I still have to pay", "what's coming up", "planned spending", "bills still to pay", "gastos na darating"]) {
      expect(asksUpcoming(q), q).toBe(true);
      expect(measureOf(localHint(q)), q).toBe("upcoming");
    }
    for (const q of ["how much did I spend this month", "where did my money go", "forecast for next month", "what will I spend next month", "show me a prediction of future spending"]) {
      expect(asksUpcoming(q), q).toBe(false);
    }
  });
});

describe("what is still to come", () => {
  const plans = [plan("Keychains", 200_000, "2026-12-15"), plan("Tuition", 970_000, NO_DATE, { item: "School" }), plan("Groceries", 500_000, NO_DATE, { item: "Home Needs" }), plan("Emergency fund", 300_000, "2026-12-01", { into: "Savings" })];
  const gas = makeAllocation({ kind: "Gas", amount: null, each: 25_000, times: 4, per: "week" }, "2026-11", "2026-11-01", "a-gas");
  const alloc = monthAllocations([gas], [], "2026-11", ASOF);
  const u = upcomingOf({ views: plans.map(view), bills, allocations: alloc, debts: [{ debtId: "d1", name: "Credit line", kind: "payable", amount: 50_000, dueOn: "2026-11-25", daysToDue: 16, basis: "plan" }] as never });

  it("adds up every part on the device, the save plan apart", () => {
    expect(u.plans).toBe(1_670_000);
    expect(u.noDate).toBe(1_470_000);
    expect(u.bills).toBe(140_000);
    expect(u.allocations).toBe(100_000);
    expect(u.debts).toBe(50_000);
    expect(u.total).toBe(1_960_000);
    expect(u.apart).toEqual([{ label: "Emergency fund", amount: 300_000, when: "2026-12-01", what: "save" }]);
  });

  it("says it with the app's own totals", () => {
    const words = upcomingWords(u, ASOF, { name: "December 2026", total: 1_200_000 });
    expect(words.split("\n")[0]).toBe("**₱19,600.00 is still to come.**");
    expect(words).toContain("Plans on the Planner, ₱16,700.00:\n- Keychains: ₱2,000.00, due December 15, 2026");
    expect(words).toContain("- Tuition: ₱9,700.00, no date yet");
    expect(words).toContain("Bills and subscriptions still to pay in November, ₱1,400.00:\n- Wifi: ₱1,200.00, due November 12, 2026\n- Music: ₱200.00, due November 20, 2026");
    expect(words).toContain("Still held in November's allocations, ₱1,000.00:\n- Gas allocation: ₱1,000.00, this month");
    expect(words).toContain("Debt payments due, ₱500.00:\n- Credit line: ₱500.00, due November 25, 2026");
    expect(words).toContain("₱14,700.00 of the plans has no date yet, so nothing is set aside for it.");
    expect(words).toContain("Apart from spending: Emergency fund ₱3,000.00 to save, December 1, 2026.");
    expect(words).toContain("Beyond these, a usual month costs about ₱12,000.00, going by the forecast for December 2026.");
    expect(words).not.toContain(DASH);
  });

  it("draws it, the parts adding up to the total, and a pie when asked", () => {
    const chart = buildUpcomingChart(u)!;
    expect(chart.measure).toBe("upcoming");
    expect(chart.rows.reduce((s, r) => s + r.value, 0)).toBe(chart.total);
    expect(chart.rows[0]).toMatchObject({ label: "Tuition", value: 970_000 });
    expect(chartReading(chart)).toBe("PHP 19,600.00 is still to come: PHP 16,700.00 in plans (PHP 14,700.00 of it with no date yet), PHP 1,400.00 of bills and subscriptions this month, PHP 1,000.00 still held in allocations, PHP 500.00 of debt payments due. Tuition is the largest, PHP 9,700.00.");
    expect(chartInWords(chart)).toMatch(/Still to come PHP 19,600\.00\.$/);
    expect(buildUpcomingChart(u, true)!.kind).toBe("pie");
  });

  it("says nothing is to come when nothing is, and draws nothing", () => {
    const none = upcomingOf({ views: [], bills: null, allocations: null, debts: [] });
    expect(upcomingWords(none, ASOF, null)).toMatch(/^Nothing is still to come/);
    expect(buildUpcomingChart(none)).toBeNull();
  });
});
