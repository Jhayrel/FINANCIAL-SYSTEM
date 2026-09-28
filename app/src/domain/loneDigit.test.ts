import { describe, expect, it } from "vitest";

import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";

/**
 * One digit is an amount when it is the only figure and counts nothing.
 * 28 September 2026: "6 unknown spending" was asked "How much was it?".
 */

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [{ name: "Unknown", remark: "" }, { name: "Food", remark: "" }],
};
const amount = (text: string) => readEntry(text, [], reference, "2026-09-28").draft.amount;

describe("a lone digit", () => {
  it("is the amount when nothing else is", () => {
    expect(amount("6 unknown spending")).toBe(600);
    expect(amount("I spent 5 pesos on candy cash")).toBe(500);
    expect(amount("paid 6 for lunch")).toBe(600);
  });

  it("is not an amount when it counts something", () => {
    expect(amount("bought 1 kilo of rice")).toBeNull();
    expect(amount("spent on food 3 days ago")).toBeNull();
  });

  it("gives way to a real figure", () => {
    expect(amount("bought 2 pcs of bread for 60")).toBe(6000);
  });
});
