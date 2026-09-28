import { describe, expect, it } from "vitest";

import { looksLikeAnswer } from "./cardQuestions";
import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";

/**
 * With the model out of reach (28 September 2026, walking the app against a
 * local database): "spent 95 on breakfast using cash" asked what it was for,
 * and "delete the breakfast I just added" was then taken as the answer.
 */
const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: ["Globe at Home Wifi"],
  subscriptions: [],
  revenueCategories: ["Random"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Home Needs", remark: "Groceries, home items, small tools" },
    { name: "Gas", remark: "Motorcycle fuel" },
  ],
};

describe("common English words for what was bought", () => {
  it.each([
    ["spent 95 on breakfast using cash", "Food"],
    ["bought air freshener 109 cash", "Home Needs"],
    ["spent 200 fuel maya", "Gas"],
  ])("%s", (said, item) => {
    expect(readEntry(said, [], reference, "2026-09-28").draft.item).toBe(item);
  });

  it("never names an item the owner does not have", () => {
    // No Health type here, so "medicine" finds nothing rather than inventing one.
    expect(readEntry("bought medicine 150 cash", [], reference, "2026-09-28").draft.item).toBe("");
  });

  it("a water bill is not food", () => {
    expect(readEntry("paid water bill 300 gcash", [], reference, "2026-09-28").draft.item).not.toBe("Food");
  });
});

describe("an instruction is never the answer to a card's question", () => {
  it.each(["delete the breakfast I just added", "remove it", "show me a chart", "what did I spend today"])("%s", (said) => {
    expect(looksLikeAnswer(said, "item")).toBe(false);
  });
});
