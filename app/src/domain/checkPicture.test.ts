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
