/**
 * A credit line is not one of your accounts.
 *
 * "I recived it in maya and the credit is from maya credit" produced a
 * Transfer from Maya to Maya: the same wallet on both sides, PHP 5,000, and
 * the error "A transfer needs two different wallets" sitting under it in red.
 * The card could not be saved and nothing on it could be corrected into
 * something that could.
 *
 * The reader had never heard of Maya Credit. It found the account "Maya"
 * inside those two words and used it for the source and the destination both.
 * A credit line is where borrowed money comes from, it is never an account,
 * and a sentence naming one is a sentence about debt.
 */

import { describe, expect, it } from "vitest";

import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Gcash", "Maya", "Cash"],
  savings: ["Maya Bank (Personal savings)"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "Meals, snacks, drinks" }],
  credits: ["Maya Credit"],
};

const read = (text: string) => readEntry(text, [], reference, "2026-09-05");

describe("a sentence that names a credit line", () => {
  it("reads as debt, not as a transfer", () => {
    const r = read("I recived it in maya and the credit is from maya credit");
    expect(r.readsAsDebt).toBe(true);
    expect(r.draft.flow).toBe("Debt");
  });

  it("never puts the same wallet on both ends", () => {
    const r = read("I recived it in maya and the credit is from maya credit");
    expect(r.draft.fromWallet === r.draft.toWallet && r.draft.fromWallet !== "").toBe(false);
  });

  it("reads it however the punctuation falls", () => {
    for (const said of ["from maya credit", "from Maya Credit", "from maya-credit"]) {
      expect(read(`I borrowed 2000 ${said} into gcash`).readsAsDebt).toBe(true);
    }
  });

  it("still keeps the amount and the wallet it did read", () => {
    const r = read("I borrowed 2000 on maya credit into gcash");
    expect(r.draft.amount).toBe(200000);
    expect(r.draft.fromWallet).toBe("Gcash");
  });

  /**
   * The safety property. Naming the account Maya must go on meaning the
   * account Maya, or every ordinary entry becomes debt.
   */
  it("leaves an ordinary sentence about Maya alone", () => {
    const r = read("I paid 500 for food from maya");
    expect(r.readsAsDebt).toBe(false);
    expect(r.draft.flow).toBe("Spending");
    expect(r.draft.fromWallet).toBe("Maya");
  });

  it("leaves an ordinary transfer alone", () => {
    const r = read("I transferred 2000 from maya to gcash");
    expect(r.readsAsDebt).toBe(false);
    expect(r.draft.toWallet).toBe("Gcash");
  });

  it("works when no credit lines are configured at all", () => {
    const none: ReferenceLists = { ...reference, credits: [] };
    const r = readEntry("I paid 500 for food from maya", [], none, "2026-09-05");
    expect(r.readsAsDebt).toBe(false);
    expect(r.draft.fromWallet).toBe("Maya");
  });

  it("works when the field is absent, as it is in older callers", () => {
    const { credits: _drop, ...older } = reference;
    const r = readEntry("I paid 500 for food from maya", [], older, "2026-09-05");
    expect(r.draft.fromWallet).toBe("Maya");
  });
});
