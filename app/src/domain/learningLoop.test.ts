/**
 * Does it actually learn from its own database?
 *
 * ── The answer, before this ───────────────────────────────────────────────
 *
 * It read the record and applied nothing useful. After 310 events the
 * database held exactly two corrections, `fromWallet: Cash to Maya` and
 * `amount: 5,000 to 3.00`, and not one for `item`. So
 * `correctionsFrom(events, "item")` returned an empty map every single time
 * and there was nothing to apply.
 *
 * Two reasons, and both are fixed:
 *
 *   1. Corrections were only written by the chat's own amend path, so
 *      correcting a card by typing "gcash" was remembered and correcting the
 *      same field in the form beside it was not. Almost every correction
 *      happens in the form.
 *
 *   2. `learnedItems` was consulted when you answered "what was it for?" and
 *      nowhere else, so even a correction that was recorded did nothing when
 *      the model or the reader guessed the item directly.
 *
 * This file pins the loop end to end: a manual correction becomes a recorded
 * pair, and that pair comes back out as something to apply.
 */

import { describe, expect, it } from "vitest";

import { correctionsFrom, manualCorrections } from "./aiLog";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction> = {}): Transaction => ({
  id: "t1",
  recordNumber: 442,
  date: "2026-09-05",
  type: "Spending",
  fromWallet: "Cash",
  toWallet: "",
  category: "Spending",
  item: "Gas",
  description: "",
  amount: 30000,
  fee: 0,
  total: 30000,
  notes: "",
  status: "Paid",
  entrySource: "ai",
  ...over,
});

describe("a correction made in the form is recorded", () => {
  it("records the field, what it proposed, and what it became", () => {
    const events = manualCorrections(row(), row({ item: "Food" }), "add");
    expect(events).toHaveLength(1);
    expect(events[0]?.field).toBe("item");
    expect(events[0]?.proposed).toBe("Gas");
    expect(events[0]?.corrected).toBe("Food");
  });

  it("records every field that changed, not just the first", () => {
    const events = manualCorrections(
      row(),
      row({ item: "Food", fromWallet: "Maya", category: "Bills" }),
      "add",
    );
    expect(events.map((e) => e.field).sort()).toEqual(["category", "fromWallet", "item"]);
  });

  /**
   * Only rows the assistant entered. Fixing your own typo teaches nothing
   * about its guessing and would fill the record with noise.
   */
  it("ignores an edit to a row you typed yourself", () => {
    const mine = row({ entrySource: "manual" });
    expect(manualCorrections(mine, row({ item: "Food" }), "add")).toEqual([]);
  });

  it("ignores a row with no recorded source, from before it existed", () => {
    const old = row({ entrySource: undefined });
    expect(manualCorrections(old, row({ item: "Food" }), "add")).toEqual([]);
  });

  it("says nothing when nothing changed", () => {
    expect(manualCorrections(row(), row(), "add")).toEqual([]);
  });

  /** A field emptied is not a correction: there is nothing to learn from it. */
  it("ignores a field cleared rather than changed", () => {
    expect(manualCorrections(row(), row({ item: "" }), "add")).toEqual([]);
  });
});

describe("the loop closes: recorded, then read back", () => {
  it("turns a form correction into something to apply next time", () => {
    const events = manualCorrections(row(), row({ item: "Food" }), "add");
    const learned = correctionsFrom(events, "item");
    expect(learned.get("gas")).toBe("Food");
  });

  it("keeps the newest correction when the same guess is fixed twice", () => {
    const first = manualCorrections(row(), row({ item: "Food" }), "add");
    const second = manualCorrections(row(), row({ item: "Treat" }), "add");
    const learned = correctionsFrom(
      [...first, ...second.map((e) => ({ ...e, at: "2026-09-06T00:00:00.000Z" }))],
      "item",
    );
    expect(learned.get("gas")).toBe("Treat");
  });

  /**
   * The guard that stopped "gas is Food" from being learned in the first
   * place, and it still has to hold: a mapping is worth keeping only when
   * its key is not already a value the ledger uses.
   */
  it("still refuses a mapping from a value onto itself", () => {
    const events = manualCorrections(row(), row({ item: "gas" }), "add");
    expect(correctionsFrom(events, "item").size).toBe(0);
  });

  it("keeps corrections to other fields out of the item lookup", () => {
    const events = manualCorrections(row(), row({ fromWallet: "Maya" }), "add");
    expect(correctionsFrom(events, "item").size).toBe(0);
    expect(correctionsFrom(events, "fromWallet").get("cash")).toBe("Maya");
  });
});
