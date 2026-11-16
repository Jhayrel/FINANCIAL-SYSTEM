/**
 * A message about a card already in the conversation (owner, 16 November
 * 2026). Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { aboutLast, discardedNamed, disputedFigure } from "./cardAgain";
import { emptyDraft, type Draft } from "./entry";

const ASOF = "2026-11-16";
const KINDS = ["Food", "Treat", "Fare", "Random necessities"];
const draft = (amount: number, item: string, description: string, fromWallet = "Wallet B"): Draft => ({
  ...emptyDraft(ASOF),
  flow: "Spending",
  category: "Spending",
  item,
  description,
  fromWallet,
  amount,
});

describe("a figure said to be not real", () => {
  it.each([
    ["There's no 5650 there check it again", 565_000],
    ["theres no 5650 there", 565_000],
    ["5650 is not in the picture", 565_000],
    ["the 5,650 is wrong", 565_000],
    ["walang 5650", 565_000],
    ["there is no ₱5,650.00", 565_000],
  ])("%s", (said, figure) => {
    expect(disputedFigure(said)).toBe(figure);
  });
  it.each(["food 5650", "no I paid 5650", "I have no money left 200", "there's 5650 there", "paid 5650 from wallet b"])("not %s", (said) => {
    expect(disputedFigure(said)).toBeNull();
  });
});

describe("a discarded card wanted back", () => {
  const cards = [
    { draft: draft(65_000, "Food", "Diner 0042") },
    { draft: draft(565_000, "", "Paid via wallet") },
    { draft: draft(65_000, "Food", "Diner 0042") },
    { draft: { ...draft(50_000, "", "Borrowed"), flow: "Debt" as const } },
  ];
  it("by what it was, newest of the same card", () => {
    expect(discardedNamed("Re add the food", cards)).toBe(2);
    expect(discardedNamed("readd the diner one", cards)).toBe(2);
    expect(discardedNamed("bring back the food", cards)).toBe(2);
  });
  it("by its figure", () => {
    expect(discardedNamed("The 650 earlier", cards)).toBe(2);
    expect(discardedNamed("re-add 5650", cards)).toBe(1);
  });
  it("never without words that point back, nor when two different cards answer", () => {
    expect(discardedNamed("the food", cards)).toBeNull();
    expect(discardedNamed("food 650", cards)).toBeNull();
    expect(discardedNamed("re add the food?", cards)).toBeNull();
    expect(discardedNamed("re add the one earlier", cards)).toBeNull();
    expect(discardedNamed("re add the food", [...cards, { draft: draft(9_000, "Food", "Bakery") }])).toBeNull();
    expect(discardedNamed("re add the food", [])).toBeNull();
  });
});

describe("words about the entry just added", () => {
  const last = { item: "Treat", description: "" };
  it("give its description, a word one letter off its kind written as the kind", () => {
    expect(aboutLast("Thats treas my friends at the diner", last, KINDS)).toEqual({ description: "Treat my friends at the diner" });
    expect(aboutLast("it was for my sister's birthday", last, KINDS)).toEqual({ description: "My sister's birthday" });
  });
  it("or name its kind", () => {
    expect(aboutLast("that's food", last, KINDS)).toEqual({ item: "Food" });
    expect(aboutLast("it's a treat", last, KINDS)).toEqual({ item: "Treat", same: true });
  });
  it("say when it already says so", () => {
    expect(aboutLast("that's treat my friends at the diner", { item: "Treat", description: "Treat my friends at the diner" }, KINDS)).toMatchObject({ same: true });
  });
  it("and are nothing else", () => {
    for (const said of ["that's wrong", "thats all", "it's a budget", "that was 50", "is that right?", "bought snacks", "treat my friends", "that's it"]) {
      expect(aboutLast(said, last, KINDS), said).toBeNull();
    }
  });
});
