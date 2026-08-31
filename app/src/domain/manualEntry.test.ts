/**
 * The manual form, and the three holes the ledger revealed.
 *
 * Found by sweeping the 492 rows in the database rather than by reading the
 * code, which is why they had survived: each one saves cleanly, and each one
 * is wrong in a way no screen complains about.
 */

import { describe, expect, it } from "vitest";

import { checkDraft, emptyDraft, MOST_MONEY } from "./entry";
import type { Draft } from "./entry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "Meals, snacks, drinks" }],
};

const ledger: Transaction[] = [];
const check = (d: Draft) => checkDraft(d, ledger, reference, []);
const messages = (d: Draft) => check(d).errors.map((e) => e.message).join(" ");

const spending = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft("2026-08-31"),
  flow: "Spending",
  category: "Spending",
  item: "Food",
  fromWallet: "Cash",
  amount: 10000,
  status: "Paid",
  ...over,
});

describe("a negative fee", () => {
  /**
   * The amount was guarded and the fee was not, and `total = amount + fee`,
   * so a fee of minus fifty turned a hundred peso row into a fifty peso one.
   * The database stores it happily: its rule checks that the parts add up,
   * not which way they point.
   */
  it("is refused", () => {
    expect(check(spending({ fee: -5000 })).ok).toBe(false);
    expect(messages(spending({ fee: -5000 }))).toContain("cannot be negative");
  });

  it("still allows no fee at all, and a real one", () => {
    expect(check(spending({ fee: 0 })).ok).toBe(true);
    expect(check(spending({ fee: 1800 })).ok).toBe(true);
  });
});

describe("a figure larger than the database will take", () => {
  /**
   * `firestore.rules` bounds money at the same value, so a larger figure is
   * refused at the write with "Missing or insufficient permissions": true,
   * unhelpful, and indistinguishable from the rules not being deployed.
   */
  it("is refused here, where it can be explained", () => {
    expect(check(spending({ amount: MOST_MONEY })).ok).toBe(false);
    expect(messages(spending({ amount: MOST_MONEY }))).toContain("more than this ledger stores");
  });

  it("counts the fee towards the limit, because the stored total does", () => {
    expect(check(spending({ amount: MOST_MONEY - 100, fee: 500 })).ok).toBe(false);
  });

  it("allows anything below it", () => {
    expect(check(spending({ amount: MOST_MONEY - 1 })).ok).toBe(true);
  });

  /** The owner's own test rows are well inside it and must stay saveable. */
  it("allows the largest figure already in the ledger", () => {
    expect(check(spending({ amount: 10_000_000_000 })).ok).toBe(true);
  });
});

describe("a row with no item", () => {
  /**
   * Record #442 is in the ledger as Spending, PHP 371.00, item blank. It is
   * real money and it is invisible to every report that groups by item.
   *
   * A warning and not an error: a blank item has always been allowed and
   * some imported history has none, so refusing would make part of the
   * owner's own past unwritable.
   */
  it("warns, and still saves", () => {
    const result = check(spending({ item: "" }));
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.message).join(" ")).toContain("not appear in any breakdown");
  });

  it("says nothing when there is an item", () => {
    expect(check(spending()).warnings.map((w) => w.field)).not.toContain("item");
  });

  /** A transfer names no thing bought, and its item is derived, not typed. */
  it("does not nag about a transfer", () => {
    const moved = spending({
      flow: "Transfer",
      category: "Transfer",
      item: "",
      toWallet: "Gcash",
    });
    expect(check(moved).warnings.map((w) => w.field)).not.toContain("item");
  });
});
