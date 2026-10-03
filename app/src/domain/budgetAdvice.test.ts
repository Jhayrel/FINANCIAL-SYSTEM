/**
 * A realistic budget, worked out on the device (`budgetAdvice.ts`).
 *
 * 28 September 2026: "what budget do you recommend for October if I only
 * expect 8000 allowance?" was never answered, "be realistic" was answered
 * from July alone, and "the separation of that budget" was answered about
 * September. These pin the rule: each item's median month over the six
 * before, bills still running at their last amount, one-offs named and left
 * out, and the parts adding up to the whole that is quoted.
 */

import { describe, expect, it } from "vitest";

import { whyOver, adviceMonthIn, adviceWords, asksBudgetAdvice, asksForTheSplit, budgetAdvice, expectedIncomeIn, median, savingsGoalIn } from "./budgetAdvice";
import { proposedBudgetIn, proposedMonthIn } from "./budgetAsk";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `b-${n}`,
    recordNumber: n,
    date: "2026-08-01",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 10_000,
    fee: 0,
    total: 10_000,
    notes: "",
    status: "Paid",
    ...over,
  };
};
const spend = (date: string, item: string, pesos: number, description = ""): Transaction =>
  row({ date, item, amount: pesos * 100, total: pesos * 100, description });
const bill = (date: string, item: string, pesos: number, category: "Bills" | "Subscriptions"): Transaction =>
  row({ date, item, category, amount: pesos * 100, total: pesos * 100 });

const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const food = [2_000, 1_500, 1_000, 1_200, 1_800, 1_600];
const ledger: Transaction[] = [
  ...months.map((m, i) => spend(`${m}-05`, "Food", food[i] ?? 0)),
  ...months.map((m) => bill(`${m}-12`, "Wifi", 999, "Bills")),
  ...months.map((m) => bill(`${m}-04`, "Spotify", 85, "Subscriptions")),
  // Stopped in September: never in the budget.
  ...months.map((m) => bill(`${m}-15`, "Netflix", 149, "Subscriptions")),
  // Treats most months, and one Shopee order that is not a normal month.
  spend("2026-04-10", "Treat", 1_000),
  spend("2026-06-10", "Treat", 1_400),
  spend("2026-07-10", "Treat", 600),
  spend("2026-08-10", "Treat", 800),
  spend("2026-05-01", "Online Buy", 30_978, "Buy things in shopee"),
  // Travel twice in six months: named, not budgeted.
  spend("2026-05-20", "Travel", 4_000),
  spend("2026-06-20", "Travel", 3_000),
  row({ date: "2026-09-02", type: "Revenue", category: "Revenue", fromWallet: "", toWallet: "Cash", item: "Allowance", amount: 1_200_000, total: 1_200_000, status: "Received" }),
];
const stopped = [{ name: "Netflix", since: "2026-09-10" }];

describe("the months and the medians", () => {
  const a = budgetAdvice({ transactions: ledger, year: 2026, month: 10, asOf: "2026-09-28", stopped });

  it("reads the six months before the one planned", () => {
    expect(a.read).toEqual(months);
    expect(a.name).toBe("October 2026");
  });

  it("gives each item its median month, rounded up to the next PHP 50", () => {
    // Food: 1,000 1,200 1,500 1,600 1,800 2,000, median 1,550.
    expect(a.items.find((l) => l.name === "Food")?.amount).toBe(155_000);
    // Treat: 0 0 600 800 1,000 1,400, median 700.
    expect(a.items.find((l) => l.name === "Treat")?.amount).toBe(70_000);
  });

  it("leaves a one-off out of the month and names it", () => {
    expect(a.items.some((l) => l.name === "Online Buy")).toBe(false);
    expect(a.oneOffs[0]).toMatchObject({ item: "Online Buy", amount: 3_097_800, date: "2026-05-01" });
  });

  it("names what happens only some months without budgeting it", () => {
    expect(a.sometimes.find((l) => l.name === "Travel")).toMatchObject({ months: 2 });
    expect(a.items.some((l) => l.name === "Travel")).toBe(false);
  });

  it("takes the bills still running at their last amount, and never a stopped one", () => {
    expect(a.bills.map((l) => [l.name, l.amount])).toEqual([["Wifi", 99_900]]);
    expect(a.subscriptions.map((l) => [l.name, l.amount])).toEqual([["Spotify", 8_500]]);
    expect(a.stopped).toEqual(["Netflix"]);
  });

  it("adds up: the parts are the whole that is quoted", () => {
    expect(a.spending).toBe(a.items.reduce((s, l) => s + l.amount, 0) + a.fees + a.interest);
    expect(a.billsSubs).toBe(99_900 + 8_500);
    expect(a.total).toBe(a.spending + a.billsSubs);
    expect(Number.isInteger(a.total)).toBe(true);
  });
});

