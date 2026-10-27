/**
 * "How much did I spend on food in August?", answered on the device
 * (`spendAsk.ts`), with the same windows the charts read and the same cost
 * per row the Insights screen adds up.
 */

import { describe, expect, it } from "vitest";

import { readSpendAsk, spendAnswer } from "./spendAsk";
import type { Transaction } from "./types";

let n = 0;
const spend = (date: string, item: string, pesos: number, description = ""): Transaction => {
  n += 1;
  return {
    id: `s-${n}`,
    recordNumber: n,
    date,
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item,
    description,
    amount: pesos * 100,
    fee: 0,
    total: pesos * 100,
    notes: "",
    status: "Paid",
  };
};

const ledger = [
  spend("2026-07-03", "Food", 500),
  spend("2026-08-03", "Food", 809, "Food at Mcdo"),
  spend("2026-08-15", "Food", 400),
  spend("2026-08-20", "Gas", 300),
  spend("2026-09-16", "Gas", 250),
];
const items = ["Food", "Gas", "Online Buy", "Treat"];
const asOf = "2026-09-28";

describe("reading the question", () => {
  it("reads an item and a month", () => {
    expect(readSpendAsk("how much did I spend on food in august?", items, asOf)).toEqual({ item: "Food", from: "2026-08-01", to: "2026-08-31", name: "August 2026" });
  });

  it("reads Tagalog", () => {
    expect(readSpendAsk("magkano nagastos ko sa pagkain nung august", items, asOf)).toMatchObject({ item: "Food", from: "2026-08-01" });
  });

  it("reads through the slips people make on a phone", () => {
    expect(readSpendAsk("hw much i spnt on gas last wek", items, asOf)).toMatchObject({ item: "Gas" });
  });

  it("reads a total with no item", () => {
    expect(readSpendAsk("how much did I spend this month", items, asOf)).toMatchObject({ item: null, from: "2026-09-01" });
    expect(readSpendAsk("total spending last month", items, asOf)).toMatchObject({ item: null, from: "2026-08-01" });
  });

  it("leaves to the model what it cannot place exactly", () => {
    // Not on the list: the entries whose words say it, never "nothing" (27 October 2026 sweep).
    expect(readSpendAsk("how much did I spend on the gym last month", items, asOf)).toMatchObject({ item: null, word: "gym" });
    expect(readSpendAsk("how much did I spend on it last month", items, asOf)).toBeNull();
    // About the future, or a decision.
    expect(readSpendAsk("how much would I save if I cut treats", items, asOf)).toBeNull();
    expect(readSpendAsk("how much can I spend on food this week", items, asOf)).toBeNull();
  });
});

describe("the answer", () => {
  it("gives the sum, the count, the largest, and the month before", () => {
    const ask = readSpendAsk("how much did I spend on food in august?", items, asOf);
    expect(ask).not.toBeNull();
    const words = spendAnswer(ask!, ledger, asOf);
    expect(words).toContain("You spent **PHP 1,209.00** on Food in August 2026, over 2 entries.");
    expect(words).toContain("The largest was PHP 809.00, #0002 on August 3, 2026 (Food at Mcdo).");
    expect(words).toContain("That is PHP 709.00 more than the month before (PHP 500.00).");
  });

  it("says nothing was spent, rather than a zero with no context", () => {
    const words = spendAnswer({ item: "Treat", from: "2026-08-01", to: "2026-08-31", name: "August 2026" }, ledger, asOf);
    expect(words).toMatch(/^Nothing on Treat in August 2026/);
  });

  it("never counts a binned row", () => {
    const binned = { ...spend("2026-08-05", "Food", 1_000), deletedAt: "2026-08-06T00:00:00Z" } as Transaction;
    const words = spendAnswer({ item: "Food", from: "2026-08-01", to: "2026-08-31", name: "August 2026" }, [...ledger, binned], asOf);
    expect(words).toContain("PHP 1,209.00");
  });
});

describe("one day by its weekday or 'days ago' (26 October 2026)", () => {
  // 28 September 2026 is a Monday.
  it("reads the day, not the days up to it, and lists what was bought", () => {
    const rows = [...ledger, spend("2026-09-25", "Food", 120, "Lunch"), spend("2026-09-25", "Gas", 200)];
    const friday = readSpendAsk("what did i buy last friday?", items, asOf);
    expect(friday).toMatchObject({ item: null, from: "2026-09-25", to: "2026-09-25", name: "Friday, September 25", list: true });
    const text = spendAnswer(friday!, rows, asOf);
    expect(text).toContain("on Friday, September 25, over 2 entries.");
    expect(text).toMatch(/\n- #\d{4} Food, Lunch: PHP 120\.00\n- #\d{4} Gas: PHP 200\.00$/);
    expect(readSpendAsk("what did I spend 3 days ago?", items, asOf)).toMatchObject({ from: "2026-09-25", to: "2026-09-25" });
    expect(spendAnswer(readSpendAsk("what did I spend 2 days ago?", items, asOf)!, rows, asOf)).toBe("Nothing on Saturday, September 26: no spending entry that day.");
  });

  it("reads this week as Monday to today", () => {
    expect(readSpendAsk("how much did I spend this week?", items, asOf)).toMatchObject({ from: "2026-09-28", to: "2026-09-28", name: "this week, today" });
  });
});

// "how much did I spend on shoes?" got the month's summary with the AI off (27 October 2026 sweep).
describe("a thing on no list", () => {
  const rows = [...ledger, spend("2026-03-22", "Online Buy", 2194.5, "Buy shoes adidas"), spend("2026-09-10", "Clothes", 899, "School shoe"), spend("2026-09-12", "Food", 120, "Snacks")];
  it("counts the entries whose words say it, and says where they are filed", () => {
    const ask = readSpendAsk("how much did I spend on shoes this month?", items, asOf);
    expect(ask).toMatchObject({ item: null, word: "shoes" });
    expect(spendAnswer(ask!, rows, asOf)).toBe('You spent **PHP 899.00** on entries that say "shoes" in September 2026, over 1 entry. Filed under Clothes. The latest was PHP 899.00, #0007 on September 10, 2026 (School shoe).');
  });
  it("says the last year when the period has none", () => {
    const ask = readSpendAsk("how much did I spend on shoes in july?", items, asOf);
    expect(spendAnswer(ask!, rows, asOf)).toContain('No spending entry says "shoes" in July 2026. In the last year: **PHP 3,093.50** over 2 entries.');
  });
  it("says so when nothing ever did", () => {
    const ask = readSpendAsk("how much did I spend on concerts?", items, asOf);
    expect(spendAnswer(ask!, rows, asOf)).toMatch(/^No spending entry says "concerts" in September 2026, or in the last year\./);
  });
});
