/**
 * What is owed, one definition on every screen (the system audit, 6 October
 * 2026): "You owe" read PHP 26,000.00 on the Dashboard and PHP 1,000.00 on
 * the Debt screen the day money was held for a relative. Rows are invented.
 */
import { describe, expect, it } from "vitest";

import { buildContext, contextToText } from "./aiContext";
import { offlineAnswer } from "./aiOffline";
import { netWorth, owedTotals, positionsOf, type Debt } from "./debt";
import type { ReferenceLists, Transaction } from "./types";

const debt = (over: Partial<Debt> & Pick<Debt, "id" | "name" | "kind">): Debt => ({
  counterparty: over.name,
  openedDate: "2026-09-01",
  wallet: "Cash",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
  ...over,
});
const debts: Debt[] = [
  debt({ id: "card", name: "Credit line", kind: "payable", form: "credit-line" }),
  debt({ id: "tita", name: "Tita", kind: "payable", form: "pass-through" }),
  debt({ id: "friend", name: "Friend", kind: "receivable" }),
  debt({ id: "dad", name: "Dad", kind: "receivable", form: "pass-through" }),
  debt({ id: "old", name: "Old loan", kind: "payable", archived: true }),
];

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  return { id: `o${n}`, recordNumber: n, date: "2026-09-10", type: "Debt", fromWallet: "", toWallet: "", category: "", item: "", description: "", fee: 0, notes: "", status: "", ...over, amount, total: amount };
};
const rows: Transaction[] = [
  row({ debtId: "card", debtEffect: "draw", toWallet: "Cash", amount: 100_000 }),
  row({ debtId: "tita", debtEffect: "draw", toWallet: "Cash", amount: 2_500_000 }),
  row({ debtId: "friend", debtEffect: "lend", fromWallet: "Cash", amount: 50_000 }),
  // Paid for Dad and paid back one peso more: owed by nobody, never -PHP 1.00.
  row({ debtId: "dad", debtEffect: "lend", fromWallet: "Cash", amount: 59_900 }),
  row({ debtId: "dad", debtEffect: "collect", toWallet: "Cash", amount: 60_000 }),
  // An archived loan still owed is still owed.
  row({ debtId: "old", debtEffect: "draw", toWallet: "Cash", amount: 30_000 }),
];
const ASOF = "2026-10-06";

describe("what is owed", () => {
  const positions = positionsOf(debts, rows, ASOF);

  it("is split four ways, each at zero or more, archived lines counted", () => {
    expect(owedTotals(positions)).toEqual({ youOwe: 130_000, owedToYou: 50_000, heldForOthers: 2_500_000, advancedForOthers: 0 });
  });

  it("leaves net worth as it was: the four parts add up to what it takes off and adds", () => {
    const worth = netWorth(1_000_000, 0, positions);
    expect(worth.payables).toBe(worth.youOwe + worth.heldForOthers);
    expect(worth.receivables).toBe(worth.owedToYou + worth.advancedForOthers);
    expect(worth.total).toBe(1_000_000 + 50_000 - 130_000 - 2_500_000);
  });

  it("is what the assistant and its offline answer say, money owed to the owner never counted as owed", () => {
    const reference: ReferenceLists = { wallets: ["Cash"], savings: [], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [] };
    const snapshot = buildContext({ transactions: rows, accounts: [], budgets: {}, credits: debts, reference, lowBalanceThreshold: 0, asOf: ASOF });
    expect(snapshot.youOwe).toBe(1_300);
    expect(snapshot.heldForOthers).toBe(25_000);
    expect(contextToText(snapshot)).toContain("(you owe PHP 1,300.00; held for others PHP 25,000.00)");
    expect(offlineAnswer(snapshot, "chat")).toContain("after PHP 1,300.00 still owed and PHP 25,000.00 held for others.");
  });
});

describe("a net worth chart", () => {
  it("is not drawn as a balance chart, which takes no debt off", async () => {
    const { mergeHint } = await import("./chartAsk");
    // A model that reads "net worth" as a balance is overruled; balances still pass.
    expect(mergeHint(null, { money: "balance" }, "chart my net worth this year")?.money).toBeUndefined();
    expect(mergeHint(null, { money: "balance" }, "chart my savings this year")?.money).toBe("balance");
  });
});
