import { describe, expect, it } from "vitest";

import { checkDraft, emptyDraft, type Draft } from "./entry";
import type { ReferenceLists } from "./types";

/**
 * A row whose kind and category disagree is refused before it is saved.
 *
 * 28 September 2026: "revenue 14 pesos change of the electric bill payment"
 * was saved as Spending filed under Revenue, and every total that splits by
 * category read it one way while every total that splits by kind read it
 * the other.
 */

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash"],
  savings: [],
  bills: ["Electric bill"],
  subscriptions: [],
  revenueCategories: ["Random"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

const draft = (over: Partial<Draft>): Draft => ({
  ...emptyDraft("2026-09-28"),
  amount: 1400,
  fromWallet: "Cash",
  toWallet: "Cash",
  ...over,
});

const errorOn = (d: Draft): string | undefined =>
  checkDraft(d, [], reference, [], "2026-09-28").errors.find((e) => e.field === "category")?.message;

describe("the kind and the category agree", () => {
  it("refuses Spending filed under Revenue, and says what to do", () => {
    const message = errorOn(draft({ flow: "Spending", category: "Revenue", item: "Random" }));
    expect(message).toContain("Spending cannot be filed under Revenue");
  });

  it("refuses Revenue filed under Spending", () => {
    expect(errorOn(draft({ flow: "Revenue", category: "Spending", item: "Random", fromWallet: "" }))).toBeDefined();
  });

  it("takes Spending under Bills, Subscriptions, Spending or none", () => {
    for (const category of ["Spending", "Bills", "Subscriptions", ""] as const) {
      expect(errorOn(draft({ flow: "Spending", category, item: "Food" }))).toBeUndefined();
    }
  });

  it("takes Revenue under Revenue, and a transfer under Transfer or none", () => {
    expect(errorOn(draft({ flow: "Revenue", category: "Revenue", item: "Random", fromWallet: "" }))).toBeUndefined();
    expect(errorOn(draft({ flow: "Transfer", category: "Transfer", toWallet: "Gcash" }))).toBeUndefined();
    expect(errorOn(draft({ flow: "Transfer", category: "", toWallet: "Gcash" }))).toBeUndefined();
  });
});
