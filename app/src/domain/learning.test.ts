/**
 * The assistant learns from cards the owner corrects and then saves.
 *
 * Settings said "Nothing yet" after weeks of corrections, because a change
 * made on the card or in the form was never kept, and a wallet correction
 * was kept against the wallet's own name and thrown away on reading.
 */

import { describe, expect, it } from "vitest";

import { correctionsFrom, taughtFor } from "./aiLog";
import { emptyDraft, type Draft } from "./entry";
import { REFERENCE } from "./eval/corpus";
import { lessonKey, lessonsFrom } from "./learning";

const card = (over: Partial<Draft>): Draft => ({ ...emptyDraft("2026-09-10"), flow: "Spending", category: "Spending", amount: 28500, ...over });
const items = [...REFERENCE.spendingTypes.map((s) => s.name), ...REFERENCE.bills, ...REFERENCE.subscriptions, ...REFERENCE.revenueCategories];
const wallets = [...REFERENCE.wallets, ...REFERENCE.savings];

describe("what a saved correction teaches", () => {
  it("keys a lesson on the words that name the thing, not the figure, the day or the wallet", () => {
    expect(lessonKey("jollibee 285 today using gcash", REFERENCE)).toBe("jollibee");
    expect(lessonKey("I paid 500 yesterday from maya", REFERENCE)).toBe("");
  });

  it("learns an item changed on the card, and uses it on the next sentence with those words", () => {
    const lessons = lessonsFrom(card({ item: "Treat", fromWallet: "Gcash" }), card({ item: "Food", fromWallet: "Gcash" }), "jollibee 285 today using gcash", REFERENCE);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ action: "edited", field: "item", proposed: "jollibee", corrected: "Food" });
    const learned = correctionsFrom(lessons, "item", items);
    expect(taughtFor("jollibee 350 cash", learned)).toBe("Food");
  });

  it("learns a wallet, which the old record threw away", () => {
    const lessons = lessonsFrom(card({ item: "Food", fromWallet: "Maya" }), card({ item: "Food", fromWallet: "Gcash" }), "lunch at the canteen 120", REFERENCE);
    const learned = correctionsFrom(lessons, "fromWallet", wallets);
    expect(taughtFor("canteen lunch 95", learned)).toBe("Gcash");
  });

  it("learns nothing from a card saved as it was read, or from a sentence that is only an item's own name", () => {
    expect(lessonsFrom(card({ item: "Food" }), card({ item: "Food" }), "jollibee 285", REFERENCE)).toEqual([]);
    expect(lessonsFrom(card({ item: "Treat" }), card({ item: "Food" }), "food 285", REFERENCE)).toEqual([]);
  });
});
