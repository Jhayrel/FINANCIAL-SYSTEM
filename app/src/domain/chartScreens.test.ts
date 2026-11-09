/**
 * Every chart agrees with the screens (owner, 9 November 2026: "fix all
 * charts and calculation make it accurate like dashboard and insight"). On
 * an invented ledger with every kind of row: a fee, money sent away, a
 * withdrawal, a bill, a write-off let go, an entry over several days, an
 * opening balance and income. Each chart's figure is the one Budget,
 * Insights and the month totals give for the same thing.
 */
import { describe, expect, it } from "vitest";

import { assessMonth, budgetForMonth } from "./budget";
import { buildChart } from "./charts";
import { spreadCovered } from "./covers";
import { trendOf } from "./insightWindow";
import { incomeOf, monthTotals } from "./totals";
import type { Transaction } from "./types";

let n = 0;
const t = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 10_000;
  const fee = over.fee ?? 0;
  return { id: `t${n}`, recordNumber: n, date: "2026-10-05", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", notes: "", status: "Paid", ...over, amount, fee, total: amount + fee } as Transaction;
};
const ledger = spreadCovered([
  t({ date: "2026-09-01", type: "Revenue", category: "Opening", item: "Opening balance", fromWallet: "", toWallet: "Cash", amount: 500_000, status: "Received" }),
  t({ date: "2026-09-02", type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Maya", amount: 800_000, status: "Received" }),
  t({ date: "2026-09-03", item: "Food", amount: 25_000 }),
  t({ date: "2026-09-09", item: "Travel", amount: 90_000, coversTo: "2026-09-11" }),
  t({ date: "2026-09-30", item: "Fun", amount: 30_000, coversTo: "2026-10-01" }),
  t({ date: "2026-10-03", type: "Transfer", category: "Spending", item: "Transaction Fee", fromWallet: "Maya", toWallet: "Cash", amount: 50_000, fee: 1_600, status: "Withdrawn" }),
  t({ date: "2026-10-04", type: "Transfer", category: "Spending", item: "Money Send", fromWallet: "Maya", toWallet: "", amount: 9_900, status: "Transferred" }),
  t({ date: "2026-10-04", type: "Debt", category: "Spending", item: "", fromWallet: "", toWallet: "", amount: 50_000, debtId: "ana", debtEffect: "writeoff", status: "" }),
  t({ date: "2026-10-06", category: "Bills", item: "Globe", fromWallet: "Maya", amount: 99_900 }),
  t({ date: "2026-10-08", item: "Gas", amount: 30_000 }),
  t({ date: "2026-10-12", type: "Revenue", category: "Revenue", item: "Framelink Media", fromWallet: "", toWallet: "Maya", amount: 150_000, status: "Received" }),
]);
const asOf = "2026-10-20";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (label: string): number => MONTHS.findIndex((m) => label.startsWith(m)) + 1;

describe("every chart agrees with the screens", () => {
  it("each month's bar is that month's total, as Budget and Insights have it", () => {
    const c = buildChart("spending by month this year", ledger, asOf, undefined, null, 200)!;
    expect(c.rows.length).toBeGreaterThan(0);
    for (const r of c.rows) expect(r.value).toBe(monthTotals(ledger, 2026, monthOf(r.label)).total);
  });

  it("a month by item, by wallet and Budget's two tracks come to the same total", () => {
    for (const [q, m] of [["spending by item this month", 10], ["spending by item last month", 9]] as const) {
      const total = monthTotals(ledger, 2026, m).total;
      expect(buildChart(q, ledger, asOf, undefined, null, 500)!.total).toBe(total);
      expect(buildChart(q.replace("item", "wallet"), ledger, asOf, undefined, null, 500)!.total).toBe(total);
      expect(assessMonth(monthTotals(ledger, 2026, m), budgetForMonth({}, 2026, m)).combined.spent).toBe(total);
    }
  });

  it("money sent away and a debt let go are spending, under Money Send", () => {
    const oct = buildChart("spending by item this month", ledger, asOf, undefined, null, 500)!;
    expect(oct.rows.find((r) => r.label === "Money Send")?.value).toBe(9_900 + 50_000);
    // A withdrawal is its fee only.
    expect(oct.rows.find((r) => r.label === "Transaction Fee")?.value).toBe(1_600);
  });

  it("income by month leaves the opening balance out", () => {
    const c = buildChart("income by month this year", ledger, asOf, "revenue", null, 200)!;
    for (const r of c.rows) {
      const m = String(monthOf(r.label)).padStart(2, "0");
      expect(r.value).toBe(ledger.filter((x) => x.date.slice(0, 7) === `2026-${m}`).reduce((s, x) => s + incomeOf(x), 0));
    }
    expect(c.rows.find((r) => r.label.startsWith("September"))?.value).toBe(800_000);
  });

  it("day by day, as Insights' calendar has it, an entry over several days a share each day", () => {
    const c = buildChart("spending by day last month", ledger, asOf, undefined, null, 200)!;
    const trend = trendOf(ledger, { start: "2026-09-01", end: "2026-09-30" }, "day");
    for (const r of c.rows) {
      const day = Number(r.label.replace(/\D+/g, ""));
      expect(r.value).toBe(trend.find((p) => Number(p.start.slice(8, 10)) === day)?.spent ?? 0);
    }
    expect(c.total).toBe(monthTotals(ledger, 2026, 9).total);
  });
});
