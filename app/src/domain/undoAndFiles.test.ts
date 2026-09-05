/**
 * Two things the owner hit in one sitting.
 *
 * "restore my deleted entry yesterday" came back with "Nothing in the bin
 * matches that. There are 136 entries in it." The word "deleted" was being
 * searched for as if it described a row, and no row contains it: it describes
 * the instruction, like "delete" and "restore" beside it already did.
 *
 * And asking for a PDF was refused twice in a row, the second time at greater
 * length, because the app answered the file half and then handed the model a
 * question that still asked for a file.
 */

import { describe, expect, it } from "vitest";

import { detectRecall, findRows } from "./recall";
import { withoutTheFilePart, wantsStatement } from "./charts";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: 400 + n,
    date: "2026-09-05",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 25000,
    fee: 0,
    total: 25000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const bin = [row(), row({ date: "2026-09-01", item: "Gas", fromWallet: "Maya" })];
const ASOF = "2026-09-06";

describe("bringing something back", () => {
  it("does not search for the word 'deleted'", () => {
    const recall = detectRecall("restore my deleted entry yesterday");
    expect(recall?.action).toBe("restore");
    expect(recall?.phrase).toBe("yesterday");
  });

  it("finds the entry from yesterday", () => {
    const recall = detectRecall("restore my deleted entry yesterday");
    const found = findRows(recall!.phrase, bin, ASOF);
    expect(found).toHaveLength(1);
    expect(found[0]?.row.date).toBe("2026-09-05");
  });

  it("finds one named by what it was", () => {
    const recall = detectRecall("bring back the food I deleted");
    expect(findRows(recall!.phrase, bin, ASOF)).toHaveLength(1);
  });

  it("still knows a restore from a delete", () => {
    expect(detectRecall("undelete the last one")?.action).toBe("restore");
    expect(detectRecall("delete the last one")?.action).toBe("bin");
  });

  /**
   * "last" is stripped as an instruction word, so the phrase is empty and
   * the caller has to read recency off the original message. This pins the
   * shape that made `wantsLatest` dead code for as long as it existed.
   */
  it("leaves nothing to search for in 'the last one'", () => {
    expect(detectRecall("undelete the last one")?.phrase).toBe("");
  });
});

describe("asking for a file", () => {
  it("is recognised", () => {
    expect(wantsStatement("I want to generate 1-3 monts or revenue give me pdf")).toBe(true);
    expect(wantsStatement("export my august spending please")).toBe(true);
  });

  it("keeps the part that is about money", () => {
    expect(withoutTheFilePart("export my august spending please")).toBe("my august spending");
    expect(withoutTheFilePart("I want to generate 1-3 monts or revenue give me pdf")).toContain(
      "revenue",
    );
  });

  it("takes the file words out, so the model does not refuse a second time", () => {
    for (const q of ["give me a pdf of my month", "download my august spending"]) {
      expect(withoutTheFilePart(q).toLowerCase()).not.toMatch(/pdf|download/);
    }
  });

  /** Left with nothing, it asks something real rather than an empty string. */
  it("falls back to a real question when nothing is left", () => {
    expect(withoutTheFilePart("give me a pdf")).toBe("How is this month going?");
    expect(withoutTheFilePart("export")).toBe("How is this month going?");
  });

  it("leaves an ordinary question completely alone", () => {
    expect(wantsStatement("how much did I spend on food")).toBe(false);
  });
});
