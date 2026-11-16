/**
 * Money someone sends you to pass on, said as its purpose: "My mom sent
 * 14800 to my gcash to give to my aunt" asked which wallet it came out of
 * (16 November 2026 robot). Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { readBehalf } from "./debtSentence";
import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";

const reference = {
  spendingTypes: ["Food", "Gas", "Money Send"].map((name) => ({ name, remark: "" })),
  revenueCategories: ["Allowance"].map((name) => ({ name, remark: "" })),
  bills: [],
  subscriptions: [],
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
} as unknown as ReferenceLists;

describe("someone sends you money to give to someone else", () => {
  it.each([
    "My mom sent 14800 to my gcash to give to my aunt",
    "my father gave me 500 to give to my brother",
    "tita transferred 2000 to my maya to send to lola",
  ])("%s is held for them", (said) => {
    expect(readBehalf(said)).toEqual({ side: "held", effect: "draw" });
  });

  it("the card receives it into the wallet named, as money held for someone", () => {
    const read = readEntry("My mom sent 14800 to my gcash to give to my aunt", [], reference, "2026-11-16");
    expect(read.draft.flow).toBe("Debt");
    expect(read.draft.behalf).toBe("held");
    expect(read.draft.debtEffect).toBe("draw");
    expect(read.draft.amount).toBe(1_480_000);
    expect(read.draft.toWallet).toBe("Gcash");
  });

  it.each([
    "I sent 500 to my mom to give to my aunt",
    "I sent 548 to my mom from gcash",
    "my mom gave me 1000 allowance",
    "I transferred 1000 from maya to gcash",
  ])("%s is not", (said) => {
    expect(readBehalf(said)).not.toEqual({ side: "held", effect: "draw" });
  });
});
