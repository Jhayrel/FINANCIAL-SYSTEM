/**
 * Faults read out of the assistant's own record.
 *
 * Every case in this file comes from a real entry in `users/{uid}/ai`, seen
 * on the Settings screen. That record exists precisely so the assistant can
 * be fixed from evidence rather than from guesses, and a fault found that way
 * earns a test the same as any other.
 *
 * Keep the original wording. It is the wording that broke it.
 */

import { describe, expect, it } from "vitest";

import { matchItem } from "./capture";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance", "Framelink"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Gas", remark: "Fuel for vehicle" },
  ],
};

describe("the app's own vocabulary is never an item", () => {
  /**
   * The saved row this came from:
   *
   *     2026-08-29  Revenue  Revenue  PHP 100,000,000.00     accepted
   *
   * Asked what it was for, the answer was "revenue". Nothing matched it, and
   * the last rule keeps whatever is left as a new type, so the owner's list
   * of revenue categories gained one called "Revenue": beside Allowance and
   * Framelink, and meaning nothing.
   */
  it("refuses a flow name as an item", () => {
    for (const said of ["revenue", "Revenue", "spending", "transfer", "debt"]) {
      const { item, matched } = matchItem(said, "Revenue", "Revenue", reference);
      expect(item, said).toBe("");
      expect(matched, said).toBe(false);
    }
  });

  it("refuses a category name", () => {
    for (const said of ["bills", "subscriptions", "opening"]) {
      expect(matchItem(said, "Spending", "Spending", reference).item, said).toBe("");
    }
  });

  it("refuses a status word", () => {
    for (const said of ["paid", "received", "transferred", "pending"]) {
      expect(matchItem(said, "Spending", "Spending", reference).item, said).toBe("");
    }
  });

  /**
   * "gcash" answers which wallet, not what for. An item of that name would
   * then compete with the wallet of the same name in every ranking that
   * groups by item.
   */
  it("refuses an account name", () => {
    for (const said of ["gcash", "Cash", "maya", "Maya Bank (Personal savings)"]) {
      expect(matchItem(said, "Spending", "Spending", reference).item, said).toBe("");
    }
  });

  it("refuses the names of the fields themselves", () => {
    for (const said of ["amount", "wallet", "account", "category", "item"]) {
      expect(matchItem(said, "Spending", "Spending", reference).item, said).toBe("");
    }
  });
});

describe("but a real new item is still kept", () => {
  /** The guard must not swallow the ordinary case it sits next to. */
  it("keeps something genuinely new, tidied", () => {
    expect(matchItem("scuba lessons", "Spending", "Spending", reference)).toEqual({
      item: "Scuba lessons",
      matched: false,
    });
  });

  it("still matches what the owner already has", () => {
    expect(matchItem("food", "Spending", "Spending", reference).item).toBe("Food");
    expect(matchItem("framelink", "Revenue", "Revenue", reference).item).toBe("Framelink");
  });

  /**
   * A name the owner uses wins over the guard.
   *
   * The check runs last, after every match against their own lists, so a
   * category they genuinely named "Bills" is found at rule 1 and never
   * reaches it.
   */
  it("does not refuse a word the owner's own list contains", () => {
    const withBills: ReferenceLists = { ...reference, revenueCategories: ["Allowance", "Bills"] };
    expect(matchItem("bills", "Revenue", "Revenue", withBills)).toEqual({
      item: "Bills",
      matched: true,
    });
  });

  /** The remark match is still reached: the guard is not in front of it. */
  it("still reads the owner's own note beside a type", () => {
    expect(matchItem("fuel", "Spending", "Spending", reference).item).toBe("Gas");
  });
});
