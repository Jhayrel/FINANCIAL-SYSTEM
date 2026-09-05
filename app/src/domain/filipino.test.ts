/**
 * The other half of how the owner writes.
 *
 * These two messages produced nothing at all. No card, no answer, no reply:
 *
 *   nag bayad ako ng tricycle 500 kanina cash gamit ko
 *   bumuli ako ng pagkain 200 gcash
 *
 * Both are ordinary entries. Not one word in either was a word this app knew,
 * so the reader found no verb, no item and no date, and the message vanished.
 */

import { describe, expect, it } from "vitest";

import { daysBackIn, itemHintIn } from "./filipino";
import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Gcash", "Maya", "Cash"],
  savings: ["Maya Bank (Personal savings)"],
  bills: ["Globe at Home Wifi", "Dito Prepaid"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance", "Framelink"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Travel", remark: "Trips, fares, rides" },
    { name: "School", remark: "Tuition, school supplies" },
    { name: "Health", remark: "Medicine or medical needs" },
    { name: "Fun", remark: "Outings, parties, leisure" },
  ],
};

const read = (text: string) => readEntry(text, [], reference, "2026-09-05");

describe("the two sentences that vanished", () => {
  it("reads the tricycle fare, whole", () => {
    const r = read("nag bayad ako ng tricycle 500 kanina cash gamit ko");
    expect(r.worthOffering).toBe(true);
    expect(r.draft.flow).toBe("Spending");
    expect(r.draft.amount).toBe(50000);
    expect(r.draft.fromWallet).toBe("Cash");
    expect(r.draft.item).toBe("Travel");
  });

  it("reads the food, whole", () => {
    const r = read("bumuli ako ng pagkain 200 gcash");
    expect(r.worthOffering).toBe(true);
    expect(r.draft.flow).toBe("Spending");
    expect(r.draft.amount).toBe(20000);
    expect(r.draft.fromWallet).toBe("Gcash");
    expect(r.draft.item).toBe("Food");
  });
});

describe("the verbs, whichever prefix they wear", () => {
  it("reads paying", () => {
    for (const said of ["nagbayad ako 300 cash", "binayaran ko 300 sa cash", "bayad 300 cash"]) {
      expect(read(said).draft.flow).toBe("Spending");
    }
  });

  it("reads buying, including how the owner spells it", () => {
    expect(read("bumili ako ng pagkain 150 gcash").draft.flow).toBe("Spending");
    expect(read("bumuli ako ng pagkain 150 gcash").draft.flow).toBe("Spending");
  });

  it("reads money coming in", () => {
    expect(read("natanggap ko 5000 sa maya").draft.flow).toBe("Revenue");
  });

  it("reads money being sent", () => {
    expect(read("nagpadala ako 500 from gcash").draft.flow).toBe("Transfer");
  });

  it("still refuses to guess at borrowing", () => {
    expect(read("umutang ako 2000 sa maya credit").readsAsDebt).toBe(true);
  });
});

describe("when it happened", () => {
  it("reads earlier today", () => {
    expect(daysBackIn("kanina lang")).toBe(0);
    expect(read("nagbayad ako 300 cash kanina").draft.date).toBe("2026-09-05");
  });

  it("reads yesterday", () => {
    expect(daysBackIn("kahapon")).toBe(-1);
    expect(read("nagbayad ako 300 cash kahapon").draft.date).toBe("2026-09-04");
  });

  /** "kamakalawa" contains no "kahapon", but the order still has to hold. */
  it("reads the day before yesterday", () => {
    expect(daysBackIn("kamakalawa")).toBe(-2);
    expect(read("nagbayad ako 300 cash kamakalawa").draft.date).toBe("2026-09-03");
  });

  it("says nothing about a sentence with no day in it", () => {
    expect(daysBackIn("nagbayad ako 300 cash")).toBeNull();
  });
});

describe("the things bought", () => {
  it("maps the common ones", () => {
    expect(itemHintIn("pagkain")).toBe("food");
    expect(itemHintIn("pamasahe")).toBe("travel");
    expect(itemHintIn("gamot")).toBe("health");
    expect(itemHintIn("matrikula")).toBe("school");
  });

  it("says nothing about a word it does not know", () => {
    expect(itemHintIn("wala akong maisip")).toBe("");
  });

  /**
   * The safety property. A hint is matched against the owner's own list, so
   * it can never put an item on a row that they do not have.
   */
  it("never invents an item the owner does not have", () => {
    const noTravel: ReferenceLists = {
      ...reference,
      spendingTypes: [{ name: "Food", remark: "Meals, snacks, drinks" }],
    };
    const r = readEntry("nagbayad ako ng tricycle 500 cash", [], noTravel, "2026-09-05");
    expect(r.draft.item).toBe("");
  });

  it("leaves an English sentence exactly as it was", () => {
    const r = read("I paid 500 for food from gcash");
    expect(r.draft.item).toBe("Food");
    expect(r.draft.amount).toBe(50000);
  });
});
