/**
 * One daily figure on two screens. 3 October 2026: the Budget screen said
 * PHP 1,837.00 a day beside the Dashboard's PHP 1,719.66, the bills all paid
 * and PHP 352.00 of their budget unspent. Rows and budgets are invented.
 */
import { describe, expect, it } from "vitest";

import { buildContext } from "./aiContext";
import { monthPlanView } from "./budgetView";
import { monthBrief } from "./monthPlan";
import type { Budgets, ReferenceLists, Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return { id: `r${n}`, recordNumber: n, date: "2026-08-02", type: "Spending", fromWallet: "Wallet A", toWallet: "", category: "Spending", item: "Food", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Paid", ...over };
};
const twelve = (v: number) => Array.from({ length: 12 }, () => v) as unknown as Budgets[string]["spending"];
const budgets: Budgets = { "2026": { spending: twelve(800_000), billsSubs: twelve(150_000) } };
const reference: ReferenceLists = { wallets: ["Wallet A"], savings: [], bills: ["Internet"], subscriptions: [], revenueCategories: ["Allowance"], spendingTypes: [{ name: "Food", remark: "" }] };
const transactions = [
  row({ type: "Revenue", fromWallet: "", toWallet: "Wallet A", category: "Revenue", item: "Allowance", amount: 9_998_900, total: 9_998_900, status: "Received" }),
  row({ amount: 284_100, total: 284_100 }),
  row({ category: "Bills", item: "Internet", amount: 114_800, total: 114_800, date: "2026-08-05" }),
];
const asOf = "2026-08-29";

describe("the daily figure", () => {
  it("is the same on the Budget screen and the Dashboard when the budget sets it", () => {
    const view = monthPlanView(transactions, budgets, 2026, 8, asOf);
    const brief = monthBrief({ transactions, reference, budgets, debts: [], year: 2026, month: 8, asOf });
    expect(brief.safe?.limitedBy).toBe("budget");
    expect(view.perDay).toBe(brief.safe?.perDay);
    // PHP 5,159.00 of spending left over three days, not the whole plan's PHP 5,511.00.
    expect(view.perDay).toBe(171_966);
  });

  it("is the one the assistant is given, in pesos", () => {
    const snap = buildContext({ transactions, accounts: [], budgets, credits: [], reference, lowBalanceThreshold: 0, asOf });
    expect(snap.month.allowancePerDay).toBe(1_719.66);
    expect(snap.month.spendingLeft).toBe(5_159);
  });
});
