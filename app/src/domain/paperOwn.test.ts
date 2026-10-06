/**
 * A card teaches from its own picture only. 6 October 2026: a 7-Eleven card
 * for ₱426.00, sent beside a restaurant receipt for ₱2,475.00, was kept with
 * the restaurant's reading. Readings are invented in the same layouts.
 */
import { describe, expect, it } from "vitest";

import { filedOnItsOwn, nearestTaught, printedIn, type TaughtPaper } from "./paperMemory";

const restaurant = "KOREAN GRILL\n4 x UNLI A Pork............2,356\n1 x Coke 15........119\nJotal: 2.475\nThank you";
const store = "CONVENIENCE STORE\nCheese bun 2 @ 45.00\nSoft serve 1 @ 30.00\nTotal Amount Due 426.00\nMaya";

const taught = (over: Partial<TaughtPaper>): TaughtPaper => ({
  at: "2026-10-06T06:54:48.000Z",
  kind: "receipt",
  text: restaurant,
  paid: true,
  amount: 247500,
  flow: "Spending",
  category: "Spending",
  item: "Food",
  fromWallet: "Cash",
  toWallet: "",
  person: "",
  description: "",
  ...over,
});

describe("a figure printed the way a phone reads it", () => {
  it("is found with its separators read any way", () => {
    expect(printedIn(restaurant, 247500)).toBe(true);
    expect(printedIn("Tatal = 2 ,475", 247500)).toBe(true);
    expect(printedIn(store, 42600)).toBe(true);
    expect(printedIn("Total 426,00", 42600)).toBe(true);
    expect(printedIn("Interest earned 0.42", 42)).toBe(true);
  });

  it("is not found when only another figure is there", () => {
    expect(printedIn(restaurant, 42600)).toBe(false);
    expect(printedIn(store, 247500)).toBe(false);
  });
});

describe("a lesson filed against another picture", () => {
  const wrong = taught({ at: "2026-10-06T06:54:48.000Z", amount: 42600, fromWallet: "Maya", description: "7-Eleven" });
  const right = taught({ at: "2026-10-06T06:56:48.000Z" });

  it("is never used to file a paper like it", () => {
    expect(filedOnItsOwn(wrong)).toBe(false);
    expect(filedOnItsOwn(right)).toBe(true);
    expect(nearestTaught(restaurant, [wrong])).toBeNull();
    expect(nearestTaught(restaurant, [right, wrong])?.paper.amount).toBe(247500);
  });

  it("leaves an unpaid paper, or one with no amount, as it was", () => {
    expect(filedOnItsOwn(taught({ paid: false, amount: 99_900 }))).toBe(true);
    expect(filedOnItsOwn(taught({ amount: null }))).toBe(true);
  });
});
