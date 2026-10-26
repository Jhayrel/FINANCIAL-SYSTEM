/**
 * Safe to spend on the first of next month (`nextMonthStart`).
 *
 * The owner, 25 October 2026: "what happens to the available to spend if
 * the next month sets in??". Nothing resets: what is left carries over, less
 * the new month's bills, spread over all its days.
 */
import { describe, expect, it } from "vitest";

import { budgetBeyondMoney, monthBrief, nextMonthStart } from "./monthPlan";
import { asksNextMonth, nextMonthWords } from "./safeAsk";
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

describe("asked in the chat", () => {
  it("knows the question, in the owner's words or by the month's name", () => {
    expect(asksNextMonth("what happen to the available to spend if the next month sets in??", "2026-10-25")).toBe(true);
    expect(asksNextMonth("what happens to my safe to spend when november starts?", "2026-10-25")).toBe(true);
    expect(asksNextMonth("how much can I spend today?", "2026-10-25")).toBe(false);
    expect(asksNextMonth("how much did I spend in november 2025?", "2026-10-25")).toBe(false);
    expect(asksNextMonth("safe to spend when january comes?", "2026-12-28")).toBe(true);
  });

  it("says nothing resets, and the figure from the 1st", () => {
    const { next } = start([income, rentSep, rentOct, food], "2026-10-25");
    expect(nextMonthWords(next)).toBe(
      "**From 1 November: ₱333.33 a day** for 30 days, if nothing more is spent and nothing comes in before then. Nothing resets on the 1st: the ₱13,000.00 not spent now carries over, less November's bills and subscriptions (₱3,000.00), leaving ₱10,000.00 safe for the month. Money that comes in before then raises it.",
    );
  });

  it("says when next month's bills take all of it", () => {
    const thin = [row({ date: "2026-09-01", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 500000 }), rentSep, rentOct];
    const { next } = start(thin, "2026-10-25");
    expect(nextMonthWords(next)).toContain("**From 1 November: ₱0.00 a day** until money comes in.");
    expect(nextMonthWords(next)).toContain("Nothing resets on the 1st, and nothing is left over now for November's bills and subscriptions (₱3,000.00).");
  });
});

describe("the budget promising more than the money", () => {
  it("is said only when it is more than a day's share (26 October 2026: PHP 14.61 under a PHP 116.80 day)", () => {
    expect(budgetBeyondMoney({ safe: 70085, budgetLeft: 71546, wallets: 70085, todayShare: 11680 })).toBe(0);
    expect(budgetBeyondMoney({ safe: 70085, budgetLeft: 90000, wallets: 70085, todayShare: 11680 })).toBe(19915);
    expect(budgetBeyondMoney({ safe: 0, budgetLeft: 500, wallets: 0, todayShare: 0 })).toBe(500);
    expect(budgetBeyondMoney({ safe: 70085, budgetLeft: null, wallets: 70085, todayShare: 11680 })).toBe(0);
  });
});

describe("the bell, when next month's bills need more than is left (26 October 2026)", () => {
  it("says by how much, and is silent when the money covers them", async () => {
    const { financeAlerts } = await import("./alerts");
    const thin = [row({ date: "2026-09-01", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 700000 }), rentSep, rentOct];
    const { now, next } = start(thin, "2026-10-25");
    const base = { transactions: thin, accounts: [], budgets: {}, debts: [], bills: [], lowBalanceThreshold: 0, asOf: "2026-10-25", safe: now };
    const short = financeAlerts({ ...base, next }).find((a) => a.id.startsWith("next-month-short"));
    expect(short?.title).toBe("November's bills need ₱2,000.00 more than is left");
    expect(short?.detail).toContain("Until money comes in, November starts at ₱0.00 a day.");
    const { now: rich, next: fine } = start([income, rentSep, rentOct, food], "2026-10-25");
    expect(financeAlerts({ ...base, safe: rich, next: fine }).some((a) => a.id.startsWith("next-month-short"))).toBe(false);
  });
});
