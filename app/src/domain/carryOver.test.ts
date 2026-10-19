import { describe, expect, it } from "vitest";

import { formatMoney } from "./money";
import { carryOver, carryWords, monthBrief, yesterdayOf } from "./monthPlan";
import { asksCarryOver, asksSafeToSpend } from "./safeAsk";
import { looksLikeAnswer } from "./cardQuestions";
import type { Budgets, ReferenceLists, Transaction } from "./types";

/*
 * 15 October 2026: "I didn't spend yesterday, should it be 72?" Unspent money
 * is spread over the days left, and the owner may use it today instead: both
 * are worked out and said. Figures invented.
 */
let n = 0;
const row = (date: string, o: Partial<Transaction>): Transaction =>
  ({ id: `c${(n += 1)}`, recordNumber: n, date, type: "Spending", category: "Spending", item: "Food", fromWallet: "", toWallet: "", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "", ...o }) as Transaction;
const reference = { wallets: ["Cash"], savings: [], bills: [], subscriptions: [], revenueCategories: ["Allowance"], spendingTypes: ["Food"], stopped: [] } as unknown as ReferenceLists;
const rows = [row("2026-01-01", { type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Cash", amount: 31000, total: 31000 })];
const on = (asOf: string, ledger: Transaction[]) => {
  const input = { transactions: ledger, reference, budgets: {} as Budgets, debts: [], year: 2026, month: 1, asOf };
  return { safe: monthBrief(input).safe!, yesterday: yesterdayOf(input) };
};

describe("safe to spend carries over", () => {
  it("spreads yesterday's unspent share over the days left, and says what using it today leaves", () => {
    // ₱310.00 on 1 January: ₱10.00 a day. Nothing spent on 1 January.
    const { safe, yesterday } = on("2026-01-02", rows);
    expect(yesterday).toEqual({ date: "2026-01-01", share: 1000, spent: 0, unspent: 1000 });
    expect(safe.perDay).toBe(1033);
    const c = carryOver(safe, yesterday)!;
    expect(c.todayHadItGone).toBe(1000);
    expect(c.useToday).toBe(2033);
    expect(c.afterUse).toBe(Math.floor((31000 - 2033) / 29));
    const words = carryWords(safe, yesterday, formatMoney).join(" ");
    expect(words).toContain("₱10.00 carried over");
    expect(words).toContain("today is ₱10.33 instead of ₱10.00");
    expect(words).toContain("up to ₱20.33 today");
  });

  it("says a day that went past its share is taken from every day left", () => {
    const { safe, yesterday } = on("2026-01-02", [...rows, row("2026-01-01", { fromWallet: "Cash", amount: 3000, total: 3000 })]);
    expect(yesterday?.unspent).toBe(-2000);
    expect(carryOver(safe, yesterday)).toBeNull();
    expect(carryWords(safe, yesterday, formatMoney)[0]).toContain("₱20.00 past its share of ₱10.00");
  });

  it("has no yesterday on the month's first day", () => {
    expect(on("2026-01-01", rows).yesterday).toBeNull();
  });

  it("reads the owner's ways of asking, and never takes them as a card's answer", () => {
    for (const q of ["but look I havent spend yesterday", "should it be 72? like I have not spend yesterday", "if I don't spend today does it add tomorrow", "does the unspent money go to tomorrow"]) {
      expect(asksCarryOver(q), q).toBe(true);
      expect(asksSafeToSpend(q), q).toBe(true);
      expect(looksLikeAnswer(q, "item"), q).toBe(false);
    }
    expect(asksCarryOver("Framelink Media")).toBe(false);
    expect(looksLikeAnswer("Framelink Media", "item")).toBe(true);
  });
});
