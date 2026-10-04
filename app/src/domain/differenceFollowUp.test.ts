/**
 * A told balance is looked into, never saved; the guess at the difference
 * becomes a card only when the next message asks for it.
 *
 * The owner, 5 October 2026, after "MY BALANCE NOW IN MAYA IS 6000" came back
 * with a card saving PHP 2,040.56 as unknown spending: "fix this it should
 * know if I am asking or adding entry or investigation etc". Figures here
 * are invented.
 */

import { describe, expect, it } from "vitest";

import { asksToAddTheDifference, differenceNextStep, namedForTheDifference } from "./differenceFollowUp";
import { emptyDraft, type Draft } from "./entry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance", "Random"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "School", remark: "" },
    { name: "Online Buy", remark: "Shopee, Lazada, load" },
  ],
};

const guess: Draft = {
  ...emptyDraft("2026-10-05"),
  flow: "Spending",
  category: "Spending",
  fromWallet: "Maya",
  amount: 204056,
  description: "Spent, not written down at the time",
  status: "Paid",
};

describe("after a difference is found", () => {
  it("says nothing was added, and how to add it", () => {
    expect(differenceNextStep(guess, "Maya")).toBe(
      'Nothing is added. Say what the ₱2,040.56 was ("it was food"), send Maya\'s history to find it, or say "add it" to record it as spending not written down.',
    );
  });

  it("adds it only when asked", () => {
    for (const said of ["add it", "Add it.", "ok add it", "yes add it", "record it", "add the difference", "add it as unknown", "sige add it"]) {
      expect(asksToAddTheDifference(said), said).toBe(true);
    }
    for (const said of ["why is it different?", "check again", "it was food", "add 500 food", "don't add it"]) {
      expect(asksToAddTheDifference(said), said).toBe(false);
    }
  });

  it("takes what it was from a few words", () => {
    expect(namedForTheDifference("it was food", guess, reference)).toMatchObject({ item: "Food", amount: 204056, fromWallet: "Maya", description: "it was food" });
    expect(namedForTheDifference("for school", guess, reference)?.item).toBe("School");
    expect(namedForTheDifference("Load", guess, reference)?.item).toBe("Online Buy");
  });

  it("leaves a new entry, a question or an unknown word alone", () => {
    expect(namedForTheDifference("paid 2040 for shoes from maya", guess, reference)).toBeNull();
    expect(namedForTheDifference("what was it?", guess, reference)).toBeNull();
    expect(namedForTheDifference("no idea", guess, reference)).toBeNull();
  });
});
