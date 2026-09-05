/**
 * Which field to check, rather than whether to keep the card.
 *
 * ── The number this exists for ────────────────────────────────────────────
 *
 * The record holds 24 rejected cards against 2 corrections. Rejecting is one
 * tap and correcting is several, so almost every time the assistant was
 * wrong the whole card went in the bin. A rejection teaches it nothing: it
 * makes the same guess again tomorrow. A correction is the only thing that
 * teaches, and it was happening twice in three hundred and seventy events.
 *
 * Usually only one field was wrong. "I paid my friend 600 cash because I buy
 * clubshirt" had the date, the wallet and the amount right and the item
 * wrong, and it was thrown away whole.
 *
 * So `inferFromHistory` says which fields it guessed rather than read. The
 * card points at those, and correcting one becomes the obvious action.
 */

import { describe, expect, it } from "vitest";

import { inferFromHistory } from "./infer";
import { emptyDraft } from "./entry";
import type { Draft } from "./entry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Gas", remark: "Fuel for vehicle" },
  ],
};

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `i-${n}`,
    recordNumber: n,
    date: "2026-08-01",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Gas",
    description: "",
    amount: 20000,
    fee: 0,
    total: 20000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const ledger = [row(), row(), row()];

const spending = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft("2026-09-05"),
  flow: "Spending",
  ...over,
});

describe("it says what it guessed", () => {
  it("names a field it filled from history", () => {
    const result = inferFromHistory(spending({ amount: 25000 }), ledger, reference, "gas");
    expect(result.unsure).toContain("item");
  });

  /**
   * A field the sentence gave is not a guess. It was already filled when
   * this ran, which is the whole distinction.
   */
  it("says nothing about a field the sentence already filled", () => {
    const stated = spending({ item: "Food", fromWallet: "Maya", amount: 25000 });
    const result = inferFromHistory(stated, ledger, reference, "food");
    expect(result.unsure).not.toContain("item");
    expect(result.unsure).not.toContain("fromWallet");
  });

  it("keeps the list empty when it filled nothing", () => {
    const full = spending({
      item: "Food",
      fromWallet: "Maya",
      category: "Spending",
      amount: 25000,
      status: "Paid",
    });
    expect(inferFromHistory(full, ledger, reference, "food").unsure).toEqual([]);
  });

  /** Debt never goes through here, so it has nothing to be unsure about. */
  it("says nothing for a debt movement", () => {
    const debt = spending({ flow: "Debt", amount: 25000 });
    expect(inferFromHistory(debt, ledger, reference, "borrowed").unsure).toEqual([]);
  });

  it("names every guessed field, not just the first", () => {
    const bare = spending({ amount: 25000 });
    const result = inferFromHistory(bare, ledger, reference, "gas");
    expect(result.unsure.length).toBeGreaterThan(1);
  });

  /** The reasons and the list describe the same work, so they agree. */
  it("has a reason for everything it says it guessed", () => {
    const result = inferFromHistory(spending({ amount: 25000 }), ledger, reference, "gas");
    expect(result.because.length).toBeGreaterThanOrEqual(1);
    expect(result.unsure.length).toBeGreaterThanOrEqual(1);
  });
});
