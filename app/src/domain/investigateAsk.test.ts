import { describe, expect, it } from "vitest";

import { matchedOnIn, readInvestigateAsk } from "./investigateAsk";

const accounts = ["Cash", "Gcash", "Maya", "Maya Bank (Personal savings)"];
const recorded = (account: string): number => ({ Cash: 500_000, Gcash: 450_000, Maya: 5_000_000 })[account] ?? 0;
const read = (text: string) => readInvestigateAsk(text, accounts, recorded);

describe("asking where a difference went", () => {
  it("reads the owner's own example", () => {
    expect(read("my maya balance is 30000 where's the rest")).toEqual({ account: "Maya", actual: 3_000_000, gap: null });
  });

  it("takes the figure that is not the ledger's as what the account holds", () => {
    expect(read("maya app says 30,000 but here it says 50,000")).toEqual({ account: "Maya", actual: 3_000_000, gap: null });
    expect(read("in the system it's 50k but my maya is only 30k, doesn't match")).toEqual({
      account: "Maya",
      actual: 3_000_000,
      gap: null,
    });
  });

  it("reads a counted cash balance", () => {
    expect(read("I counted my cash and I only have 2000")).toEqual({ account: "Cash", actual: 200_000, gap: null });
  });

  it("reads a figure that is missing rather than held", () => {
    expect(read("where did my 20k in maya go")).toEqual({ account: "Maya", actual: null, gap: 2_000_000 });
  });

  it("reads a request with no figure, for the chat to ask", () => {
    expect(read("gcash doesn't match, can you investigate")).toEqual({ account: "Gcash", actual: null, gap: null });
  });

  it("does not take Gcash for Cash, or a savings account for Maya", () => {
    expect(read("my gcash balance is 4000, where is the rest")?.account).toBe("Gcash");
    expect(read("maya bank personal savings balance is 1000 where is the rest")?.account).toBe("Maya Bank (Personal savings)");
  });

  it("leaves ordinary questions and entries alone", () => {
    expect(read("where did I spend the most this month")).toBeNull();
    expect(read("I paid 500 for food from maya")).toBeNull();
    expect(read("how much is in maya")).toBeNull();
  });
});

describe("the day it last matched", () => {
  it("reads yesterday, days ago and a named day, and never takes them for money", () => {
    const asked = readInvestigateAsk("yesterday my maya matched 100% but now the bank has extra money, it says 50,250", accounts, recorded, "2026-09-17");
    expect(asked).toMatchObject({ account: "Maya", actual: 5_025_000, matchedOn: "2026-09-16" });
    expect(matchedOnIn("gcash was correct 3 days ago", "2026-09-17")).toBe("2026-09-14");
    expect(matchedOnIn("it matched on sep 10", "2026-09-17")).toBe("2026-09-10");
    expect(matchedOnIn("where did my 20k go", "2026-09-17")).toBeNull();
  });
});
