import { describe, expect, it } from "vitest";

import { namesBudgetCommand, namesMoneyFigure, planBudget, proposedBudgetIn, proposedMonthIn, readBudgetAsk, respell, saysMoneyMoved, spanIn } from "./budgetAsk";
import type { Budgets, ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Travel", remark: "" }],
};
const ASOF = "2026-09-10";
const AT = "2026-09-10T08:00:00.000Z";
const twelve = (v: number) => [v, v, v, v, v, v, v, v, v, v, v, v] as unknown as Budgets[string]["spending"];
const budgets: Budgets = { "2026": { spending: twelve(700_000), billsSubs: twelve(200_000) } };

describe("reading a budget request", () => {
  it("reads the spending budget for this month", () => {
    expect(readBudgetAsk("set my budget to 8000", reference, ASOF)).toEqual({ kind: "tracks", year: 2026, month: 9, spending: 800_000, scope: "month" });
  });

  it("reads bills for a named month", () => {
    expect(readBudgetAsk("set bills budget for october to 2500", reference, ASOF)).toMatchObject({ month: 10, billsSubs: 250_000 });
  });

  it("reads a limit on a kind of spending, for the rest of the year", () => {
    expect(readBudgetAsk("limit food to 3000 for the rest of the year", reference, ASOF)).toEqual({
      kind: "limit",
      year: 2026,
      month: 9,
      name: "Food",
      value: 300_000,
      scope: "rest",
    });
  });

  it("reads copying last month", () => {
    expect(readBudgetAsk("same budget as last month", reference, ASOF)).toEqual({ kind: "copy", year: 2026, month: 9, scope: "month" });
  });

  it("leaves other sentences alone", () => {
    expect(readBudgetAsk("how is my budget", reference, ASOF)).toBeNull();
    expect(readBudgetAsk("I paid 500 for food", reference, ASOF)).toBeNull();
  });
});

describe("planning it with the Budget screen's rules", () => {
  it("changes the month and keeps the other track", () => {
    const ask = readBudgetAsk("set my budget to 8000", reference, ASOF)!;
    const plan = planBudget(ask, budgets, ASOF, AT);
    expect(plan.outcome.refused).toBeUndefined();
    expect(plan.outcome.plan.spending[8]).toBe(800_000);
    expect(plan.outcome.plan.billsSubs[8]).toBe(200_000);
    expect(plan.outcome.plan.spending[7]).toBe(700_000);
    expect(plan.changes).toHaveLength(1);
  });

  it("refuses a closed month, as the Budget screen does without a reason", () => {
    const ask = readBudgetAsk("set my budget for march to 9000", reference, ASOF)!;
    expect(planBudget(ask, budgets, ASOF, AT).outcome.refused).toContain("closed");
  });

  it("sets a limit", () => {
    const ask = readBudgetAsk("limit food to 3000", reference, ASOF)!;
    const plan = planBudget(ask, budgets, ASOF, AT);
    expect(plan.outcome.plan.categories?.["Food"]?.[8]).toBe(300_000);
  });
});

describe("an entry said just after a budget card is not a budget", () => {
  it("counts a small amount as a figure once the dates are gone", () => {
    expect(namesMoneyFigure("I recieved maya cash back in September 13 2026 the amount is 4.25")).toBe(true);
    expect(namesMoneyFigure("Should i go to gym today? 70 pesos to spend")).toBe(true);
    expect(namesMoneyFigure("make it 100k")).toBe(true);
  });

  it("does not count a date, a year or a count of months", () => {
    expect(namesMoneyFigure("how about add it to september to december")).toBe(false);
    expect(namesMoneyFigure("same budget for September 13 2026")).toBe(false);
    expect(namesMoneyFigure("for 3 months starting 13 Sept")).toBe(false);
  });

  it("knows money moving when it reads it", () => {
    expect(saysMoneyMoved("I recieved maya cash back in September 13 2026 the amount is 4.25")).toBe(true);
    expect(saysMoneyMoved("I paid another online buy in September 16 2026 maya 745.48")).toBe(true);
    expect(saysMoneyMoved("how about add it to september to december")).toBe(false);
    expect(saysMoneyMoved("make it long term")).toBe(false);
  });
});


/**
 * The owner's log, 26 September 2026: budget requests the reader missed.
 */
describe("the budget sentences from 26 September", () => {
  it("reads a doubled letter in a month as the month", () => {
    expect(spanIn("how about add it to sseptember to december", "2026-09-26")).toMatchObject({ month: 9, toMonth: 12 });
  });

  it("reads chnage as change", () => {
    expect(namesBudgetCommand("chnage the budget last month i think I changed it or something")).toBe(true);
  });

  it("fixes a month typed badly, and leaves words that only look close", () => {
    expect(respell("septmber octobre novembr decmber febuary augst")).toBe("september october november december february august");
    expect(respell("remember to adjust the number, decide separately")).toBe("remember to adjust the number, decide separately");
  });

  it("takes the month from the sentence that proposes the budget", () => {
    const answer = "I recommend a budget of **PHP 12,000.00** for October 2026. That is between August at PHP 8,814.58 and September at PHP 41,694.36.";
    expect(proposedBudgetIn(answer)).toBe(1200000);
    expect(proposedMonthIn(answer, "2026-09-26")).toMatchObject({ year: 2026, month: 10 });
  });

  it("reads next month as the next month, and nothing when no month is named", () => {
    expect(proposedMonthIn("PHP **41,694.36** is a recommended budget for next month, matching what you spent this September.", "2026-09-26")).toMatchObject({ month: 10 });
    expect(proposedMonthIn("I recommend a budget of PHP 9,000.00.", "2026-09-26")).toBeNull();
  });
});
