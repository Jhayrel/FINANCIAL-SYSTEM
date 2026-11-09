/**
 * The budget in a statement (owner, 9 November 2026), on invented rows: the
 * Budget screen's figures, on the statements it belongs in, in the
 * spreadsheet and changing nothing above it.
 */
import { describe, expect, it } from "vitest";

import { makeAllocation } from "./monthAllocation";
import { budgetCsvRows, hasBudget, statementBudget } from "./statementBudget";
import type { Budgets, Transaction } from "./types";

let n = 0;
const row = (date: string, item: string, amount: number, over: Partial<Transaction> = {}): Transaction =>
  ({ id: `t${(n += 1)}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description: "", amount, fee: 0, total: amount, notes: "", status: "Paid", ...over }) as Transaction;
const twelve = (i: number, v: number): number[] => Array.from({ length: 12 }, (_, k) => (k === i ? v : 0));
const budgets = {
  "2026": { spending: twelve(9, 1_000_000).map((v, k) => (k === 10 ? 1_200_000 : v)), billsSubs: twelve(10, 200_000), categories: { Food: twelve(10, 300_000) } },
} as unknown as Budgets;
const rows = [
  row("2026-10-05", "Food", 400_000),
  row("2026-11-02", "Food", 350_000),
  row("2026-11-03", "Gas", 30_000),
  row("2026-11-04", "Globe", 99_900, { category: "Bills" }),
  row("2026-11-20", "Food", 10_000),
];
const gas = makeAllocation({ kind: "Gas", amount: null, each: 30_000, times: 4, per: "week" }, "2026-11", "2026-11-01", "g");

describe("the budget in a statement", () => {
  it("belongs in the account, expense and bills statements only", () => {
    expect(["account", "expense", "bills"].every((t) => hasBudget(t as never))).toBe(true);
    expect(["revenue", "wallet", "transfers", "debt", "plans"].some((t) => hasBudget(t as never))).toBe(false);
    expect(statementBudget("revenue", rows, budgets, "2026-10-01", "2026-11-30")).toBeNull();
  });

  it("each month's two tracks, limits and allocations, as Budget has them", () => {
    const b = statementBudget("account", rows, budgets, "2026-10-01", "2026-11-09", [gas], "2026-11-09")!;
    expect(b.months.map((m) => m.label)).toEqual(["October 2026", "November 2026"]);
    const oct = b.months[0]!.parts;
    expect(oct.find((p) => p.kind === "spending")).toMatchObject({ budget: 1_000_000, spent: 400_000, left: 600_000 });
    expect(oct.find((p) => p.kind === "bills")).toMatchObject({ budget: 0, left: null });
    const nov = b.months[1]!;
    expect(nov.partial).toBe(true);
    // Nothing after the statement's last day: the ₱100.00 of food on the 20th is not in it.
    expect(nov.parts.find((p) => p.kind === "spending")).toMatchObject({ budget: 1_200_000, spent: 380_000 });
    expect(nov.parts.find((p) => p.kind === "bills")).toMatchObject({ budget: 200_000, spent: 99_900, left: 100_100 });
    expect(nov.parts.find((p) => p.label === "Limit: Food")).toMatchObject({ budget: 300_000, spent: 350_000, left: -50_000 });
    expect(nov.parts.find((p) => p.label === "Allocation: Gas")).toMatchObject({ budget: 120_000, spent: 30_000, left: 90_000 });
    expect(b.totals.find((p) => p.kind === "spending")).toMatchObject({ budget: 2_200_000, spent: 780_000 });
    expect(b.notes.join(" ")).toContain("November 2026 is counted up to November 9, 2026");
  });

  it("the expense sheet has both tracks, which add up to its total; bills and subscriptions keep only theirs", () => {
    const b = statementBudget("expense", rows, budgets, "2026-11-01", "2026-11-30")!;
    const spent = b.months[0]!.parts.filter((p) => p.kind === "spending" || p.kind === "bills").reduce((t, p) => t + p.spent, 0);
    expect(spent).toBe(350_000 + 30_000 + 99_900 + 10_000);
    expect(statementBudget("bills", rows, budgets, "2026-11-01", "2026-11-30")!.months[0]!.parts.map((p) => p.kind)).toEqual(["bills"]);
  });

  it("in the spreadsheet, under the entries", () => {
    const csv = budgetCsvRows(statementBudget("bills", rows, budgets, "2026-11-01", "2026-11-30")!, (c) => (c / 100).toFixed(2));
    expect(csv).toContainEqual(["Month", "Part", "Budget", "Spent", "Left"]);
    expect(csv).toContainEqual(["November 2026", "Bills and subscriptions", "2000.00", "999.00", "1001.00"]);
  });

  it("says when nothing was set, and never an em dash", () => {
    const none = statementBudget("account", rows, {}, "2026-11-01", "2026-11-30")!;
    expect(none.notes).toContain("No budget was set for these months. Set one on Budget.");
    expect(JSON.stringify(none).includes(String.fromCharCode(0x2014))).toBe(false);
  });
});
