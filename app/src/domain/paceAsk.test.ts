/** "Am I spending too much on food?" (paceAsk.ts, 27 October 2026 sweep). Rows are invented. */
import { describe, expect, it } from "vitest";
import { paceAnswer, readPaceAsk } from "./paceAsk";
import type { Transaction } from "./types";

let n = 0;
const spend = (date: string, item: string, pesos: number): Transaction => {
  n += 1;
  return { id: `p${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description: "", amount: pesos * 100, fee: 0, total: pesos * 100, notes: "", status: "Paid" };
};
const asOf = "2026-10-26";
const rows = [
  spend("2026-07-10", "Food", 400), spend("2026-07-28", "Food", 900),
  spend("2026-08-12", "Food", 1600),
  spend("2026-09-02", "Food", 2600), spend("2026-09-30", "Food", 700),
  spend("2026-10-05", "Food", 5000), spend("2026-10-20", "Food", 3600),
  spend("2026-10-21", "Gas", 300),
];
const items = ["Food", "Gas", "Online Buy"];

describe("am I spending too much", () => {
  it("knows the question, with or without a kind", () => {
    expect(readPaceAsk("am I spending too much on food?", items)).toEqual({ item: "Food" });
    expect(readPaceAsk("am I overspending?", items)).toEqual({ item: null });
    expect(readPaceAsk("is my food spending too high?", items)).toEqual({ item: "Food" });
    expect(readPaceAsk("sobra na ba gastos ko sa food?", items)).toEqual({ item: "Food" });
    expect(readPaceAsk("how much did I spend on food?", items)).toBeNull();
    expect(readPaceAsk("I spent too much on food yesterday 500", items)).toBeNull();
  });
  it("measures this month to today against the same days before, and the limit", () => {
    expect(paceAnswer({ item: "Food" }, rows, asOf, 600_000)).toBe(
      "Yes, more than usual: ₱8,600.00 on Food by October 26, against ₱1,533.33 on average by October 26 in July, August and September (₱7,066.67 more). Each month by October 26: July ₱400.00, August ₱1,600.00, September ₱2,600.00. It is over its October limit of ₱6,000.00 by ₱2,600.00.",
    );
  });
  it("says when there is nothing to measure against", () => {
    expect(paceAnswer({ item: "Gas" }, rows, asOf)).toMatch(/^₱300\.00 on Gas this month so far, and nothing in the same days of July, August and September/);
  });
});
