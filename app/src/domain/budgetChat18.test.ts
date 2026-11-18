/**
 * The budget conversation of 18 November 2026, with invented figures: a
 * proposal applied as proposed, held to what the money covers, the model's
 * "set ..." line made a card, and nothing that reads the budget already set
 * as the one proposed.
 */

import { describe, expect, it } from "vitest";

import { budgetLineIn, suggestedCommands } from "./answerCommands";
import { confirmsProposal, proposedBudgetIn, type BudgetAsk } from "./budgetAsk";
import { holdToMoney, incomeBudgetWords, mostWords, type IncomeBudget } from "./incomeBudget";

// Spent 9,000.00, 500.00 held for allocations, 600.00 safe to spend: the money covers 10,100.00.
const ib = { most: 1010000, spent: 900000, safe: 60000, plans: 0, billsBudget: 80000 };

describe("what counts as the proposal", () => {
  it("never takes the budget already set for one", () => {
    expect(proposedBudgetIn("Your spending budget of ₱8,800.00 already fits your money.")).toBeNull();
    expect(proposedBudgetIn("The current budget of PHP 8,800.00 is overspent.")).toBeNull();
  });

  it("still reads a recommendation", () => {
    expect(proposedBudgetIn("I recommend a budget of PHP 10,100.00 for November 2026.")).toBe(1010000);
  });
});

describe("a yes to it", () => {
  it.each(["Update it add it", "update it", "ok update it", "add it", "apply it", "go update the budget"])("%s", (s) => {
    expect(confirmsProposal(s)).toBe(true);
  });
  it.each(["don't update it", "no add it later", "update it to 5000"])("not %s", (s) => {
    expect(confirmsProposal(s)).toBe(false);
  });
});

describe("held to what the money covers", () => {
  const nov = (over: Partial<Extract<BudgetAsk, { kind: "tracks" }>>): BudgetAsk => ({ kind: "tracks", year: 2026, month: 11, scope: "month", ...over });

  it("takes a total at the ceiling as spending, bills kept as their own budget", () => {
    const held = holdToMoney(nov({ total: 1010000 }), ib);
    expect(held.ask).toMatchObject({ spending: 1010000, billsSubs: 80000 });
    expect(held.note).toContain("₱500.00 held for allocations");
  });

  it("puts back bills that were taken out of the ceiling", () => {
    const held = holdToMoney(nov({ spending: 950000, billsSubs: 60000 }), ib);
    expect(held.ask).toMatchObject({ spending: 1010000, billsSubs: 80000 });
  });

  it("brings a figure above the ceiling down to it, and says so", () => {
    const held = holdToMoney(nov({ spending: 1500000 }), ib);
    expect(held.ask).toMatchObject({ spending: 1010000 });
    expect(held.note).toContain("Brought down");
  });

  it("leaves a figure under the ceiling as proposed", () => {
    const ask = nov({ spending: 950000, billsSubs: 80000 });
    expect(holdToMoney(ask, ib)).toEqual({ ask, note: "" });
  });

  it("names every part of the ceiling, so they add up", () => {
    expect(mostWords(ib)).toBe("₱9,000.00 spent, ₱500.00 held for allocations and ₱600.00 safe to spend");
  });
});

describe("what the AI is told", () => {
  const full: IncomeBudget = { year: 2026, month: 11, setOn: "2026-11-16", cameIn: 774, sources: [], intoSavings: 0, savingsSources: [], toSavings: 0, budget: 880000, billsBudget: 80000, spent: 900000, safe: 60000, plans: 0, most: 1010000, over: 0, room: 130000 };
  const words = incomeBudgetWords(full, "November").join(" ");

  it("says the budget is already overspent", () => {
    expect(words).toContain("₱200.00 has been spent past the spending budget");
  });

  it("gives the room from the money held, not only the income since", () => {
    expect(words).toContain("can go up to ₱10,100.00, ₱1,300.00 above what it is");
    expect(words).toContain("not only what came in");
  });

  it("says how to propose a change", () => {
    expect(words).toContain('"set November spending to"');
  });
});

describe("the model's budget line", () => {
  const answer = "I recommend a budget of PHP 10,100.00 for November 2026.\n\nset November spending to 10100 and bills to 800";

  it("is found, and taken out of the answer", () => {
    const found = budgetLineIn(answer);
    expect(found?.line).toBe("set November spending to 10100 and bills to 800");
    expect(found?.rest).toBe("I recommend a budget of PHP 10,100.00 for November 2026.");
  });

  it("is not a sentence that only mentions one", () => {
    expect(budgetLineIn('You can say "set November spending to 10100" to change it.')).toBeNull();
  });
});

describe("buttons under an answer", () => {
  it("never offers lowering under an answer that raises the budget", () => {
    const raise = 'I recommend a budget of PHP 10,100.00, above your current spending budget of PHP 8,800.00. "Lower my budget to my money"';
    expect(suggestedCommands(raise).some((c) => /^lower/i.test(c))).toBe(false);
  });

  it("still offers it when the answer lowers the budget", () => {
    const lower = 'Your budget is more than your money covers. Say "lower my budget to my money" to bring it down.';
    expect(suggestedCommands(lower).some((c) => /^lower/i.test(c))).toBe(true);
  });
});
