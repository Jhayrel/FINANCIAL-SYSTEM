/**
 * Whether a correction fires a second time.
 *
 * The whole of "learning" in this app is a table of the owner's own
 * corrections, keyed on the sentence that produced the card. Read back with
 * an exact lookup it almost never matched twice, because the figure changes
 * between two of the same purchase. These are the cases that has to cover.
 */

import { describe, expect, it } from "vitest";

import { taughtFor } from "./aiLog";

describe("the same purchase, at a different figure", () => {
  const learned = new Map([["jollibee 200", "Food"]]);

  it("applies what it was told, at the new figure", () => {
    expect(taughtFor("jollibee 350", learned)).toBe("Food");
  });

  it("still applies to the sentence it was taught on", () => {
    expect(taughtFor("jollibee 200", learned)).toBe("Food");
  });

  it("applies when the sentence has grown around it", () => {
    expect(taughtFor("jollibee 350 paid with gcash today", learned)).toBe("Food");
  });

  it("says nothing about a sentence sharing none of its words", () => {
    expect(taughtFor("grab 150", learned)).toBeUndefined();
  });
});

describe("two corrections, one more specific than the other", () => {
  const learned = new Map([
    ["coffee", "Food"],
    ["coffee beans for the office", "Groceries"],
  ]);

  it("takes the one that says more about the sentence", () => {
    expect(taughtFor("coffee beans for the office 900", learned)).toBe("Groceries");
  });

  it("takes the general one when that is all the sentence says", () => {
    expect(taughtFor("coffee 90", learned)).toBe("Food");
  });
});

describe("a correction taught on a figure alone", () => {
  const learned = new Map([["500", "Food"]]);

  it("matches that sentence and nothing else", () => {
    expect(taughtFor("500", learned)).toBe("Food");
    // Otherwise every entry of PHP 500 would be booked as Food.
    expect(taughtFor("gas 500", learned)).toBeUndefined();
  });
});

describe("nothing to go on", () => {
  it("answers with nothing rather than guessing", () => {
    expect(taughtFor("", new Map([["food", "Food"]]))).toBeUndefined();
    expect(taughtFor("anything", new Map())).toBeUndefined();
    expect(taughtFor("!!!", new Map([["food", "Food"]]))).toBeUndefined();
  });
});

describe("a later correction replacing an earlier one", () => {
  it("uses the last thing it was told, which is what correctionsFrom stores", () => {
    // correctionsFrom writes oldest first and overwrites, so the map already
    // holds the latest. Same key, so the exact lookup answers.
    const learned = new Map([["jollibee", "Treat"]]);
    expect(taughtFor("jollibee 200", learned)).toBe("Treat");
  });
});
