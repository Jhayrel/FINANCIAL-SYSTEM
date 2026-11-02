import { describe, expect, it } from "vitest";

import { asksWhetherAdded, inLedgerOrNot } from "./checkPicture";
import { emptyDraft, type Draft } from "./entry";
import type { Transaction } from "./types";

/** 28 September 2026: "Can you check only if this is added?", with a Maya screenshot. Figures invented. */

const row = (n: number, date: string, amount: number, item: string): Transaction => ({
  id: `t${n}`,
  recordNumber: n,
  date,
  type: "Spending",
  fromWallet: "Maya",
  toWallet: "",
  category: "Spending",
  item,
  description: item,
  amount,
  fee: 0,
  total: amount,
  notes: "",
  status: "Paid",
});

const ledger = [row(3801, "2026-09-27", 151800, "Food"), row(3790, "2026-09-26", 18500, "Home Needs")];
const draft = (date: string, amount: number, item: string): Draft => ({
  ...emptyDraft(date),
  flow: "Spending",
  category: "Spending",
  fromWallet: "Maya",
  item,
  description: item,
  amount,
});

describe("asking whether a picture's rows are in", () => {
  it("hears the question", () => {
    for (const said of [
      "Can you check only if this is added?",
      "check if these are already in the ledger",
      "is this already recorded",
      "re check for duplicate",
      "which are missing",
    ]) {
      expect(asksWhetherAdded(said), said).toBe(true);
    }
  });

  it("does not take an entry for the question", () => {
    for (const said of ["add these", "I received this in maya", "Check my current spending maya", "all maya"]) {
      expect(asksWhetherAdded(said), said).toBe(false);
    }
  });
});

describe("the answer, from the ledger", () => {
  it("names the rows already in by record, and offers only the rest", () => {
    const drafts = [draft("2026-09-27", 151800, "Food"), draft("2026-09-26", 18500, "Home Needs"), draft("2026-09-24", 51600, "School")];
    const verdict = inLedgerOrNot(drafts, ledger);
    expect(verdict.already.map((a) => a.record)).toEqual([3801, 3790]);
    expect(verdict.missing).toEqual([2]);
    expect(verdict.words).toContain("#3801");
    expect(verdict.words).toContain("2 of 3");
  });

  it("drops a row with no amount", () => {
    expect(inLedgerOrNot([draft("2026-09-27", 0, "")], ledger).missing).toEqual([]);
  });

  it("does not let one ledger row answer for two picture rows", () => {
    const twice = [draft("2026-09-27", 151800, "Food"), draft("2026-09-27", 151800, "Food")];
    expect(inLedgerOrNot(twice, ledger).missing).toEqual([1]);
  });
});

describe("find a difference: what is wrong, not only what is missing (owner, 1 November 2026)", () => {
  it("finds the entry on another day, in another account, or for a slightly different amount, and offers no card for it", () => {
    const ledger2 = [
      row(3901, "2026-10-12", 25000, "Food"),
      { ...row(3902, "2026-10-14", 9900, "Load"), fromWallet: "Gcash" },
      row(3903, "2026-10-15", 30500, "Gas"),
    ];
    const drafts = [draft("2026-10-13", 25000, "Food"), draft("2026-10-14", 9900, "Load"), draft("2026-10-15", 30000, "Gas"), draft("2026-10-16", 12000, "School")];
    const verdict = inLedgerOrNot(drafts, ledger2);
    // Found, the same money a day off or in another account; or not found as it is, but nearly.
    expect(verdict.already.map((a) => a.record)).toEqual([3901, 3902]);
    expect(verdict.near.map((n) => n.record)).toEqual([3903]);
    expect(verdict.missing).toEqual([3]);
    expect(verdict.words).toContain("#3901, but the ledger has it on Oct 12, the picture on Oct 13");
    expect(verdict.words).toContain("#3902, but the ledger has it in Gcash, the picture in Maya");
    expect(verdict.words).toContain("likely #3903, but the ledger has ₱305.00, the picture ₱300.00 (₱5.00 more in the ledger)");
    expect(verdict.words).toContain("nothing was changed");
  });

  it("names entries of that account inside the list's days that the list does not show", () => {
    const ledger3 = [row(3911, "2026-10-10", 10000, "Food"), row(3912, "2026-10-11", 20000, "Food"), row(3913, "2026-10-12", 7700, "Snacks"), row(3914, "2026-10-13", 30000, "Food"), { ...row(3915, "2026-10-11", 5000, "Food"), fromWallet: "Cash" }];
    const drafts = [draft("2026-10-10", 10000, "Food"), draft("2026-10-11", 20000, "Food"), draft("2026-10-13", 30000, "Food")];
    const verdict = inLedgerOrNot(drafts, ledger3);
    expect(verdict.already).toHaveLength(3);
    // #3913 is Maya's, inside the days shown, and not in the list; #3915 is Cash's, so not this list's.
    expect(verdict.notShown).toEqual([3913]);
    expect(verdict.words).toContain("#3913: ₱77.00 Snacks, Oct 12");
  });
});
