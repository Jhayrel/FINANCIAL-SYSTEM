/**
 * Three identical rows are one warning.
 *
 * The owner's card on 20 September 2026 matched #0560, #0564 and #0567, all
 * the same PHP 250.00 lunch, and printed the whole warning three times: three
 * headlines and the same five reasons written out three times over.
 */

import { describe, expect, it } from "vitest";

import { groupDuplicates, type Duplicate } from "./duplicates";
import type { Transaction } from "./types";

const row = (recordNumber: number): Transaction =>
  ({
    id: `t-${recordNumber}`,
    recordNumber,
    date: "2026-09-20",
    type: "Spending",
    category: "Spending",
    item: "Food",
    description: "lunch at the canteen",
    fromWallet: "Cash",
    toWallet: "",
    amount: 25000,
    fee: 0,
    total: 25000,
    notes: "",
    status: "Paid",
  }) as Transaction;

const SAME_REASONS = [
  "Both PHP 250.00.",
  "Both dated September 20, 2026.",
  'Word for word the same description: "lunch at the canteen".',
  "Both Food.",
  "Both out of Cash.",
];

const match = (recordNumber: number, evidence = SAME_REASONS): Duplicate => ({
  row: row(recordNumber),
  certainty: "same",
  evidence,
  score: 10,
});

describe("identical matches become one warning", () => {
  it("says it once and lists the records", () => {
    const groups = groupDuplicates([match(567), match(564), match(560)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.headline).toBe("Already in the ledger three times, as #0567, #0564 and #0560.");
    // The reasons are printed once, not once per row.
    expect(groups[0]?.evidence).toEqual(SAME_REASONS);
    expect(groups[0]?.rows).toHaveLength(3);
  });

  it("counts two in words as well", () => {
    const groups = groupDuplicates([match(567), match(564)]);
    expect(groups[0]?.headline).toBe("Already in the ledger twice, as #0567 and #0564.");
  });

  it("leaves a single match exactly as it was", () => {
    const groups = groupDuplicates([match(567)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.headline).toBe("This is already in the ledger as #0567.");
  });

  /*
   * Folding only applies where the rows really do say the same thing. Two
   * matches for different reasons are two different claims and both are
   * worth reading.
   */
  it("keeps matches apart when the reasons differ", () => {
    const groups = groupDuplicates([match(567), match(564, ["Both PHP 250.00.", "Both Food."])]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.headline)).toEqual([
      "This is already in the ledger as #0567.",
      "This is already in the ledger as #0564.",
    ]);
  });

  it("has nothing to say about no matches", () => {
    expect(groupDuplicates([])).toEqual([]);
  });
});
