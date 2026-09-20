import { describe, expect, it } from "vitest";

import { detectIntent, isBudgetCommand, wantsAllBillsPaid , entriesInside, wantsThoseEntries } from "./intent";

describe("detectIntent: entries", () => {
  it("reads the sentence that was answered as a question instead", () => {
    // Verbatim from the deployed app, where this came back as "the data does
    // not contain a record of a PHP 500 food purchase" rather than a row.
    expect(detectIntent("I buy food ealier at mcdonalds i spent 500")).toBe("log");
  });

  it("reads the plain forms", () => {
    const entries = [
      "I spent 100 cash on food",
      "spent 250 on transport",
      "paid 1,200 for electricity",
      "bought groceries 450",
      "got 5000 allowance",
      "sent 300 to gcash",
      "transferred 1000 from cash to maya",
      "add 85 spotify",
      "received 2,500 salary",
      "topped up 100 load",
    ];
    for (const text of entries) {
      expect(detectIntent(text), text).toBe("log");
    }
  });

  it("reads an amount written with a peso sign or the currency word", () => {
    expect(detectIntent("spent ₱500 on food")).toBe("log");
    expect(detectIntent("paid PHP 1,234.56 for rent")).toBe("log");
  });

  it("reads a decimal amount", () => {
    expect(detectIntent("spent 99.50 on coffee")).toBe("log");
  });
});

describe("detectIntent: something already done, even without a figure", () => {
  /**
   * The case the owner raised. "I have paid my load today" was answered with
   * "the data does not include a figure for the load payment you made today".
   * It is an entry with one blank in it, and the blank is a question to ask.
   */
  it("reads a completed action as an entry so the amount can be asked for", () => {
    expect(detectIntent("I have paid my load today")).toBe("log");
    expect(detectIntent("I bought lunch")).toBe("log");
    expect(detectIntent("received my allowance")).toBe("log");
    expect(detectIntent("I spent 500 today eating at kabsat la union")).toBe("log");
  });

  it("still lets a question about the same words be a question", () => {
    expect(detectIntent("have I paid my load today")).toBe("ask");
    expect(detectIntent("did I pay my load?")).toBe("ask");
  });
});

describe("detectIntent: questions", () => {
  it("treats anything ending in a question mark as a question", () => {
    expect(detectIntent("I spent 100 on food?")).toBe("ask");
    expect(detectIntent("did I spend 500 at mcdonalds?")).toBe("ask");
  });

  it("treats an opening question word as a question, mark or not", () => {
    const questions = [
      "how much did I spend on food this month",
      "what is my balance",
      "why is gcash so low",
      "did I pay 1200 for electricity",
      "show me august",
      "compare july and august",
      "is 5000 too much",
    ];
    for (const text of questions) {
      expect(detectIntent(text), text).toBe("ask");
    }
  });

  it("does not turn a stray small number into an entry", () => {
    expect(detectIntent("tell me about wallet 1")).toBe("ask");
    expect(detectIntent("my food spending")).toBe("ask");
  });

  it("needs both an amount and a verb, unless the verb says it already happened", () => {
    // Present tense with no amount: an intention, not an entry.
    expect(detectIntent("remind me to pay electricity")).toBe("ask");
    expect(detectIntent("I pay rent monthly")).toBe("ask");
    // An amount with no verb is not an instruction to do anything.
    expect(detectIntent("500 mcdonalds")).toBe("ask");
  });

  it("does not match a verb buried inside a longer word", () => {
    // Word boundaries: an earlier version lost them and "unpaid" read as an
    // entry. Worse, they became literal backspace characters, so the whole
    // pattern silently matched nothing.
    expect(detectIntent("my unpaid bills")).toBe("ask");
    expect(detectIntent("the presentation")).toBe("ask");
  });

  it("treats an empty message as a question, which sends nothing anyway", () => {
    expect(detectIntent("")).toBe("ask");
    expect(detectIntent("   ")).toBe("ask");
  });
});


