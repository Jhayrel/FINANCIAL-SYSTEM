import { describe, expect, it } from "vitest";

import { periodOnly, readSpendAsk } from "./spendAsk";

/* 13 October 2026: "Total summary of school spending", then "All years". */
describe("a sum asked as a summary, and a period said on its own", () => {
  it("reads a summary of one item's spending as a sum", () => {
    expect(readSpendAsk("Total summary of school spending", ["School", "Food"], "2026-10-15")?.item).toBe("School");
    expect(readSpendAsk("Total summary of school spending all years", ["School"], "2026-10-15")).toMatchObject({ item: "School", name: "the whole ledger" });
  });

  it("leaves a summary of everything to the chart that splits it", () => {
    expect(readSpendAsk("Show me a summary of my spending", ["School", "Food"], "2026-10-15")).toBeNull();
  });

  it("finds the period in a follow-up that is only a period", () => {
    expect(periodOnly("All years")).toBe("all years");
    expect(periodOnly("how about 2025?")).toBe("in 2025");
    expect(periodOnly("and last month")).toBe("last month");
    expect(periodOnly("All years of school")).toBeNull();
    expect(periodOnly("Framelink Media")).toBeNull();
  });
});

import { saysItWasAQuestion } from "./intent";

describe("it was a question to the AI", () => {
  it("is read as the question before, asked again", () => {
    for (const q of ["Thats a question to the ai", "it was a question to the ai", "I'm asking the AI", "that's a question"]) expect(saysItWasAQuestion(q), q).toBe(true);
    expect(saysItWasAQuestion("what is a question to the ai")).toBe(false);
  });
});

import { asksIncomeBudget, readIncomePlan } from "./incomeBudget";

describe("a budget question about recent income", () => {
  it("is the budget against what came in, not a plan to make (19 October 2026)", () => {
    const q = "With my recent income what can you propose in budget change?";
    expect(readIncomePlan(q)).toBeNull();
    expect(asksIncomeBudget(q)).toBe(true);
    expect(readIncomePlan("base my budget on my 10k income, save 20%")).toEqual({ income: 1000000, keep: { percent: 20 } });
  });
});

import { readEditAsk } from "./chatChanges";
import type { ReferenceLists } from "./types";

describe("an edit said without 'to'", () => {
  const ref = { wallets: ["Cash"], savings: [], spendingTypes: [], bills: [], subscriptions: [], revenueCategories: [] } as unknown as ReferenceLists;
  it("reads the amount (19 October 2026)", () => {
    expect(readEditAsk("Edit #3948 amount 0.27", ref, "2026-10-19")?.change.amount).toBe(27);
    expect(readEditAsk("#3948 should be 0.27", ref, "2026-10-19")?.change.amount).toBe(27);
    expect(readEditAsk("Edit the last entry with 1000 not 1050", ref, "2026-10-19")?.change.amount).toBe(100000);
    expect(readEditAsk("I paid 500 for food", ref, "2026-10-19")).toBeNull();
  });
});

import { answerMoveIn } from "./incomeBudget";

describe("what the answer proposed for this month's budget", () => {
  it("reads a raise or a cut, only for the running month (19 October 2026)", () => {
    expect(answerMoveIn("You can raise your October spending budget by **PHP 1,229.51** at most, which sets it to PHP 27,229.51.", 10)).toBe("raise");
    expect(answerMoveIn("Yes, the calculations are correct: you could raise the October spending budget by up to PHP 1,229.51.", 10)).toBe("raise");
    expect(answerMoveIn("The budget promises more than your money: lower it to PHP 25,907.51.", 10)).toBe("fit");
    expect(answerMoveIn("I recommend a budget of PHP 15,172.00 for November 2026.", 10)).toBeNull();
    expect(answerMoveIn("You can raise your November budget by PHP 500.", 10)).toBeNull();
  });
});

import { tracksIn } from "./budgetAsk";

describe("the budget an answer proposes", () => {
  it("is the one it tells you to set, never what was already spent (19 October 2026)", () => {
    const answer =
      "I recommend a budget of **PHP 27,229.51** for October 2026 spending. This figure is the most your current money can support, worked out by adding your **PHP 1,752.46** safe to spend to the **PHP 25,477.05** you have already spent this month. Type set October spending to 27229.51 and bills to 1700 to apply it.";
    expect(tracksIn(answer.replace(/\*\*/g, ""))).toEqual({ spending: 2722951, billsSubs: 170000 });
    expect(tracksIn("Your PHP 1,752.46 safe to spend to the PHP 25,477.05 you have already spent.").spending).toBeUndefined();
    expect(tracksIn("Spending: PHP 12,478.00, Bills and subscriptions: PHP 1,522.00")).toEqual({ spending: 1247800, billsSubs: 152200 });
  });
});

import { readBudgetAsk, spanIn } from "./budgetAsk";

describe("budget sentences from the 19 October audit", () => {
  const ref = { wallets: ["Cash"], savings: [], spendingTypes: [], bills: [], subscriptions: [], revenueCategories: [] } as unknown as ReferenceLists;
  it("reads each figure beside its own line, either way round", () => {
    expect(tracksIn("set november budget 12k spending and 2k bills")).toEqual({ spending: 1200000, billsSubs: 200000 });
    expect(tracksIn("split my november budget 12000 spending 2000 bills")).toEqual({ spending: 1200000, billsSubs: 200000 });
    expect(tracksIn("spending 9000 bills 1500")).toEqual({ spending: 900000, billsSubs: 150000 });
  });
  it("keeps a total said beside one line, and two months side by side", () => {
    expect(readBudgetAsk("budget 14000 for november, 1500 for bills", ref, "2026-10-19")).toMatchObject({ month: 11, total: 1400000, billsSubs: 150000 });
    expect(spanIn("make november and december budget 14000 each", "2026-10-19")).toMatchObject({ month: 11, toMonth: 12 });
    expect(spanIn("september and december", "2026-10-19")?.toMonth).toBeUndefined();
  });
});

import { readDebtSentence } from "./debtSentence";
import { readSettleAsk } from "./settleLine";
import type { Debt } from "./debt";

describe("debt sentences read by who acts (19 October 2026 audit)", () => {
  const effect = (t: string) => readDebtSentence(t, () => 50000, () => 50000).effect;
  it("knows paying back, being lent to and lending", () => {
    expect(effect("I gave back the 500 I borrowed from Ana")).toBe("repay");
    expect(effect("I returned the money I borrowed from Ana, 500 cash")).toBe("repay");
    expect(effect("I owe Ana 500, she lent it to me in cash")).toBe("draw");
    expect(effect("Ana borrowed 500 from me cash")).toBe("lend");
    expect(effect("Ana paid me back 200 cash")).toBe("collect");
  });
  it("never reads a payment as clearing a lender's line", () => {
    const credit = { id: "c", name: "Card Credit", counterparty: "Card", kind: "payable", form: "credit-line", archived: false } as unknown as Debt;
    expect(readSettleAsk("paid 4302.06 from card to clear my card credit", [credit], undefined, ["Card"])).toBeNull();
    expect(readSettleAsk("clear card credit", [credit], undefined, ["Card"])).toBeNull();
  });
});
