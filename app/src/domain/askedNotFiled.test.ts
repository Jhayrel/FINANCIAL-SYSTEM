/**
 * A question is never filed as a row.
 *
 * "I have 20000 saved and tuition is 18000 next month, what should I do"
 * became two ledger entries:
 *
 *   2026-09-05 Spending School    PHP 20,000.00
 *   2026-09-05 Spending Parking   PHP 20,000.00
 *
 * Neither happened. It is a question about a decision, and being asked for
 * advice is the feature rather than something to file. Two other faults in
 * the same handful of sentences are pinned here too: a verb later in the
 * sentence deciding what the sentence was about, and an account name losing
 * its brackets.
 */

import { describe, expect, it } from "vitest";

import { isQuestion } from "./intent";
import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Gcash", "Maya", "Cash"],
  savings: ["Maya Bank (Personal savings)", "Reserved Fund"],
  bills: [],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "School", remark: "Tuition, school supplies" },
    { name: "Parking", remark: "Fee for parking any types" },
  ],
};

const read = (text: string) => readEntry(text, [], reference, "2026-09-05");

describe("asking for advice", () => {
  it("is a question even when it does not start with one", () => {
    expect(
      isQuestion("I have 20000 saved and tuition is 18000 next month, what should I do"),
    ).toBe(true);
  });

  it("is a question without a question mark", () => {
    expect(isQuestion("should I put my savings in crypto")).toBe(true);
    expect(isQuestion("is it worth it to buy this now")).toBe(true);
    expect(isQuestion("do you think I can afford it")).toBe(true);
  });

  it("reads it in Filipino too", () => {
    expect(isQuestion("dapat ba akong bumili nito")).toBe(true);
  });

  it("does not turn a plain entry into a question", () => {
    expect(isQuestion("I paid 500 for food from gcash")).toBe(false);
    expect(isQuestion("nag bayad ako ng tricycle 500 kanina cash")).toBe(false);
  });

  it("makes no entry out of the sentence that produced two", () => {
    const r = read("I have 20000 saved and tuition is 18000 next month, what should I do");
    expect(r.worthOffering).toBe(false);
  });
});

describe("the first verb decides what the sentence is about", () => {
  /**
   * Read as PHP 5,000 of Spending from Maya. The withdrawal became a
   * purchase, the school spending vanished, and the cash the owner was
   * holding was never recorded as arriving anywhere.
   */
  it("reads a withdrawal as a transfer, not as the spending that follows it", () => {
    const r = read("I withdrew 5000 from maya to cash, spent 1200 of it on school");
    expect(r.draft.flow).toBe("Transfer");
    expect(r.draft.amount).toBe(500000);
    expect(r.draft.fromWallet).toBe("Maya");
    expect(r.draft.toWallet).toBe("Cash");
  });

  it("still reads a plain purchase as spending", () => {
    expect(read("I paid 500 for food from gcash").draft.flow).toBe("Spending");
  });

  it("reads a purchase followed by a transfer as a purchase", () => {
    expect(read("I bought food for 300 then transferred 500 to gcash").draft.flow).toBe(
      "Spending",
    );
  });
});

describe("an account keeps its identity without its brackets", () => {
  /**
   * "Maya" was found inside "maya bank personal savings", so the destination
   * collapsed into the source and PHP 5,000 moved between two of the owner's
   * own accounts would have been booked as PHP 5,000 given away.
   */
  it("finds the savings account written longhand", () => {
    const r = read("I transferred 5000 from maya to maya bank personal savings");
    expect(r.draft.fromWallet).toBe("Maya");
    expect(r.draft.toWallet).toBe("Maya Bank (Personal savings)");
  });

  it("does not book it as money given away", () => {
    expect(read("I transferred 5000 from maya to maya bank personal savings").draft.sentOut).toBe(
      undefined,
    );
  });

  it("still tells the short name from the long one", () => {
    const r = read("I transferred 2000 from maya to gcash");
    expect(r.draft.fromWallet).toBe("Maya");
    expect(r.draft.toWallet).toBe("Gcash");
  });

  it("still finds a plain account name", () => {
    expect(read("I paid 500 for food from gcash").draft.fromWallet).toBe("Gcash");
  });
});
