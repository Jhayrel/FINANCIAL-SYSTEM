/**
 * "can you show me and delete those wrong transactions" (21 September 2026)
 * got a list matched on the word "transactions": "it just show me random
 * things. I like the ai to find the bad transactions". The wrong rows are
 * the ones the app's own checks flag.
 */

import { describe, expect, it } from "vitest";

import { asksForWrongRows, flaggedRows } from "./integrity";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction>): Transaction => ({
  id: `t${over.recordNumber ?? 1}`, recordNumber: 1, date: "2026-09-20", type: "Spending", fromWallet: "Cash", toWallet: "",
  category: "Spending", item: "Food", description: "", amount: 10_000, fee: 0, total: 10_000, notes: "", status: "Paid", ...over,
});

describe("asking for the wrong rows as a set", () => {
  for (const said of [
    "can you balance my spending why I have too much negative can you show me and delete those wrong transactions",
    "find the bad entries",
    "show me the mistakes",
    "what needs review",
    "list the incorrect records",
  ]) {
    it(`hears "${said}"`, () => expect(asksForWrongRows(said)).toBe(true));
  }

  for (const said of ["that last transaction is wrong", "delete the food yesterday", "is my spending wrong this month?"]) {
    it(`leaves "${said}" to the other readers`, () => expect(asksForWrongRows(said)).toBe(false));
  }
});

describe("the rows the checks flag", () => {
  it("names each with what is wrong with it, and leaves the good ones out", () => {
    const good = row({ recordNumber: 1 });
    const noWallet = row({ recordNumber: 2, fromWallet: "" });
    const badTotal = row({ recordNumber: 3, amount: 10_000, fee: 0, total: 12_000 });
    const found = flaggedRows([good, noWallet, badTotal]);
    const ids = found.map((f) => f.row.id);
    expect(ids).toContain("t2");
    expect(ids).toContain("t3");
    expect(ids).not.toContain("t1");
    for (const f of found) expect(f.why.length).toBeGreaterThan(0);
  });
});
