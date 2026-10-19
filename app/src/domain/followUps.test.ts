import { describe, expect, it } from "vitest";

import { periodOnly, readSpendAsk } from "./spendAsk";

/* 13 October 2026: "Total summary of school spending", then "All years". */
describe("a sum asked as a summary, and a period said on its own", () => {
  it("reads a summary of one item's spending as a sum", () => {
    expect(readSpendAsk("Total summary of school spending", ["School", "Food"], "2026-10-15")?.item).toBe("School");
    expect(readSpendAsk("Total summary of school spending all years", ["School"], "2026-10-15")).toMatchObject({ item: "School", name: "the whole ledger" });
  });

  it("leaves a summary of everything to the chart that splits it", () => {
    expect(readSpendAsk("Show me a summary of my spending", ["School", "Food"], "2026-10-15")).toBeNull();
  });

  it("finds the period in a follow-up that is only a period", () => {
    expect(periodOnly("All years")).toBe("all years");
    expect(periodOnly("how about 2025?")).toBe("in 2025");
    expect(periodOnly("and last month")).toBe("last month");
    expect(periodOnly("All years of school")).toBeNull();
    expect(periodOnly("Framelink Media")).toBeNull();
  });
});

import { saysItWasAQuestion } from "./intent";

describe("it was a question to the AI", () => {
  it("is read as the question before, asked again", () => {
    for (const q of ["Thats a question to the ai", "it was a question to the ai", "I'm asking the AI", "that's a question"]) expect(saysItWasAQuestion(q), q).toBe(true);
    expect(saysItWasAQuestion("what is a question to the ai")).toBe(false);
  });
});

import { asksIncomeBudget, readIncomePlan } from "./incomeBudget";

describe("a budget question about recent income", () => {
  it("is the budget against what came in, not a plan to make (19 October 2026)", () => {
    const q = "With my recent income what can you propose in budget change?";
    expect(readIncomePlan(q)).toBeNull();
    expect(asksIncomeBudget(q)).toBe(true);
    expect(readIncomePlan("base my budget on my 10k income, save 20%")).toEqual({ income: 1000000, keep: { percent: 20 } });
  });
});

import { readEditAsk } from "./chatChanges";
import type { ReferenceLists } from "./types";

describe("an edit said without 'to'", () => {
  const ref = { wallets: ["Cash"], savings: [], spendingTypes: [], bills: [], subscriptions: [], revenueCategories: [] } as unknown as ReferenceLists;
  it("reads the amount (19 October 2026)", () => {
    expect(readEditAsk("Edit #3948 amount 0.27", ref, "2026-10-19")?.change.amount).toBe(27);
    expect(readEditAsk("#3948 should be 0.27", ref, "2026-10-19")?.change.amount).toBe(27);
    expect(readEditAsk("Edit the last entry with 1000 not 1050", ref, "2026-10-19")?.change.amount).toBe(100000);
    expect(readEditAsk("I paid 500 for food", ref, "2026-10-19")).toBeNull();
  });
});
