/**
 * The owner, 4 October 2026: "make the system powerful and instant ... make
 * sure questions and entry it should know", "make sure ai first". What the
 * device decides before a model is asked, and what it must never decide.
 * Rows are invented.
 */
import { describe, expect, it } from "vitest";

import { readAffordAsk } from "./affordAsk";
import { buildChart, chartTopic } from "./charts";
import { itemFromHistory } from "./infer";
import { isPlan, isQuestion, plainlyDone } from "./intent";
import type { Transaction } from "./types";

let n = 0;
const spend = (date: string, item: string, description: string, amount: number): Transaction => {
  n += 1;
  return {
    id: `f${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending",
    item, description, amount, fee: 0, total: amount, notes: "", status: "Paid",
  };
};

describe("a plan is never an entry", () => {
  it.each([
    "I will be spending 1000 cash",
    "i'll spend 500 on food later",
    "im going to buy shoes 2000 gcash",
    "planning to spend 1000 cash",
    "about to pay 500 gcash",
    "gagastos ako 300 bukas",
    "bibili ako ng pagkain 200 mamaya",
    "tomorrow I will pay 999 for wifi",
  ])("%s", (said) => {
    expect(isPlan(said)).toBe(true);
    expect(isQuestion(said)).toBe(true);
    expect(plainlyDone(said)).toBe(false);
  });

  it.each(["I spent 1000 cash", "bought load 100 gcash", "I paid 500 yesterday"])("but %s is", (said) => {
    expect(isPlan(said)).toBe(false);
    expect(plainlyDone(said)).toBe(true);
  });

  it("and a change, a question or a budget is never plainly done", () => {
    for (const said of ["I paid 500 not 300", "change the food I bought to 200", "did I pay 999 for wifi?", "I spent 5000, set my budget to 9000"]) {
      expect(plainlyDone(said), said).toBe(false);
    }
  });
});

describe("a chart about a trip or a place", () => {
  const ledger = [
    spend("2026-10-02", "Travel", "travel to Abra covering fare and food", 58_800),
    spend("2026-10-03", "Food", "lunch in Abra", 15_000),
    spend("2026-09-10", "School", "school trip contribution", 50_000),
    spend("2026-10-01", "Repairs", "motorcycle repair", 153_400),
  ];

  it("is the entries that mention it, wherever they are in the ledger", () => {
    const chart = buildChart("How much i spent in my trip in abra? Show me i want chart", ledger, "2026-10-04");
    expect(chart?.title).toBe("Spending on Abra by item, the whole ledger");
    expect(chart?.rows.map((r) => [r.label, r.value])).toEqual([
      ["Travel", 58_800],
      ["Food", 15_000],
    ]);
  });

  it("says so when nothing mentions the place, rather than charting another word", () => {
    expect(buildChart("chart my trip in vigan", ledger, "2026-10-04")).toBeNull();
    expect(chartTopic("chart my trip in vigan", ledger)).toBe("vigan");
    expect(chartTopic("chart my trip in abra", ledger)).toBe("");
  });

  it("leaves an ordinary chart alone", () => {
    expect(buildChart("show me spending this month", ledger, "2026-10-04")?.title).toBe("Spending by item, October 2026");
  });
});

describe("a kind read from past words", () => {
  it("is the one the words went with most, not a tie settled by order", () => {
    // 4 October 2026: "load" sat under Online Buy nineteen times and Emergency once.
    const history = [
      spend("2026-01-08", "Emergency", "Buy cellphone load for call", 1_150),
      spend("2026-02-07", "Online Buy", "Buy load", 1_100),
      spend("2026-03-05", "Online Buy", "Buy load using Maya wallet", 7_100),
      spend("2026-08-31", "Online Buy", "Buy load", 3_000),
    ];
    const match = itemFromHistory("TM EASY SURF 50 load", history);
    expect(match).toMatchObject({ item: "Online Buy", seen: 3 });
  });
});

describe("an affordability question", () => {
  it("is yes or no only when asked as one", () => {
    const ref = { wallets: ["Cash"], savings: [], spendingTypes: [] };
    expect(readAffordAsk("How much should i use? The fare is 300", [], ref, "2026-10-04").yesNo).toBe(false);
    expect(readAffordAsk("can I spend 300 on the fare", [], ref, "2026-10-04").yesNo).toBe(true);
  });
});
