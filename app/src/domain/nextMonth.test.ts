/**
 * Safe to spend on the first of next month (`nextMonthStart`).
 *
 * The owner, 25 October 2026: "what happens to the available to spend if
 * the next month sets in??". Nothing resets: what is left carries over, less
 * the new month's bills, spread over all its days.
 */
import { describe, expect, it } from "vitest";

import { monthBrief, nextMonthStart } from "./monthPlan";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash"],
  savings: [],
  bills: ["Rent"],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  return {
    id: `r${n}`, recordNumber: n, date: "2026-09-01", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending",
    item: "Food", description: "", fee: 0, notes: "", status: "Paid", ...over, amount, total: amount + (over.fee ?? 0),
  };
};

const income = row({ date: "2026-09-01", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 2000000 });
const rentSep = row({ date: "2026-09-20", category: "Bills", item: "Rent", amount: 300000 });
const rentOct = row({ date: "2026-10-20", category: "Bills", item: "Rent", amount: 300000 });
const food = row({ date: "2026-10-05", amount: 100000 });

const start = (transactions: Transaction[], asOf: string) => {
  const input = { transactions, reference, budgets: {}, debts: [], asOf };
  const now = monthBrief({ ...input, year: Number(asOf.slice(0, 4)), month: Number(asOf.slice(5, 7)) }).safe;
  if (!now) throw new Error("no safe figure this month");
  return { now, next: nextMonthStart(input, now) };
};

describe("safe to spend when the next month starts", () => {
  it("carries what is left over, less the new month's bills, over all its days", () => {
    const { now, next } = start([income, rentSep, rentOct, food], "2026-10-25");
    expect(now.free).toBe(1300000);
    expect(next).toMatchObject({ year: 2026, month: 11, first: "2026-11-01", days: 30, carried: 1300000, reservedBills: 300000, reservedDebt: 0, safe: 1000000 });
    // Rounded down: a day never promises a centavo that is not there.
    expect(next.perDay).toBe(33333);
  });

  it("counts a bill still unpaid this month here and again next month: two payments", () => {
    const { now, next } = start([income, rentSep, food], "2026-10-25");
    expect(now.reservedBills).toBe(300000);
    expect(now.free).toBe(1300000);
    expect(next.reservedBills).toBe(300000);
    expect(next.safe).toBe(1000000);
  });

  it("goes from December to January", () => {
    const dec = [income, row({ date: "2026-12-02", category: "Bills", item: "Rent", amount: 300000 })];
    const { next } = start(dec, "2026-12-28");
    expect(next).toMatchObject({ year: 2027, month: 1, first: "2027-01-01", days: 31 });
  });

  it("never goes below zero, and carries a shortfall rather than hiding it", () => {
    const thin = [row({ date: "2026-09-01", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 400000 }), rentSep];
    const { now, next } = start(thin, "2026-10-25");
    expect(now.free).toBe(-200000);
    expect(next.carried).toBe(-200000);
    expect(next.safe).toBe(0);
    expect(next.perDay).toBe(0);
  });
});
