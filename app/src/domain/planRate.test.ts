/**
 * A plan said as a rate, worked out by the app, and a correction of what the
 * assistant understood. The owner, 4 October 2026: "250 per week then I'll
 * use 200 for gas", answered as PHP 450.00 a week with the model's own
 * arithmetic, then "I said 250 not 450", which became a spending card.
 * Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { correctsWhatWasSaid } from "./intent";
import { figuresIn, periodIn, planWorked } from "./planRate";
import type { Budgets, Transaction } from "./types";

const spent = (date: string, amount: number): Transaction => ({
  id: date, recordNumber: 1, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending",
  item: "Food", description: "", amount, fee: 0, total: amount, notes: "", status: "Paid",
});
const budgets: Budgets = { "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 300000, 0, 0], billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
const ledger = [spent("2026-10-01", 151905)];
const ASOF = "2026-10-04";
const ASKED = "What if I just control them in one week i have 2 classes means 250 per week then I'll use 200 for gas and other too? Wouldthat work?";

describe("a correction of what was understood", () => {
  it("is read, said any of the usual ways", () => {
    for (const q of ["I said 250 not 450", "no, I meant 250", "250 not 450", "it's 250 not 450", "sabi ko 250"]) expect(correctsWhatWasSaid(q), q).toBe(true);
  });
  it("is not an entry, a command, or a word put right on a card", () => {
    // The owner's own: each is read by its own rules.
    for (const q of ["I paid 250 for lunch", "lunch 250 not including the drink", "I said delete it now show me more data to delete", "I said discard it", "I mean subscription", "I said all"]) {
      expect(correctsWhatWasSaid(q), q).toBe(false);
    }
  });
});

describe("a plan said as a rate", () => {
  it("finds the period and the money, not the counts", () => {
    expect(periodIn(ASKED)).toBe("week");
    expect(figuresIn(ASKED)).toEqual([25000, 20000]);
    expect(figuresIn("3 days of 1k a day and 250.50 more")).toEqual([100000, 25050]);
  });

  it("sets each figure and their sum beside what is left, in the app's own arithmetic", () => {
    const worked = planWorked(ASKED, { transactions: ledger, budgets, asOf: ASOF });
    // PHP 3,000.00 less PHP 1,519.05 is PHP 1,480.95 over the 28 days left, October the 4th included.
    expect(worked).toContain("What is left of the spending budget, the plan: ₱1,480.95 over the 28 days left, ₱52.89 a day.");
    expect(worked).toContain("The plan's ₱250.00 a week: ₱35.71 a day, ₱250.00 a week, ₱1,000.00 over the 28 days left in the month. Against the plan: it fits what is left of the spending budget, with ₱480.95 to spare.");
    expect(worked).toContain("All together, ₱450.00 a week: ₱64.29 a day, ₱450.00 a week, ₱1,800.00 over the 28 days left in the month. Against the plan: it is ₱319.05 more than what is left of the spending budget.");
  });

  it("takes the period from what was said just before, for a correction", () => {
    const worked = planWorked("I said 250 not 450", { transactions: ledger, budgets, asOf: ASOF, before: [ASKED] });
    expect(worked).toContain("The plan's ₱250.00 a week: ₱35.71 a day");
    // The figure being put right is not part of the plan, and nothing is added to it.
    expect(worked).not.toContain("₱450.00");
    expect(worked).not.toContain("All together");
    expect(planWorked("I said 250 not 450", { transactions: ledger, budgets, asOf: ASOF })).toBe("");
  });
});

/*
 * 6 October 2026 audit: "150 a day, would that work?" was told it fit the
 * spending budget while only PHP 80.42 a day was safe to spend.
 */
describe("a plan against the money", () => {
  it("is set against what is safe first, today counted at what it already spent", () => {
    const worked = planWorked("I'll use 150 a day for food and gas, would that work?", {
      transactions: [],
      budgets: {},
      asOf: "2026-10-06",
      safe: { safe: 201056, spentToday: 321900, perDay: 0, perDayAfter: 8042 },
    });
    expect(worked).toContain("What is safe to spend, the Dashboard's figure and the money: ₱2,010.56 until the month ends; ₱0.00 today, then ₱80.42 a day from tomorrow.");
    // Today at the ₱3,219.00 already spent, then 25 days at ₱150.00: ₱6,969.00 against ₱5,229.56.
    expect(worked).toContain("Against the money: it is ₱1,739.44 more than is safe to spend, counting today at the ₱3,219.00 already spent.");
  });
});
