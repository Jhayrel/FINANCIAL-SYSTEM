/**
 * "add that budget", when the figure is in the answer above it.
 *
 * The conversation this comes from, 21 September 2026: a budget was
 * proposed, the owner said "ok thanks. can you add those to my budget?",
 * the model said "Yes, the entries will be added", and then "the budget
 * still not change".
 */

import { describe, expect, it } from "vitest";

import { confirmsProposal, namesBudgetCommand, planBudget, proposedBudgetIn, readBudgetAsk, spanIn } from "./budgetAsk";
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

/**
 * 26 September 2026, straight after the card for October: "how about add it
 * to september to december", then "in applying budget it should know even if
 * like long term". A range was read as nothing, so it fell to the entry
 * reader. And "add it" had made a card for PHP 7,700.00, the budget the
 * answer mentioned, not the PHP 8,814.58 it recommended.
 */
describe("budgets over more than one month", () => {
  const AS_OF = "2026-09-26";

  it("reads the recommendation, not the old budget the answer mentions after it", () => {
    const answer =
      "Recommended budget next month is **PHP 8,814.58**, based on the August 2026 spending total. September was **over by PHP 33,494.36** against a PHP 7,700 budget, so using the most recent month where spending stayed lower provides a realistic target.";
    expect(proposedBudgetIn(answer)).toBe(881_458);
  });

  it("reads a range of months", () => {
    expect(spanIn("how about add it to september to december", AS_OF)).toEqual({ year: 2026, month: 9, toMonth: 12, scope: "month", anchored: true });
    expect(spanIn("oct-nov", AS_OF)).toEqual({ year: 2026, month: 10, toMonth: 11, scope: "month", anchored: true });
    expect(spanIn("from october until december 2026", AS_OF)).toMatchObject({ month: 10, toMonth: 12 });
  });

  it("reads a count of months", () => {
    expect(spanIn("for the next 3 months", AS_OF)).toEqual({ year: 2026, month: 10, toMonth: 12, scope: "month", anchored: true });
    expect(spanIn("for two months", AS_OF)).toEqual({ year: 2026, month: 9, toMonth: 10, scope: "month", anchored: false });
  });

  it("says when a span leaves its start unsaid, so a card keeps its own", () => {
    expect(spanIn("make it long term", AS_OF)).toMatchObject({ scope: "rest", anchored: false });
    expect(spanIn("from october on", AS_OF)).toMatchObject({ scope: "rest", month: 10, anchored: true });
  });

  it("reads long term as the rest of the year", () => {
    for (const said of ["long term", "from now on", "every month", "for good", "rest of the year", "long-term please"]) {
      expect(spanIn(said, AS_OF)?.scope, said).toBe("rest");
    }
  });

  it("does not take a word that only starts like a month", () => {
    expect(spanIn("I cannot decide, separate it", AS_OF)).toBeNull();
    expect(spanIn("it may be too low", AS_OF)).toBeNull();
    expect(spanIn("set it for may", AS_OF)).toMatchObject({ month: 5 });
  });

  it("says nothing when no month or span is named", () => {
    expect(spanIn("make it higher", AS_OF)).toBeNull();
  });

  it("plans a range month by month, leaving closed months alone", () => {
    const ask = readBudgetAsk("set my budget to 8814.58 from august to december", REFERENCE, AS_OF);
    expect(ask).toMatchObject({ kind: "tracks", month: 8, toMonth: 12, spending: 881_458 });
    const plan = planBudget(ask!, {}, AS_OF, "2026-09-26T00:00:00.000Z");
    expect(plan.outcome.refused).toBeUndefined();
    expect(plan.outcome.written).toEqual([9, 10, 11, 12]);
    expect(plan.outcome.skipped).toEqual([8]);
    expect(plan.outcome.plan.spending.slice(8)).toEqual([881_458, 881_458, 881_458, 881_458]);
    expect(plan.words).toBe("August to December 2026: ₱8,814.58 for spending and ₱0.00 for bills and subscriptions each month.");
  });

  it("does not read the count of months as the figure", () => {
    const ask = readBudgetAsk("set budget 9000 for the next 3 months", REFERENCE, AS_OF);
    expect(ask).toMatchObject({ spending: 900_000, month: 10, toMonth: 12 });
  });
});
