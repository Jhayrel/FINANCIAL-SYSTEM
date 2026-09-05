/**
 * Nearly right, which is worse than plainly wrong.
 *
 * A name nothing matches is obvious and gets fixed. A name one letter off
 * saves without complaint and then quietly splits a total in two: Food and
 * Foood both look right in the ledger, and neither adds up to what was spent
 * on food. The owner asked for the system to catch this.
 */

import { describe, expect, it } from "vitest";

import { confusablePairs, editsBetween, nearestName } from "./nearly";

const ITEMS = ["Food", "Gas", "School", "Online Buy", "Travel", "Fun", "Home Needs", "Repairs"];
const WALLETS = ["Gcash", "Maya", "Cash", "Maya Bank (Personal savings)"];

describe("how far apart two words are", () => {
  it("is nothing for the same word", () => {
    expect(editsBetween("Food", "food")).toBe(0);
  });

  it("counts a single letter", () => {
    expect(editsBetween("Food", "Foods")).toBe(1);
    expect(editsBetween("Gcash", "Gcash ".trim())).toBe(0);
  });

  it("counts a doubled letter as one edit", () => {
    expect(editsBetween("Food", "Foood")).toBe(1);
  });

  it("gives up rather than counting far apart words exactly", () => {
    expect(editsBetween("Food", "Repairs")).toBeGreaterThan(3);
  });
});

describe("a name that is nearly one on the list", () => {
  it("says nothing when it is exactly right", () => {
    expect(nearestName("Food", ITEMS)).toBeNull();
    expect(nearestName("Gcash", WALLETS)).toBeNull();
  });

  /**
   * The one that costs the most, because it looks completely fine. Two
   * spellings of one wallet group separately in every single total.
   */
  it("catches a name that differs only in case", () => {
    const miss = nearestName("gcash", WALLETS);
    expect(miss?.meant).toBe("Gcash");
    expect(miss?.note).toContain("separate thing in every total");
  });

  it("catches a name that differs only in spacing", () => {
    expect(nearestName("Online  Buy", ITEMS)?.meant).toBe("Online Buy");
  });

  it("catches an ordinary typo", () => {
    expect(nearestName("Foood", ITEMS)?.meant).toBe("Food");
    expect(nearestName("Travle", ITEMS)?.meant).toBe("Travel");
  });

  /**
   * The safety property. "Food" and "Fun" are two edits apart and are two
   * real, different items on this owner's own list. Folding one into the
   * other would be inventing what a row was for.
   */
  it("leaves a genuinely different short name alone", () => {
    expect(nearestName("Fun", ITEMS)).toBeNull();
    expect(nearestName("Gas", ITEMS)).toBeNull();
  });

  it("says nothing about a name that is nothing like the list", () => {
    expect(nearestName("Tricycle fare", ITEMS)).toBeNull();
    expect(nearestName("Coinbase", WALLETS)).toBeNull();
  });

  it("says nothing about an empty name", () => {
    expect(nearestName("", ITEMS)).toBeNull();
    expect(nearestName("   ", ITEMS)).toBeNull();
  });

  it("allows a second letter of slack on a long name", () => {
    expect(nearestName("Maya Bank (Personal savngs)", WALLETS)?.meant).toBe(
      "Maya Bank (Personal savings)",
    );
  });

  it("names both spellings, so the owner can see which is which", () => {
    const miss = nearestName("Foood", ITEMS);
    expect(miss?.written).toBe("Foood");
    expect(miss?.meant).toBe("Food");
  });
});

describe("two names on one list that are nearly each other", () => {
  it("finds a pair that will split every total between them", () => {
    const pairs = confusablePairs(["Food", "Foood", "Gas"]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.note).toContain("nearly the same name");
  });

  it("finds a pair that differs only in case", () => {
    expect(confusablePairs(["Gcash", "GCash"])).toHaveLength(1);
  });

  it("finds nothing in a clean list", () => {
    expect(confusablePairs(ITEMS)).toEqual([]);
    expect(confusablePairs(WALLETS)).toEqual([]);
  });

  it("does not flag two genuinely different short names", () => {
    expect(confusablePairs(["Fun", "Gas", "Food"])).toEqual([]);
  });
});
