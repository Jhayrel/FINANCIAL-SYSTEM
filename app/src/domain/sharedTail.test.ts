/**
 * Two entries in one sentence, joined by "and" rather than "then".
 *
 * "I sent 500 to my mom's gcash and 500 to my own gcash, same day, from maya"
 * is two movements of two different kinds, and it produced one card. The
 * owner reported it across five sessions. Two things were missing: "and" was
 * never a separator, deliberately, because "gas and food" is one thing; and
 * the wallet was named once at the end, so splitting naively left the first
 * half with no source at all.
 *
 * "and" followed by a figure is a new entry. "and" followed by a word is a
 * continuation. That single distinction settles both cases.
 */

import { describe, expect, it } from "vitest";

import { readEntry, splitEntries } from "./readEntry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Gcash", "Maya", "Cash"],
  savings: ["Maya Bank (Personal savings)", "Reserved Fund"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance", "Framelink"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Gas", remark: "Fuel for vehicle" },
  ],
};

const read = (text: string) => readEntry(text, [], reference, "2026-09-05");

describe("and, when a figure follows it", () => {
  it("splits two payments", () => {
    expect(splitEntries("I paid 500 for food from gcash and 300 for gas from cash")).toEqual([
      "I paid 500 for food from gcash",
      "I paid 300 for gas from cash",
    ]);
  });

  it("reads both of them correctly", () => {
    const [a, b] = splitEntries("I paid 500 for food from gcash and 300 for gas from cash").map(
      read,
    );
    expect(a?.draft.item).toBe("Food");
    expect(a?.draft.fromWallet).toBe("Gcash");
    expect(b?.draft.item).toBe("Gas");
    expect(b?.draft.fromWallet).toBe("Cash");
  });

  it("splits two amounts of income", () => {
    expect(splitEntries("I got 5000 allowance and 2000 from framelink in maya")).toHaveLength(2);
  });
});

describe("and, when a word follows it", () => {
  /** The reason "and" was never a separator. This must not change. */
  it("leaves one entry alone", () => {
    expect(splitEntries("I paid 250 for gas and food from cash")).toEqual([
      "I paid 250 for gas and food from cash",
    ]);
  });

  it("leaves a description alone", () => {
    expect(splitEntries("I bought bread and milk for 120 from cash")).toHaveLength(1);
  });
});

describe("a wallet named once, at the end, belongs to all of them", () => {
  const said = "I sent 500 to my mom's gcash and 500 to my own gcash, same day, from maya";

  it("gives the source to the half that did not name one", () => {
    const [first] = splitEntries(said);
    expect(first).toContain("from maya");
  });

  it("reads the two halves as two different kinds of movement", () => {
    const [a, b] = splitEntries(said).map(read);
    // To a person: it left the accounts, so the whole amount is spending.
    expect(a?.draft.sentOut).toBe(true);
    expect(a?.draft.toWallet).toBe("");
    // To yourself: it is still yours, so only a fee would count.
    expect(b?.draft.toWallet).toBe("Gcash");
    expect(b?.draft.sentOut).toBeUndefined();
  });

  it("puts the same source on both", () => {
    for (const r of splitEntries(said).map(read)) {
      expect(r.draft.fromWallet).toBe("Maya");
    }
  });

  /** A sentence that names a source twice, and names two, keeps both. */
  it("does not overwrite a source a part already named", () => {
    const [a, b] = splitEntries(
      "I paid 500 for food from gcash and 300 for gas from cash",
    ).map(read);
    expect(a?.draft.fromWallet).toBe("Gcash");
    expect(b?.draft.fromWallet).toBe("Cash");
  });
});

describe("taking money back", () => {
  it("reads it as a movement rather than as nothing at all", () => {
    const r = read("immediately took 1500 back to maya");
    expect(r.worthOffering).toBe(true);
    expect(r.draft.flow).toBe("Transfer");
    expect(r.draft.amount).toBe(150000);
    expect(r.draft.toWallet).toBe("Maya");
  });

  it("reads the whole sentence it came from as two movements", () => {
    const parts = splitEntries(
      "I transferred 5000 from maya to maya bank personal savings, no fee, then immediately took 1500 back to maya",
    );
    expect(parts).toHaveLength(2);
    expect(read(parts[0]!).draft.toWallet).toBe("Maya Bank (Personal savings)");
    expect(read(parts[1]!).draft.amount).toBe(150000);
  });
});
