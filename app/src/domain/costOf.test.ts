/**
 * The one spending definition.
 *
 * `costOf` gives one row's contribution and `totalsFor` gives a month split.
 * Anything that breaks them apart makes two screens disagree about the year,
 * which is exactly how the chart over-counted 2026 by PHP 13,128.00 before
 * this file existed.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { costOf, inMonth, totalSpending, totalsFor } from "./totals";

const fx = loadFixture();

describe("costOf agrees with totalsFor", () => {
  it("sums to the same figure over the whole ledger", () => {
    const summed = fx.transactions.reduce((total, t) => total + costOf(t), 0);
    expect(summed).toBe(totalsFor(fx.transactions).total);
  });

  it("agrees for every month of 2026, one at a time", () => {
    for (let month = 1; month <= 12; month++) {
      const rows = inMonth(fx.transactions, 2026, month);
      const summed = rows.reduce((total, t) => total + costOf(t), 0);
      expect(summed, `2026-${String(month).padStart(2, "0")}`).toBe(totalsFor(rows).total);
    }
  });

  it("agrees for an arbitrary window, which is what a chart draws", () => {
    const window = fx.transactions.filter((t) => t.date >= "2026-05-01" && t.date <= "2026-07-31");
    const summed = window.reduce((total, t) => total + costOf(t), 0);
    expect(summed).toBe(totalsFor(window).total);
  });

  /**
   * Deliberately not `totalSpending`.
   *
   * That is the workbook's headline figure and counts only plain Spending
   * plus transfers: bills, subscriptions and debt interest are its separate
   * lines. `totalsFor(...).total` is everything a month cost, which is what a
   * breakdown of a month has to add up to. The two answering different
   * questions is correct; a chart silently answering the wrong one is not.
   */
  it("is the whole cost of a month, not the workbook headline", () => {
    const august = inMonth(fx.transactions, 2026, 8);
    const summed = august.reduce((total, t) => total + costOf(t), 0);
    expect(summed).toBe(totalsFor(august).total);
    expect(summed).toBeGreaterThan(totalSpending(august));
  });
});

describe("costOf, row by row", () => {
  const row = (over: Record<string, unknown>) =>
    ({
      id: "t-1",
      recordNumber: 1,
      date: "2026-08-01",
      type: "Spending",
      fromWallet: "Cash",
      toWallet: "",
      category: "Spending",
      item: "Food",
      description: "",
      amount: 10000,
      fee: 0,
      total: 10000,
      notes: "",
      status: "Paid",
      ...over,
    }) as Parameters<typeof costOf>[0];

  it("counts a spend, a bill and a subscription", () => {
    expect(costOf(row({}))).toBe(10000);
    expect(costOf(row({ category: "Bills" }))).toBe(10000);
    expect(costOf(row({ category: "Subscriptions" }))).toBe(10000);
  });

  /** The bug: a Spending row with no category was being counted. */
  it("does not count a Spending row with no category", () => {
    expect(costOf(row({ category: "" }))).toBe(0);
  });

  it("counts a transfer out in full, and one between your own as its fee", () => {
    const base = { type: "Transfer", category: "Transfer", amount: 100000, fee: 1500, total: 101500 };
    expect(costOf(row({ ...base, toWallet: "" }))).toBe(101500);
    expect(costOf(row({ ...base, toWallet: "Gcash" }))).toBe(1500);
  });

  it("counts debt interest and fees, and not principal", () => {
    const base = { type: "Debt", category: "", debtId: "d1", amount: 5000, total: 5000 };
    expect(costOf(row({ ...base, debtEffect: "interest" }))).toBe(5000);
    expect(costOf(row({ ...base, debtEffect: "fee" }))).toBe(5000);
    expect(costOf(row({ ...base, debtEffect: "repay" }))).toBe(0);
    expect(costOf(row({ ...base, debtEffect: "draw" }))).toBe(0);
  });

  it("never counts income", () => {
    expect(costOf(row({ type: "Revenue", category: "Revenue", toWallet: "Maya" }))).toBe(0);
  });
});