describe("isBudgetCommand", () => {
  it("reads the sentence that came back as \"Dropped it.\"", () => {
    expect(isBudgetCommand("add buget same as last month")).toBe(true);
  });

  it("reads plain and misspelt instructions", () => {
    for (const text of ["set my budget to 20000", "copy the budget from august", "raise budget for food", "bajet same as last month"]) {
      expect(isBudgetCommand(text), text).toBe(true);
    }
  });

  it("leaves questions about a budget alone", () => {
    for (const text of ["how is my budget", "what is my budget left?", "show me the budget", "should I raise my budget"]) {
      expect(isBudgetCommand(text), text).toBe(false);
    }
  });

  it("leaves an entry alone", () => {
    expect(isBudgetCommand("spent 200 on food")).toBe(false);
  });
});

describe("wantsAllBillsPaid", () => {
  it("reads the ways it gets said", () => {
    for (const text of ["paid all my bills", "I paid all bills today", "paid all my subscriptions", "pay every bill"]) {
      expect(wantsAllBillsPaid(text), text).toBe(true);
    }
  });

  it("is not one bill with a figure, or a question", () => {
    for (const text of ["paid 999 wifi bill", "did I pay all my bills?", "paid the electric bill"]) {
      expect(wantsAllBillsPaid(text), text).toBe(false);
    }
  });
});

/**
 * A message that is both.
 *
 * Live, 20 September 2026: thirty purchases in Taglish and then "pakisagot
 * din: magkano lahat ng ginastos ko". It ends in a question, so it was
 * answered, and the thirty entries were dropped without a word.
 */
describe("entries inside a message that is not one", () => {
  it("counts each thing that happened with a figure on it", () => {
    const said = [
      "noong september 2 bumili ako ng item 1 ng 107 sa maya",
      "noong september 3 bumili ako ng item 2 ng 114 sa gcash",
      "nag withdraw ako ng 1200 sa maya",
      "pakisagot din: magkano lahat ng ginastos ko",
    ].join(". ");

    expect(entriesInside(said)).toBe(3);
  });

  it("is not fooled by a question that mentions a figure", () => {
    expect(entriesInside("how much did I spend on food in august, about 3000 I think")).toBeLessThan(2);
    expect(entriesInside("is 5000 a lot for groceries")).toBe(0);
    expect(entriesInside("what can you do")).toBe(0);
    expect(entriesInside("")).toBe(0);
  });

  it("needs both a figure and something that happened", () => {
    expect(entriesInside("I paid the wifi. I paid the electricity")).toBe(0);
    expect(entriesInside("500. 300. 200")).toBe(0);
  });
});

describe("the answer to the offer", () => {
  it("takes the short ways of saying yes", () => {
    for (const said of ["add them", "Add them.", "yes add them", "add all", "log them", "i-add mo", "save them", "add"]) {
      expect(wantsThoseEntries(said), said).toBe(true);
    }
  });

  it("is not an entry, and not a question", () => {
    for (const said of ["add 500 food cash", "add spending", "yes", "add them to maya", "how do I add them"]) {
      expect(wantsThoseEntries(said), said).toBe(false);
    }
  });
});

/**
 * An intention is not an entry.
 *
 * The owner, 20 September 2026: "where going dinner today I plan to spend
 * 1000 in cash". Read as an entry it books a thousand pesos nobody has spent.
 */
describe("money not spent yet", () => {
  const PLANS = [
    "where going dinner today I plan to spend 1000 in cash",
    "I am planning to spend 5000 on a phone",
    "thinking of borrowing 2000",
    "balak kong bumili ng 3000 na damit",
    "I am going to spend 500 tonight",
  ];

  it("is a question, not a row", () => {
    for (const said of PLANS) expect(detectIntent(said), said).toBe("ask");
  });

  it("and what already happened still is one", () => {
    for (const said of ["I spent 500 on food", "bumili ako ng pagkain 200 gcash", "I paid 1000 for wifi"]) {
      expect(detectIntent(said), said).toBe("log");
    }
  });
});
