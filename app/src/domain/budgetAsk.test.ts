import { describe, expect, it } from "vitest";

import { asksRatherThanTells, editedAsk, isBudgetForm, namesBudgetCommand, namesMoneyFigure, planBudget, tracksIn, proposedBudgetIn, proposedMonthIn, readBudgetAsk, respell, saysMoneyMoved, spanIn } from "./budgetAsk";
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

/*
 * 28 September 2026: "Set October's bills and subscriptions budget to
 * ₱1,641 and spending budget to ₱6,359" made a card with PHP 0.00 for
 * spending, and the same two lines typed as a form became a spending entry.
 */
describe("both budget lines in one message", () => {
  const asOf = "2026-09-28";

  it.each([
    "Bills and subscriptions: 1641\nSpending: 6359\nSave to: Oct only",
    "Set October's bills and subscriptions budget to ₱1,641 and spending budget to ₱6,359, saving it for October only.",
    "set budget october 1641 for bills and 6359 for spending",
  ])("reads each line with its own figure: %s", (said) => {
    expect(readBudgetAsk(said, reference, asOf)).toEqual({ kind: "tracks", year: 2026, month: 10, spending: 635_900, billsSubs: 164_100, scope: "month" });
  });

  it("knows the form for a budget without the word", () => {
    expect(isBudgetForm("Bills and subscriptions: 1641\nSpending: 6359")).toBe(true);
    expect(isBudgetForm("paid wifi 999 bills and spent 50 on food")).toBe(false);
    expect(readBudgetAsk("paid wifi 999 bills and spent 50 on food", reference, asOf)).toBeNull();
  });

  it("changes one line and leaves the other as it is", () => {
    const ask = readBudgetAsk("change november bills budget to 1500", reference, asOf);
    expect(ask).toMatchObject({ kind: "tracks", month: 11, billsSubs: 150_000 });
    expect(ask && "spending" in ask ? ask.spending : undefined).toBeUndefined();
    expect(tracksIn("edit october budget: spending 6000, bills 1500")).toEqual({ spending: 600_000, billsSubs: 150_000 });
  });

  it("raises or lowers by a figure, from what is set", () => {
    const up = readBudgetAsk("raise october spending budget by 1000", reference, asOf);
    expect(up).toMatchObject({ spending: 100_000, by: true });
    expect(planBudget(up!, budgets, asOf, "2026-09-28T00:00:00Z").words).toContain("₱8,000.00 for spending and ₱2,000.00 for bills");
    const down = readBudgetAsk("lower the bills budget for october by 200", reference, asOf);
    expect(planBudget(down!, budgets, asOf, "2026-09-28T00:00:00Z").words).toContain("₱7,000.00 for spending and ₱1,800.00 for bills");
  });
});

describe("a question is not a command", () => {
  it.each(["should I set my budget to 9000?", "is it ok to set spending to 5000 for october?", "do you think I should raise my budget to 12000?", "dapat ba 9000 budget ko?"])("asks: %s", (said) => {
    expect(asksRatherThanTells(said)).toBe(true);
    expect(readBudgetAsk(said, reference, "2026-09-28")).toBeNull();
  });

  it.each(["can you set my october budget to 9000", "please set the budget to 9000", "set budget october 9000"])("tells: %s", (said) => {
    expect(asksRatherThanTells(said)).toBe(false);
    expect(readBudgetAsk(said, reference, "2026-09-28")).not.toBeNull();
  });
});

describe("a budget card's figures, changed before Apply", () => {
  // 3 October 2026: "make sure it's editable too".
  it("plans the same months with the figures typed, as amounts", () => {
    const ask = { kind: "tracks" as const, year: 2026, month: 10, toMonth: 12, spending: 900_000, scope: "month" as const };
    const plan = planBudget(editedAsk(ask, { spending: 600_000, billsSubs: 152_200 }), budgets, ASOF, AT);
    expect(plan.outcome.written).toEqual([10, 11, 12]);
    expect(plan.outcome.revisions.map((r) => [r.spending, r.billsSubs])).toEqual([
      [600_000, 152_200],
      [600_000, 152_200],
      [600_000, 152_200],
    ]);
  });

  it("turns a change by an amount, or a copy, into the figures typed", () => {
    const by = { kind: "tracks" as const, year: 2026, month: 10, spending: 100_000, by: true, scope: "month" as const };
    const edited = editedAsk(by, { spending: 800_000, billsSubs: 200_000 });
    expect(edited).toMatchObject({ kind: "tracks", spending: 800_000, billsSubs: 200_000 });
    expect("by" in edited && edited.by).toBeFalsy();
  });

  it("keeps a limit card a limit on the same kind, never below nothing", () => {
    const ask = { kind: "limit" as const, year: 2026, month: 10, name: "Food", value: 300_000, scope: "month" as const };
    expect(editedAsk({ kind: "copy", year: 2026, month: 10, scope: "month" }, { spending: 1, billsSubs: 2 })).toMatchObject({ kind: "tracks", spending: 1, billsSubs: 2 });
    expect(editedAsk(ask, { limit: 250_000 })).toMatchObject({ kind: "limit", name: "Food", value: 250_000 });
    expect(editedAsk(ask, { limit: -5 })).toMatchObject({ value: 0 });
  });
});

describe("may, the verb", () => {
  // 5 October 2026: an answer's "you may" put a budget change on May 2027.
  it("is never the month", () => {
    expect(proposedMonthIn("I recommend PHP 10,650.00 for spending, so you may keep PHP 500.00 aside.", "2026-10-05")).toBeNull();
    expect(proposedMonthIn("I suggest a budget of PHP 9,000.00; it may be tight.", "2026-10-05")).toBeNull();
  });

  it("is the month where a month is meant", () => {
    expect(proposedMonthIn("I recommend a budget of PHP 9,000.00 for May.", "2026-10-05")).toMatchObject({ month: 5 });
    expect(proposedMonthIn("I recommend PHP 9,000.00 from May to July.", "2026-10-05")).toMatchObject({ month: 5, toMonth: 7 });
    expect(proposedMonthIn("I recommend PHP 9,000.00 in May 2027.", "2026-10-05")).toMatchObject({ year: 2027, month: 5 });
  });
});
