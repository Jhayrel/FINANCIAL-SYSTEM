/**
 * Borrowed money, followed through the owner's accounts. Every case is the
 * owner's own, 7 October 2026, or one of the questions they asked with it.
 * Every figure is invented.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { borrowedMoney, lenderNames } from "./borrowed";
import type { Debt } from "./debt";
import type { Transaction } from "./types";

const credit: Debt = {
  id: "maya-credit", name: "Maya Credit", kind: "payable", counterparty: "Maya", openedDate: "2026-01-01",
  wallet: "Maya", interestType: "none", interestRate: 0, notes: "", archived: false,
} as Debt;
const loan: Debt = { ...credit, id: "home", name: "Home loan", counterparty: "Tita" } as Debt;
const funeral: Debt = { ...credit, id: "joan", name: "Tita Joan", form: "pass-through", counterparty: "Tita Joan" } as Debt;
const debts = [credit, loan, funeral];
const ACCOUNTS = ["Cash", "Maya", "Gcash", "Savings"];

let n = 0;
const row = (date: string, over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  return {
    id: `r${n}`, recordNumber: n, date, type: "Spending", fromWallet: "", toWallet: "", category: "Spending", item: "Treat",
    description: "", amount, fee: 0, total: amount + (over.fee ?? 0), notes: "", status: "Paid", ...over,
  } as Transaction;
};
const income = (date: string, to: string, amount: number) => row(date, { type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: to, amount, total: amount, status: "Received" });
const draw = (date: string, to: string, amount: number, debtId = "maya-credit") => row(date, { type: "Debt", category: "", item: "", toWallet: to, amount, total: amount, debtId, debtEffect: "draw" });
const repay = (date: string, from: string, amount: number, debtId = "maya-credit") => row(date, { type: "Debt", category: "", item: "", fromWallet: from, amount, total: amount, debtId, debtEffect: "repay" });
const spend = (date: string, from: string, amount: number, item = "Treat") => row(date, { fromWallet: from, amount, total: amount, item });
const move = (date: string, from: string, to: string, amount: number, fee = 0) => row(date, { type: "Transfer", category: "Transfer", item: "Transaction Fee", fromWallet: from, toWallet: to, amount, fee, total: amount + fee });

const of = (rows: Transaction[]) => borrowedMoney(rows, debts, ACCOUNTS);

describe("the owner's example", () => {
  it("knows the 1000 withdrawn into Cash is credit and the 500 already there is theirs", () => {
    const rows = [income("2026-10-01", "Cash", 50000), draw("2026-10-02", "Maya", 500000), move("2026-10-03", "Maya", "Cash", 100000)];
    const b = of(rows);
    expect(walletBalance(rows, "Cash")).toBe(150000);
    expect(b.byAccount.get("Cash")).toBe(100000);
    expect(b.byAccount.get("Maya")).toBe(400000);
    expect(b.inHand).toBe(500000);
    expect(b.own).toBe(50000);
  });

  it("spends their own money first, then says how much of a treat was borrowed", () => {
    const rows = [income("2026-10-01", "Cash", 50000), draw("2026-10-02", "Maya", 500000), move("2026-10-03", "Maya", "Cash", 100000)];
    const treat = spend("2026-10-04", "Cash", 120000);
    const b = of([...rows, treat]);
    expect(b.spent.get(treat.id)?.amount).toBe(70000);
    expect(lenderNames(b.spent.get(treat.id)!.from, debts)).toBe("Maya Credit");
    expect(b.own).toBe(0);
    expect(b.inHand).toBe(430000);
  });

  it("starts from nothing: everything spent after borrowing is borrowed", () => {
    const treat = spend("2026-10-02", "Maya", 30000);
    const b = of([draw("2026-10-01", "Maya", 500000), treat]);
    expect(b.spent.get(treat.id)?.amount).toBe(30000);
  });

  it("says nothing of a purchase their own money covered", () => {
    const lunch = spend("2026-10-03", "Cash", 20000, "Food");
    const b = of([income("2026-10-01", "Cash", 50000), draw("2026-10-02", "Maya", 500000), lunch]);
    expect(b.spent.has(lunch.id)).toBe(false);
  });
});

describe("the questions they asked with it", () => {
  it("a loan and income on the same day: both arrive first, and the spending is theirs first", () => {
    const treat = spend("2026-10-05", "Maya", 150000);
    // Recorded in the order the owner typed them: the spending first.
    const b = of([treat, draw("2026-10-05", "Maya", 500000), income("2026-10-05", "Maya", 200000)]);
    expect(b.spent.get(treat.id)).toBeUndefined();
    expect(b.own).toBe(50000);
    expect(b.inHand).toBe(500000);
  });

  it("a loan paid back later the same day leaves no borrowed money", () => {
    const b = of([draw("2026-10-05", "Maya", 500000), repay("2026-10-05", "Maya", 500000)]);
    expect(b.inHand).toBe(0);
    expect(b.held).toBe(0);
  });

  it("a repayment from another account still lowers what is borrowed in hand", () => {
    const rows = [income("2026-10-01", "Gcash", 300000), draw("2026-10-02", "Maya", 500000), repay("2026-10-03", "Gcash", 200000)];
    const b = of(rows);
    expect(b.inHand).toBe(300000);
    expect(b.byAccount.get("Maya")).toBe(300000);
    expect(b.own).toBe(300000);
  });

  it("repaying one lender uses that lender's money first", () => {
    const rows = [draw("2026-10-01", "Maya", 300000, "home"), draw("2026-10-02", "Maya", 200000), repay("2026-10-03", "Maya", 200000)];
    const b = of(rows);
    expect(b.byLender.get("home")).toBe(300000);
    expect(b.byLender.get("maya-credit")).toBeUndefined();
    expect(b.own).toBe(0);
  });

  it("a transfer fee is paid from their own money first", () => {
    const rows = [income("2026-10-01", "Maya", 1000), draw("2026-10-02", "Maya", 100000), move("2026-10-03", "Maya", "Cash", 100000, 1000)];
    const b = of(rows);
    expect(b.byAccount.get("Cash")).toBe(100000);
    expect(b.byAccount.get("Maya")).toBeUndefined();
  });

  it("money held for someone is never their own, and is used last", () => {
    const rows = [draw("2026-10-01", "Gcash", 2500000, "joan"), income("2026-10-01", "Gcash", 10000)];
    const lunch = spend("2026-10-02", "Gcash", 30000, "Food");
    const b = of([...rows, lunch]);
    expect(b.heldForOthers).toBe(2480000);
    expect(b.spentHeld.get(lunch.id)?.amount).toBe(20000);
    expect(b.own).toBe(0);
  });

  it("never counts more borrowed in an account than it holds", () => {
    const b = of([draw("2026-10-01", "Maya", 100000), spend("2026-10-02", "Maya", 150000)]);
    expect(b.inHand).toBe(0);
  });

  it("money sent away to someone counts its borrowed part as spent", () => {
    const send = row("2026-10-02", { type: "Transfer", category: "Transfer", item: "Money Send", fromWallet: "Maya", toWallet: "", amount: 50000, total: 50000 });
    const b = of([draw("2026-10-01", "Maya", 100000), send]);
    expect(b.spent.get(send.id)?.amount).toBe(50000);
  });
});

describe("what the alerts say", () => {
  it("names the wants borrowed money paid for this month, and what is borrowed in hand", async () => {
    const { financeAlerts } = await import("./alerts");
    const accounts = ACCOUNTS.map((name) => ({ id: name, name, kind: "spending" as const, archived: false }));
    const rows = [income("2026-10-01", "Cash", 50000), draw("2026-10-02", "Maya", 500000), move("2026-10-03", "Maya", "Cash", 100000), spend("2026-10-04", "Cash", 120000)];
    const alerts = financeAlerts({ transactions: rows, accounts, budgets: {}, debts, bills: [], lowBalanceThreshold: 0, asOf: "2026-10-06", spendingTypes: [{ name: "Treat", necessity: "discretionary" }] } as never);
    const wants = alerts.find((a) => a.id === "borrowed-wants-2026-10");
    expect(wants?.title).toBe("₱700.00 of borrowed money went to wants this month");
    expect(wants?.detail).toContain("Treat ₱700.00, from Maya Credit");
    expect(alerts.find((a) => a.id === "borrowed-in-hand")?.title).toBe("₱4,300.00 of your money is borrowed");
  });

  it("says a kind is past its limit, outside the Budget screen too", async () => {
    const { financeAlerts } = await import("./alerts");
    const set = { "2026": { spending: Array(12).fill(0), billsSubs: Array(12).fill(0), categories: { Treat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 100000, 0, 0] } } };
    const alerts = financeAlerts({ transactions: [spend("2026-10-04", "Cash", 120000)], accounts: [], budgets: set, debts: [], bills: [], lowBalanceThreshold: 0, asOf: "2026-10-06" } as never);
    expect(alerts.find((a) => a.id === "limit-over-treat")?.detail).toBe("₱1,200.00 of the ₱1,000.00 limit for October: ₱200.00 over, with 26 days left.");
  });
});

describe("asking before spending", () => {
  it("says how much of a purchase would be borrowed money", async () => {
    const { affordAnswer, readAffordAsk } = await import("./affordAsk");
    const reference = { wallets: ["Cash", "Maya"], savings: [], bills: [], subscriptions: [], revenueCategories: ["Allowance"], spendingTypes: [{ name: "Treat", remark: "" }] };
    const rows = [income("2026-10-01", "Cash", 50000), draw("2026-10-02", "Maya", 500000), move("2026-10-03", "Maya", "Cash", 100000)];
    const input = { transactions: rows, reference, budgets: {}, debts, asOf: "2026-10-06" };
    const text = affordAnswer(readAffordAsk("can I spend 1200 on a treat", rows, reference, "2026-10-06"), input);
    expect(text).toContain("But only ₱500.00 of what your spending wallets hold is your own: ₱700.00 of this would be borrowed money, from Maya Credit.");
    const small = affordAnswer(readAffordAsk("can I spend 300 on a treat", rows, reference, "2026-10-06"), input);
    expect(small).toContain("It is covered by your own money, ₱500.00, without touching what you borrowed.");
  });
});
