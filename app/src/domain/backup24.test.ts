/**
 * The owner's conversation of 18 to 24 November 2026, with invented figures:
 * questions read as questions, a source's income in a month, budgets from
 * income, interest at the rate earned, buying with a credit line, money set
 * aside for bills, and a picture's credit purchase paired.
 */

import { describe, expect, it } from "vitest";

import { borrowedMoney } from "./borrowed";
import { asksRatherThanTells } from "./budgetAsk";
import { asksToReadAgain } from "./capture";
import { pairCreditPurchases } from "./creditPurchase";
import { challengesAnswer } from "./dayFit";
import type { Debt } from "./debt";
import { readDebtSentence } from "./debtSentence";
import { readEarnAsk } from "./earnAsk";
import { emptyDraft } from "./entry";
import { readIncomePlan } from "./incomeBudget";
import { earnedRate, interestIfWords, readInterestIf } from "./interestIf";
import { readMoney, type Proposal } from "./proposal";
import { detectRecall, talksArithmetic } from "./recall";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `b24-${n}`, recordNumber: n, date: "2026-11-01", type: "Spending", fromWallet: "", toWallet: "", category: "Spending", item: "",
    description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Paid", ...over,
  };
};

describe("a question is never a command to change rows", () => {
  it.each(["Can you help me change?", "If you removed debt how much it total?", "how much is left if you remove the loan?"])("%s asks", (s) => {
    expect(asksRatherThanTells(s)).toBe(true);
  });
  it("still takes a plain command as one", () => {
    expect(asksRatherThanTells("delete the food yesterday")).toBe(false);
    expect(asksRatherThanTells("can you set my budget to 9000")).toBe(false);
  });
  it("never deletes for arithmetic", () => {
    expect(detectRecall("Like remove debt in the equation only real revenue")).toBeNull();
    expect(talksArithmetic("remove the debt from the total income")).toBe(true);
    expect(detectRecall("delete the jollibee yesterday")).not.toBeNull();
  });
  it.each(["That's wrong can you see it", "That's not the real revenue, thats a revenue with debt", "are you sure?", "is that correct"])("%s disputes the answer", (s) => {
    expect(challengesAnswer(s)).toBe(true);
  });
});

