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
    // Not on the list: answered as nothing would be wrong.
    expect(readSpendAsk("how much did I spend on the gym last month", items, asOf)).toBeNull();
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
    expect(words).toContain("The largest was PHP 809.00 on 2026-08-03 (Food at Mcdo).");
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