describe("held to what is coming in", () => {
  it("says it fits, and what is left to save", () => {
    const a = budgetAdvice({ transactions: ledger, year: 2026, month: 10, asOf: "2026-09-28", stopped, income: 1_000_000 });
    expect(a.fit?.fits).toBe(true);
    expect(adviceWords(a)).toContain("to save");
  });

  it("cuts the wants by the same share, and leaves the needs alone", () => {
    const a = budgetAdvice({ transactions: ledger, year: 2026, month: 10, asOf: "2026-09-28", stopped, income: 250_000 });
    expect(a.fit?.fits).toBe(false);
    // Room: 2,500 less 1,084 of bills, down to the PHP 50: 1,400.
    expect(a.fit?.room).toBe(140_000);
    expect(a.fit?.cuts.map((c) => c.name)).toEqual(["Treat"]);
    expect(a.fit?.cuts.every((c) => c.to < c.from)).toBe(true);
    // Food is a need: it is not cut, and the gap is said instead.
    expect(a.fit?.short).toBeGreaterThan(0);
    expect(adviceWords(a)).toMatch(/short/);
  });
});

describe("the answer in words", () => {
  const a = budgetAdvice({ transactions: ledger, year: 2026, month: 10, asOf: "2026-09-28", stopped });
  const words = adviceWords(a);

  it("opens with the sentence set it reads, for the month it is for", () => {
    expect(words.startsWith("I recommend a budget of **PHP ")).toBe(true);
    expect(proposedBudgetIn(words)).toBe(a.total);
    expect(proposedMonthIn(words, "2026-09-28")).toMatchObject({ year: 2026, month: 10 });
  });

  it("gives the split: every item, every bill, and what was left out", () => {
    expect(words).toContain("- Food: PHP 1,550.00");
    expect(words).toContain("- Wifi: PHP 999.00");
    expect(words).toContain("Left out, marked stopped: Netflix.");
    expect(words).toContain("Left out as one-offs: Online Buy PHP 30,978.00");
    expect(words).toContain("April to September 2026");
  });

  it("never uses an em dash", () => {
    expect(words).not.toMatch(/[\u2010-\u2015]/);
  });

  it("says so when there is nothing to work from", () => {
    const none = budgetAdvice({ transactions: [], year: 2026, month: 10, asOf: "2026-09-28" });
    expect(adviceWords(none)).toMatch(/nothing recorded before October 2026/);
  });
});

describe("reading the question", () => {
  it.each([
    "what budget do you recommend for October if I only expect 8000 allowance?",
    "what's your realistic budget recommendation next month? be realistic",
    "how much should my budget be next month",
    "can you recommend budget?",
    "suggest a budget for november",
    "magkano dapat budget ko sa october",
    "give me a realistic budget",
  ])("asks for advice: %s", (q) => {
    expect(asksBudgetAdvice(q)).toBe(true);
  });

  it.each(["set budget october 9000", "is my budget ok?", "add it to my budget", "how much did I spend on food"])("is not advice: %s", (q) => {
    expect(asksBudgetAdvice(q)).toBe(false);
  });

  it("reads what they expect to receive", () => {
    expect(expectedIncomeIn("what budget do you recommend for October if I only expect 8000 allowance?")).toBe(800_000);
    expect(expectedIncomeIn("my allowance is 8k")).toBe(800_000);
    expect(expectedIncomeIn("I'll get 12,000 next month")).toBe(1_200_000);
    expect(expectedIncomeIn("recommend a budget for october 2026")).toBeNull();
  });

  it("knows a request for the parts", () => {
    expect(asksForTheSplit("tell me whats the separation of that budget?")).toBe(true);
    expect(asksForTheSplit("breakdown please")).toBe(true);
    expect(asksForTheSplit("how is this month going")).toBe(false);
  });

  it("takes the median, not the mean", () => {
    expect(median([100, 200, 30_000])).toBe(200);
    expect(median([100, 200])).toBe(150);
    expect(median([])).toBe(0);
  });
});

