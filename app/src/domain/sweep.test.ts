/**
 * "Delete all data entered by ai."
 *
 * Asked three times in three minutes, on 2026-08-31, and it did nothing each
 * time. The reason is in `findRows`: it strips instruction words, then keeps
 * only what is longer than two letters, so the phrase came down to "entered
 * financial dataabse" and the one word that carried the meaning, "ai", was
 * dropped for being two characters long.
 *
 * A sweep is not a row description. Every rule in `findRows` answers "which
 * one did you mean"; this asks for all of them, and the ledger already knows
 * which, because `entrySource` is written on every row at the moment it is
 * saved.
 */

import { describe, expect, it } from "vitest";

import { detectRecall, detectSweep, findRows, sweepRows } from "./recall";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: "2026-08-29",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const ledger: Transaction[] = [
  row({ entrySource: "ai", item: "Framelink", type: "Revenue", category: "Revenue" }),
  row({ entrySource: "ai", item: "Food" }),
  row({ entrySource: "manual", item: "Gas" }),
  // Written before the assistant existed, so it has no opinion on the matter.
  row({ item: "School", category: "Bills" }),
];

/** The sentence as it was typed, misspelling included. */
const SAID = "delete all data entered by ai in financial dataabse";

describe("the sentence that did nothing, three times", () => {
  it("is still recognised as a delete", () => {
    expect(detectRecall(SAID)?.action).toBe("bin");
  });

  /** The old path. Kept as a test so the reason stays on the record. */
  it("finds nothing by description, which is why it did nothing", () => {
    const phrase = detectRecall(SAID)?.phrase ?? "";
    expect(findRows(phrase, ledger, "2026-08-29")).toEqual([]);
  });

  it("is recognised as a sweep instead", () => {
    const phrase = detectRecall(SAID)?.phrase ?? "";
    expect(detectSweep(phrase)?.what).toBe("ai");
  });

  it("returns every row the assistant entered, and only those", () => {
    const sweep = detectSweep(SAID);
    expect(sweep).not.toBeNull();
    const found = sweep ? sweepRows(sweep, ledger) : [];
    expect(found.map((r) => r.item)).toEqual(["Framelink", "Food"]);
  });

  /** Absent is not "ai". A row from before the assistant is not its doing. */
  it("leaves rows with no recorded source alone", () => {
    const sweep = detectSweep(SAID);
    const found = sweep ? sweepRows(sweep, ledger) : [];
    expect(found.some((r) => r.item === "School")).toBe(false);
    expect(found.some((r) => r.item === "Gas")).toBe(false);
  });
});

describe("the ways of saying it", () => {
  it("recognises the phrasings that mean the same thing", () => {
    for (const said of [
      "delete all data entered by ai",
      "remove everything the ai added",
      "get rid of all the entries the assistant made",
      "delete every row the chatbot created",
      "erase all ai entries",
    ]) {
      expect(detectSweep(said), said).not.toBeNull();
    }
  });

  /**
   * Both halves are required, and this is the reason.
   *
   * "delete the ai suggestion" is about the card on screen. Sweeping the
   * ledger because a sentence mentioned the assistant would be the worst
   * possible reading of the most ordinary request on this screen.
   */
  it("does not fire without a quantifier", () => {
    for (const said of [
      "delete the ai suggestion",
      "remove that ai entry",
      "discard the assistant's card",
    ]) {
      expect(detectSweep(said), said).toBeNull();
    }
  });

  it("does not fire without naming the assistant", () => {
    for (const said of [
      "delete all my food entries",
      "remove everything from August",
      "delete all",
    ]) {
      expect(detectSweep(said), said).toBeNull();
    }
  });

  /** Nothing to sweep is a real answer, and an empty list is how it says so. */
  it("returns nothing when the assistant has entered nothing", () => {
    const sweep = detectSweep(SAID);
    const manual = ledger.filter((r) => r.entrySource !== "ai");
    expect(sweep ? sweepRows(sweep, manual) : []).toEqual([]);
  });
});
