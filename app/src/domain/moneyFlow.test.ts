/**
 * Where the money came from and went (`moneyFlow.ts`).
 *
 * 28 September 2026: the model said September's income came from three rows
 * that added up to PHP 15,020.25 of PHP 21,791.45, and that there were no
 * credit entries beside two Maya Credit draws. The app now works the flow
 * out, and these pin that its parts add up and its end is the balance.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import type { Debt } from "./debt";
import { moneyFlow } from "./moneyFlow";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `f-${n}`, recordNumber: n, date: "2026-09-05", type: "Spending", fromWallet: "", toWallet: "", category: "Spending", item: "",
    description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Paid", ...over,
  };
};
const debts = [
  { id: "d1", name: "Maya Credit", form: "credit-line", kind: "payable" },
  { id: "d2", name: "Tita's money", form: "pass-through", kind: "payable" },
] as unknown as Debt[];

const ledger: Transaction[] = [
  row({ date: "2026-08-20", type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Cash", amount: 100_000, total: 100_000, status: "Received" }),
  row({ type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Maya", amount: 1_000_000, total: 1_000_000, status: "Received" }),
  row({ type: "Revenue", category: "Revenue", item: "Random", fromWallet: "Cash", amount: 50_000, total: 50_000, status: "Received" }),
  row({ type: "Debt", debtId: "d1", debtEffect: "draw", toWallet: "Maya", amount: 200_000, total: 200_000 } as Partial<Transaction>),
  row({ type: "Debt", debtId: "d2", debtEffect: "draw", toWallet: "Maya", amount: 2_500_000, total: 2_500_000 } as Partial<Transaction>),
  row({ type: "Debt", debtId: "d2", debtEffect: "repay", fromWallet: "Maya", amount: 2_500_000, total: 2_500_000 } as Partial<Transaction>),
  row({ type: "Transfer", category: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 100_000, fee: 1_000, total: 101_000, status: "Transferred" }),
  row({ type: "Transfer", category: "Transfer", fromWallet: "Maya", toWallet: "Savings", amount: 300_000, total: 300_000, status: "Transferred" }),
  row({ type: "Transfer", category: "Transfer", fromWallet: "Savings", toWallet: "Cash", amount: 50_000, total: 50_000, status: "Transferred" }),
  row({ item: "Food", fromWallet: "Cash", amount: 30_000, total: 30_000 }),
  row({ category: "Bills", item: "Wifi", fromWallet: "Maya", amount: 99_900, total: 99_900 }),
  row({ type: "Transfer", category: "Spending", item: "Money Send", fromWallet: "Maya", amount: 100_000, fee: 1_000, total: 101_000, status: "Transferred" }),
  row({ type: "Debt", debtId: "d1", debtEffect: "repay", fromWallet: "Maya", amount: 150_000, total: 150_000 } as Partial<Transaction>),
  row({ type: "Debt", debtId: "d1", debtEffect: "interest", fromWallet: "Maya", amount: 10_000, total: 10_000 } as Partial<Transaction>),
  row({ type: "Revenue", category: "Revenue", item: "Bank interest", toWallet: "Savings", amount: 500, total: 500, status: "Received" }),
];

describe("where the money came from and went", () => {
  const flow = moneyFlow(ledger, ["Cash", "Maya"], "2026-09-01", "2026-09-30", debts);
  const group = (side: "moneyIn" | "moneyOut", title: string) => flow[side].find((g) => g.title === title);

  it("adds up: the start, plus what came in, less what went out, is the balance", () => {
    expect(flow.start).toBe(100_000);
    expect(flow.end).toBe(flow.start + flow.totalIn - flow.totalOut);
    expect(flow.end).toBe(walletBalance(ledger, "Cash") + walletBalance(ledger, "Maya"));
  });

  it("names every source, and never calls borrowing or held money income", () => {
    expect(group("moneyIn", "Income")?.total).toBe(1_050_000);
    expect(group("moneyIn", "Borrowed")?.lines[0]).toMatchObject({ name: "Borrowed on Maya Credit", amount: 200_000 });
    expect(group("moneyIn", "Held for someone else")?.total).toBe(2_500_000);
    expect(group("moneyIn", "Brought out of savings or reserve")?.total).toBe(50_000);
  });

  it("names every way it went", () => {
    expect(group("moneyOut", "Spending")?.total).toBe(30_000);
    expect(group("moneyOut", "Bills")?.total).toBe(99_900);
    expect(group("moneyOut", "Sent away")?.total).toBe(100_000);
    expect(group("moneyOut", "Repaid")?.total).toBe(150_000);
    expect(group("moneyOut", "Interest and charges paid")?.total).toBe(10_000);
    expect(group("moneyOut", "Passed on for someone else")?.total).toBe(2_500_000);
    expect(group("moneyOut", "Put into savings or reserve")?.total).toBe(300_000);
    // A move between two spending wallets is only its fee; a send's fee is a fee too.
    expect(group("moneyOut", "Transfer fees")?.total).toBe(2_000);
  });

  it("says what went straight to savings, apart", () => {
    expect(flow.besidePool.map((l) => [l.name, l.amount])).toEqual([["Bank interest", 500]]);
  });
});
