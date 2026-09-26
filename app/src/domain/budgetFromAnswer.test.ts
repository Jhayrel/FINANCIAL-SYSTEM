/**
 * "add that budget", when the figure is in the answer above it.
 *
 * The conversation this comes from, 21 September 2026: a budget was
 * proposed, the owner said "ok thanks. can you add those to my budget?",
 * the model said "Yes, the entries will be added", and then "the budget
 * still not change".
 */

import { describe, expect, it } from "vitest";

import { confirmsProposal, namesBudgetCommand, proposedBudgetIn, readBudgetAsk } from "./budgetAsk";
import { REFERENCE, TODAY } from "./eval/corpus";

describe("a budget command with no figure of its own", () => {
  const COMMANDS = [
    "ok thanks. can you add those to my budget?",
    "ok, now add that budget",
    "set my budget",
    "add buget same as last month",
    "change the budget please",
  ];

  for (const said of COMMANDS) {
    it(`recognises "${said}"`, () => {
      expect(namesBudgetCommand(said)).toBe(true);
    });
  }

  const NOT_COMMANDS = [
    "what do you propose?",
    "how much did I spend today",
    "is my budget doing ok",
    "chart my spending this month",
    "should I raise my budget?",
    "would a bigger budget help",
    "do you think my budget is too low",
  ];

  for (const said of NOT_COMMANDS) {
    it(`leaves "${said}" alone`, () => {
      expect(namesBudgetCommand(said)).toBe(false);
    });
  }
});

describe("the budget an answer proposed", () => {
  it("reads the real answer from 23 September, bold and all", () => {
    const answer =
      "Yes, a budget of **PHP 53,710.80** for next month aligns with your current average daily spending of **PHP 1,790.36**. September's budget of **PHP 7,700.00** was exceeded by **PHP 33,478.36**.";
    expect(proposedBudgetIn(answer)).toBe(5_371_080);
  });

  it("reads it without the bold markers", () => {
    expect(proposedBudgetIn("I would set a budget of PHP 12,000.00 for October.")).toBe(1_200_000);
  });

  it("reads it the other way round", () => {
    expect(proposedBudgetIn("PHP 9,500.00 a month budget would fit your last three months.")).toBe(950_000);
  });

  /*
   * The point of being narrow. An answer about the month is full of
   * figures, and setting a budget to the overage or to last month's total
   * because it came first would be a figure nobody proposed.
   */
  it("takes nothing from an answer that proposed no budget", () => {
    const answer =
      "You are over budget by **PHP 33,478.36**, having spent **PHP 41,178.36** against a PHP 7,700 budget.";
    expect(proposedBudgetIn(answer)).not.toBe(3_347_836);
    expect(proposedBudgetIn(answer)).not.toBe(4_117_836);
  });

  it("has nothing to say about an answer with no figures", () => {
    expect(proposedBudgetIn("I cannot tell from what is here.")).toBeNull();
  });
});

/**
 * 26 September 2026. The answer was "PHP 41,694.36 is the recommended
 * budget for next month", the owner said "ok add it", and the chat replied
 * "I could not find an entry in that" and asked how much it was.
 */
describe("a yes to the budget just proposed", () => {
  it("reads the figure when a word stands between it and the budget", () => {
    const answer =
      "**PHP 41,694.36** is the recommended budget for next month. It matches the amount spent in September, which is higher than July (PHP 15,127.00).";
    expect(proposedBudgetIn(answer)).toBe(4_169_436);
    expect(proposedBudgetIn("PHP 41,694.36 is a recommended budget for next month, matching what you spent.")).toBe(4_169_436);
  });

  it("prefers the recommended figure to one the answer only mentions", () => {
    const answer = "Your September budget of PHP 7,700.00 was exceeded. The recommended budget for next month is PHP 9,000.00.";
    expect(proposedBudgetIn(answer)).toBe(900_000);
  });

  for (const said of ["ok add it", "ok add it please", "yes add that", "sige add it", "apply it", "yes", "go ahead", "please set it"]) {
    it(`hears "${said}" as a yes`, () => {
      expect(confirmsProposal(said)).toBe(true);
    });
  }

  for (const said of ["ok", "no don't add it", "add it to gcash 500", "how much is it", "what do you think about adding it to my savings next week"]) {
    it(`does not hear "${said}" as a yes`, () => {
      expect(confirmsProposal(said)).toBe(false);
    });
  }

  it("makes the same request a named one would", () => {
    const ask = readBudgetAsk("set the budget next month ₱41,694.36", REFERENCE, TODAY);
    expect(ask).toMatchObject({ kind: "tracks", spending: 4_169_436 });
  });
});
