import { describe, expect, it } from "vitest";

import { inPeriod, matchesSearch, parseSearch } from "./search";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction> = {}): Transaction => ({
  id: "t-1",
  recordNumber: 1,
  date: "2026-08-20",
  type: "Spending",
  fromWallet: "Gcash",
  toWallet: "",
  category: "Spending",
  item: "Food",
  description: "Lunch at the canteen",
  amount: 15000,
  fee: 0,
  total: 15000,
  notes: "",
  status: "Paid",
  ...over,
});

const finds = (t: Transaction, query: string): boolean => matchesSearch(t, parseSearch(query));

describe("search: words", () => {
  it("needs every word to match, each in any field", () => {
    expect(finds(row(), "food gcash")).toBe(true);
    expect(finds(row(), "canteen GCASH")).toBe(true);
    expect(finds(row(), "food maya")).toBe(false);
  });

  it("matches every row when nothing is typed", () => {
    expect(finds(row(), "   ")).toBe(true);
  });
});

describe("search: amounts", () => {
  const big = row({ amount: 150000, total: 150000 });

  it("reads >1000 and <1000 as over and under, strictly", () => {
    expect(finds(big, ">1000")).toBe(true);
    expect(finds(big, "<1000")).toBe(false);
    expect(finds(big, ">1,500")).toBe(false);
    expect(finds(big, ">1499.99")).toBe(true);
    expect(finds(big, "<1500.01")).toBe(true);
  });

  it("compares the total, fee included", () => {
    const withFee = row({ type: "Transfer", amount: 100000, fee: 1500, total: 101500 });
    expect(finds(withFee, ">1010")).toBe(true);
    expect(finds(withFee, "<1010")).toBe(false);
  });

  it("reads P500 as exactly that amount, fee or total", () => {
    const sent = row({ type: "Transfer", amount: 50000, fee: 1500, total: 51500 });
    expect(finds(sent, "p500")).toBe(true);
    expect(finds(sent, "₱515")).toBe(true);
    expect(finds(sent, "php15")).toBe(true);
    expect(finds(sent, "P501")).toBe(false);
  });

  it("still finds a plain number the way it is shown", () => {
    const rent = row({ amount: 500000, total: 500000 });
    expect(finds(rent, "5000")).toBe(true);
    expect(finds(rent, "5,000")).toBe(true);
    expect(finds(rent, "5000.00")).toBe(true);
    expect(finds(rent, "6000")).toBe(false);
  });

  it("treats a sign with no figure after it as ordinary text", () => {
    expect(parseSearch(">x")).toEqual([{ kind: "text", value: ">x" }]);
  });
});

describe("search: records", () => {
  it("reads #442 as that record and no other", () => {
    expect(finds(row({ recordNumber: 442 }), "#442")).toBe(true);
    expect(finds(row({ recordNumber: 442 }), "#0442")).toBe(true);
    expect(finds(row({ recordNumber: 1442 }), "#442")).toBe(false);
  });
});

describe("search: date shortcuts", () => {
  const asOf = "2026-08-29";

  it("today and yesterday", () => {
    expect(inPeriod("2026-08-29", "today", asOf)).toBe(true);
    expect(inPeriod("2026-08-28", "today", asOf)).toBe(false);
    expect(inPeriod("2026-08-28", "yesterday", asOf)).toBe(true);
    expect(inPeriod("2026-08-31", "yesterday", "2026-09-01")).toBe(true);
  });

  it("the last 7 days include today and stop at today", () => {
    expect(inPeriod("2026-08-23", "week", asOf)).toBe(true);
    expect(inPeriod("2026-08-22", "week", asOf)).toBe(false);
    expect(inPeriod("2026-08-30", "week", asOf)).toBe(false);
  });

  it("this month is the whole calendar month", () => {
    expect(inPeriod("2026-08-01", "month", asOf)).toBe(true);
    expect(inPeriod("2026-08-31", "month", asOf)).toBe(true);
    expect(inPeriod("2026-07-31", "month", asOf)).toBe(false);
    expect(inPeriod("2025-08-15", "month", asOf)).toBe(false);
  });

  it("any date is every date", () => {
    expect(inPeriod("2020-01-01", "all", asOf)).toBe(true);
  });
});
