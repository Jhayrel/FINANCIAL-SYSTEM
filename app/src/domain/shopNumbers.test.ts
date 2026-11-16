/** A shop with a number in its name, never a price; a bare number is a price (16 November 2026 battery). */
import { describe, expect, it } from "vitest";

import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";

const reference = {
  spendingTypes: ["Food", "Gas"].map((name) => ({ name, remark: "" })),
  revenueCategories: ["Allowance"],
  bills: [],
  subscriptions: [],
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
} as unknown as ReferenceLists;
const amount = (said: string) => readEntry(said, [], reference, "2026-11-16").draft.amount;

describe("a number that is a shop, and one that is a price", () => {
  it.each([
    ["gas yesterday 247 cash", 24_700],
    ["food 711 gcash", 71_100],
    ["bumili ako ng pagkain 500 cash sa 711", 50_000],
    ["snacks 85 at 7-11 cash", 8_500],
    ["bought snacks 30 at 24/7 cash", 3_000],
    ["food 120 at 247 cash", 12_000],
  ])("%s", (said, want) => {
    expect(amount(said)).toBe(want);
  });
});