describe("a budget asked for at length", () => {
  const long =
    "Okay, I want to plan October properly this time. Look at how I actually spent from April to September, not just one month, and leave out the big one-time things. My allowance for October is only 8000, and I want to keep at least 1000 aside as savings. What budget do you recommend for October, and show me the separation per item and the bills?";
  const tagalog =
    "Magkano dapat budget ko para sa November kung 8000 lang allowance ko at gusto ko mag-ipon ng 1500? Isama mo yung wifi pero wag na yung Netflix.";

  it("reads the month beside the word budget, not the first month named", () => {
    expect(adviceMonthIn(long, "2026-09-28")).toEqual({ year: 2026, month: 10 });
    expect(adviceMonthIn("I overspent in May. What's a realistic budget for next month?", "2026-09-28")).toEqual({ year: 2026, month: 10 });
    expect(adviceMonthIn(tagalog, "2026-09-28")).toEqual({ year: 2026, month: 11 });
    expect(adviceMonthIn("recommend a budget for february", "2026-09-28")).toEqual({ year: 2027, month: 2 });
  });

  it("reads the income and what is to be kept, in English and Tagalog", () => {
    expect(expectedIncomeIn(long)).toBe(800_000);
    expect(savingsGoalIn(long)).toBe(100_000);
    expect(expectedIncomeIn(tagalog)).toBe(800_000);
    expect(savingsGoalIn(tagalog)).toBe(150_000);
    expect(savingsGoalIn("how much would I save if I cut treats")).toBeNull();
  });

  it("keeps the savings out before anything is budgeted", () => {
    const a = budgetAdvice({ transactions: ledger, year: 2026, month: 10, asOf: "2026-09-28", stopped, income: 500_000, keep: 100_000 });
    // 5,000 less 1,084 of bills less 1,000 kept, down to the PHP 50: 2,900.
    expect(a.fit?.room).toBe(290_000);
    expect(a.fit?.keep).toBe(100_000);
    expect(adviceWords(a)).toContain("with PHP 1,000.00 kept to save");
  });
});

describe("why a month is over its budget", () => {
  it("names the items above their usual month, and the two parts", () => {
    const withSpike = [...ledger, spend("2026-10-05", "Food", 3_000), spend("2026-10-06", "Treat", 5_000)];
    const lines = whyOver(withSpike, { spending: 300_000, billsSubs: 150_000 }, 2026, 10, "2026-10-20");
    expect(lines[0]).toBe("Budget PHP 4,500.00 (spending PHP 3,000.00, bills and subscriptions PHP 1,500.00); spent PHP 8,000.00, over by PHP 3,500.00.");
    expect(lines.join("\n")).toContain("- Treat: PHP 5,000.00, usually PHP 700.00, PHP 4,300.00 more");
    expect(lines.join("\n")).toContain("- Food: PHP 3,000.00, usually PHP 1,550.00, PHP 1,450.00 more");
  });

  it("says nothing for a month with no budget", () => {
    expect(whyOver(ledger, { spending: 0, billsSubs: 0 }, 2026, 9, "2026-09-28")).toEqual([]);
  });
});

/*
 * 4 October 2026, the owner: "I plan to adjusted my budget this month, can
 * you set a plan? Like based on my income and spending" was answered by the
 * device asking what the budget should be. It is a request for the app's
 * recommendation, which the model gives ("Ai first. Fix this").
 */
describe("a plan asked for with no figure is advice", () => {
  it("reads a plan, an adjustment with no figure, and a budget based on income", () => {
    for (const q of [
      "I plan to adjusted my budget this month, can you set a plan? Like based on my income and spending",
      "can you make a budget plan for november",
      "budget based on my allowance",
      "please adjust my budget this month",
    ]) {
      expect(asksBudgetAdvice(q), q).toBe(true);
    }
  });

  it("leaves a figure the owner gave to be set as given", () => {
    expect(asksBudgetAdvice("set my budget to 9000 for october to december")).toBe(false);
    expect(asksBudgetAdvice("adjust my budget to 12000")).toBe(false);
    expect(asksBudgetAdvice("i planned to spend 500 today")).toBe(false);
  });
});
