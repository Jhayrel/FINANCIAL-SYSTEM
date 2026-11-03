/** Charts said as a wish, kinds as categories, and a folded pie read honestly (3 November 2026). Invented rows. */
import { describe, expect, it } from "vitest";

import { chartReading, localHint, measureOf } from "./chartAsk";
import { buildChart, drawReply, type Chart } from "./charts";
import type { Transaction } from "./types";

const row = (n: number, date: string, item: string, amount: number): Transaction =>
  ({ id: `t${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: item === "Wifi" ? "Bills" : "Spending", item, description: "", amount, fee: 0, total: amount, notes: "", status: "Paid" }) as Transaction;
const rows = [row(1, "2026-10-02", "Travel", 500_000), row(2, "2026-10-05", "Food", 300_000), row(3, "2026-10-09", "Wifi", 99_900), row(4, "2026-10-20", "Treat", 100_000)];

describe("charts after a breakdown", () => {
  it("'I want pie', 'can I see a pie', 'gusto ko pie' are asks to draw", () => {
    expect(drawReply("I want pie")).toBe("pie");
    expect(drawReply("can i see a pie")).toBe("pie");
    expect(drawReply("gusto ko pie")).toBe("pie");
    expect(drawReply("I want to buy a pie")).toBeNull();
  });

  it("'expenses based on categories' is by kind, as the breakdown lists them; the three groups only by name", () => {
    const kinds = buildChart("break down of expenses based on categories last month as a pie", rows, "2026-11-03");
    expect(kinds?.rows.map((r) => r.label)).toEqual(["Travel", "Food", "Treat", "Wifi"]);
    const groups = buildChart("spending, bills and subscriptions last month as a pie", rows, "2026-11-03");
    expect(groups?.rows.map((r) => r.label).sort()).toEqual(["Bills", "Spending"]);
  });

  it("a pie of months folded into 'Other months' names no lowest month it cannot see", () => {
    const chart = { title: "Spending by month, 2026", by: "month", kind: "pie", total: 1_000_000, direction: "spending", othersCount: 0, rows: [
      { label: "February 2026", value: 300_000, share: 1, count: 3 },
      { label: "May 2026", value: 400_000, share: 1, count: 4 },
      { label: "Other months", value: 300_000, share: 0.75, count: 9 },
    ] } as unknown as Chart;
    const words = chartReading(chart);
    expect(words).toBe("The 2 largest months have slices of their own. May 2026 is the largest, PHP 4,000.00, 40% of the PHP 10,000.00 total. The other months together are PHP 3,000.00.");
    expect(words).not.toMatch(/lowest|Other months is/);
  });

  it("'so I can do Budgeting' is why it was asked, not a budget chart; 'against the budget' still is (4 November 2026)", () => {
    expect(measureOf(localHint("Can you give me a break down of expenses based on categories so I can do Budgeting last month chart"))).toBeNull();
    expect(measureOf(localHint("breakdown by category for budgeting, as a chart"))).toBeNull();
    expect(measureOf(localHint("chart my spending against the budget last month"))).toBe("budget");
    expect(measureOf(localHint("show my budget vs actual each month"))).toBe("budget");
  });
});

