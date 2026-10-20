/**
 * "If I edit it in the Database and save, does it count as an expense? Minus
 * balance? Break my budget?" (20 October 2026). Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { editImpact } from "./editImpact";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction>): Transaction => ({
  id: "w", recordNumber: 7, date: "2026-09-05", type: "Transfer", fromWallet: "Bank", toWallet: "Cash", category: "", item: "",
  description: "", amount: 51_600, fee: 0, total: 51_600, notes: "", status: "Withdrawn", ...over,
});
const accounts = ["Cash", "Bank"];

describe("what saving an edit does to the money", () => {
  it("a fee split out of a withdrawal: Cash down, that month's spending up by the fee", () => {
    const before = row({});
    const after = row({ amount: 50_000, fee: 1_600, total: 51_600, category: "Spending", item: "Transaction Fee" });
    const impact = editImpact([{ before, after }], accounts);
    expect(impact.wallets).toEqual([{ name: "Cash", change: -1_600 }]);
    expect(impact.spending).toEqual([{ month: "2026-09", change: 1_600 }]);
    expect(impact.words).toBe("Cash goes down ₱16.00. September 2026 spending goes up ₱16.00, so its budget shows that much more spent.");
  });

  it("a date moved inside the month changes nothing", () => {
    expect(editImpact([{ before: row({}), after: row({ date: "2026-09-06" }) }], accounts).words).toContain("No balance and no spending changes");
  });

  it("a date moved to another month moves the cost between them", () => {
    const fee = { amount: 50_000, fee: 1_600, total: 51_600, category: "Spending" as const, item: "Transaction Fee" };
    const impact = editImpact([{ before: row(fee), after: row({ ...fee, date: "2026-10-01" }) }], accounts);
    expect(impact.wallets).toEqual([]);
    expect(impact.spending).toEqual([{ month: "2026-09", change: -1_600 }, { month: "2026-10", change: 1_600 }]);
  });
});
