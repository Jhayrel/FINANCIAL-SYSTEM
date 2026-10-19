import { describe, expect, it } from "vitest";

import { buildChart } from "./charts";
import type { Transaction } from "./types";

/* 19 October 2026: "Pie of food" drew a month of days; a one-item pie was one slice at 100%. */
let n = 0;
const row = (date: string, o: Partial<Transaction>): Transaction =>
  ({ id: `p${(n += 1)}`, recordNumber: n, date, type: "Spending", category: "Spending", item: "Food", fromWallet: "Cash", toWallet: "", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "", ...o }) as Transaction;
const rows = [
  row("2026-01-02", { amount: 10000, total: 10000 }),
  row("2026-01-09", { amount: 20000, total: 20000 }),
  row("2026-01-20", { amount: 5000, total: 5000 }),
  row("2026-01-21", { item: "Gas", amount: 5000, total: 5000 }),
  row("2025-06-01", { type: "Revenue", category: "Revenue", item: "Client", fromWallet: "", toWallet: "Cash", amount: 50000, total: 50000 }),
  row("2026-01-05", { type: "Revenue", category: "Revenue", item: "Client", fromWallet: "", toWallet: "Cash", amount: 90000, total: 90000 }),
];

describe("a pie is parts", () => {
  it("splits one item's month by week, with no empty slices", () => {
    const chart = buildChart("pie of food", rows, "2026-01-25")!;
    expect(chart.by).toBe("week");
    expect(chart.total).toBe(35000);
    expect(chart.rows.every((r) => r.value > 0)).toBe(true);
  });
  it("splits a one-slice pie by when the money came", () => {
    const chart = buildChart("income from client all time as a pie", rows, "2026-01-25", "revenue")!;
    expect(chart.by).not.toBe("item");
    expect(chart.rows.length).toBeGreaterThan(1);
  });
});