describe("one source of income, in a month", () => {
  const sources = ["Allowance", "Bank interest", "Freelance"];
  it("reads this month for a named source", () => {
    expect(readEarnAsk("How much bank interest i earn this month?", sources, "2026-11-24")).toMatchObject({ from: "2026-11-01", only: "Bank interest" });
  });
  it("reads both months when both are asked", () => {
    expect(readEarnAsk("How much bank interest i earn this month last month", sources, "2026-11-24")?.also).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("leaves a month with no source to the month's summary", () => {
    expect(readEarnAsk("how much did I earn this month", sources, "2026-11-24")).toBeNull();
  });
});

describe("a budget from income, said every way", () => {
  it.each([
    "Work out my budget with my new revenue",
    "Wait can we just adjust my budget based on income this month and not debt",
    "Re work my budget based on the money that I recieved",
  ])("%s", (s) => {
    expect(readIncomePlan(s)).toEqual({ income: null, keep: null });
  });
  it("still answers a question about it instead", () => {
    expect(readIncomePlan("let me know if we can raise the budget based on income")).toBeNull();
  });
});

describe("interest at the rate the account earned", () => {
  // 10,000.00 held all month in savings, 25.00 of interest credited over the last 30 days.
  const ledger = [
    row({ date: "2026-09-01", type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Savings", amount: 1000000, total: 1000000 }),
    ...[3, 10, 17, 24].map((d) => row({ date: `2026-11-${String(d).padStart(2, "0")}`, type: "Revenue", category: "Revenue", item: "Bank interest", toWallet: "Savings", amount: 625, total: 625 })),
  ];
  it("reads the what-if and its amount", () => {
    expect(readInterestIf("If i have 1 million in savings how much interest will it gain?", ["Cash", "Savings"])).toEqual({ amount: 100000000, account: "Savings" });
    expect(readInterestIf("with 50k how much interest would I get", ["Savings"])?.amount).toBe(5000000);
    expect(readInterestIf("how much interest did I earn", ["Savings"])).toBeNull();
  });
  it("takes the rate from the credits against the daily balance", () => {
    const rate = earnedRate(ledger, "Savings", "2026-11-24");
    expect(rate?.interest).toBe(2500);
    expect(rate?.days).toBe(30);
  });
  it("says what the money would earn a day, a month and a year", () => {
    const words = interestIfWords({ amount: 100000000, account: "Savings" }, ledger, "2026-11-24");
    expect(words).toContain("₱1,000,000.00 would earn about");
    expect(words).toMatch(/a day, ₱[\d,]+\.\d\d in 30 days/);
  });
});

describe("paying with a credit line", () => {
  const read = (s: string) => readDebtSentence(s, (t) => readMoney(/\d[\d,.]*/.exec(t)?.[0] ?? ""), readMoney);
  it("is a borrowing that bought something", () => {
    expect(read("I paid 500 for food using maya credit")).toMatchObject({ effect: "draw", bought: true, amount: 50000 });
  });
  it("is never a payment of the line", () => {
    expect(read("paid my maya credit 500")?.bought).toBeUndefined();
  });
});

describe("a picture's credit purchase, paired", () => {
  const card = (over: Partial<Proposal["draft"]>): Proposal => ({ draft: { ...emptyDraft("2026-11-21"), ...over }, confidence: "medium", sourceRef: "IMG_1.jpg", adjustments: [] });
  it("puts the spend in the wallet the borrowing lands in, on its day", () => {
    const out = pairCreditPurchases([
      card({ flow: "Debt", debtEffect: "draw", item: "Maya Credit", toWallet: "Maya", amount: 50000 }),
      card({ flow: "Spending", date: "2026-11-19", fromWallet: "Cash", amount: 50000 }),
    ]);
    expect(out[1]?.draft).toMatchObject({ date: "2026-11-21", fromWallet: "Maya" });
  });
  it("leaves cards alone when the amount does not match", () => {
    const spend = card({ flow: "Spending", fromWallet: "Cash", amount: 40000 });
    const out = pairCreditPurchases([card({ flow: "Debt", debtEffect: "draw", toWallet: "Maya", amount: 50000 }), spend]);
    expect(out[1]).toBe(spend);
  });
});

describe("money set aside for bills stays the owner's (B7)", () => {
  const debts = [{ id: "line", name: "Credit Line", kind: "payable", form: "credit-line" }] as unknown as Debt[];
  it("puts the borrowed money on the other spending, not the bill paid later", () => {
    const ledger = [
      row({ date: "2026-11-01", type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Wallet", amount: 100000, total: 100000 }),
      row({ date: "2026-11-05", type: "Debt", category: "", debtId: "line", debtEffect: "draw", toWallet: "Wallet", amount: 100000, total: 100000 }),
      row({ id: "food", date: "2026-11-06", fromWallet: "Wallet", item: "Food", amount: 90000, total: 90000 }),
      row({ id: "bill", date: "2026-11-20", category: "Subscriptions", fromWallet: "Wallet", item: "Music", amount: 24000, total: 24000 }),
    ];
    const b = borrowedMoney(ledger, debts, ["Wallet"], "2026-11-30");
    expect(b.spent.get("bill")).toBeUndefined();
    expect(b.spent.get("food")?.amount).toBe(14000);
    // What is borrowed and still held does not change.
    expect(b.inHand).toBe(86000);
  });
  it("still says a bill was paid with borrowed money when nothing of their own was there", () => {
    const ledger = [
      row({ date: "2026-11-05", type: "Debt", category: "", debtId: "line", debtEffect: "draw", toWallet: "Wallet", amount: 100000, total: 100000 }),
      row({ id: "bill2", date: "2026-11-20", category: "Subscriptions", fromWallet: "Wallet", item: "Music", amount: 24000, total: 24000 }),
    ];
    expect(borrowedMoney(ledger, debts, ["Wallet"], "2026-11-30").spent.get("bill2")?.amount).toBe(24000);
  });
});

describe("read the picture again", () => {
  it.each(["Retry the entry", "redo the receipt", "try the picture again", "retry"])("%s", (s) => {
    expect(asksToReadAgain(s)).toBe(true);
  });
});
