/** Found by pressing every button, 2 November 2026: Restore said nothing before counting a payment twice. Figures invented. */
import { describe, expect, it } from "vitest";
import { restoreCheck } from "./restoreCheck";
import type { Transaction } from "./types";

const row = (n: number, o: Partial<Transaction>): Transaction =>
  ({ id: `r${n}`, recordNumber: n, date: "2026-09-27", type: "Spending", fromWallet: "Maya", toWallet: "", category: "Spending", item: "Food", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Paid", ...o }) as Transaction;

const ledger = [
  row(1, { type: "Revenue", fromWallet: "", toWallet: "Maya", amount: 50_000, total: 50_000 }),
  row(2, { date: "2026-09-28", type: "Debt", debtId: "mc", fromWallet: "Maya", amount: 30_000, total: 30_000, description: "Paid amount due" }),
];

describe("restoring a binned row", () => {
  it("says when the same money is already in the ledger, and when it takes an account below zero", () => {
    const binned = row(9, { type: "Debt", debtId: "mc", fromWallet: "Maya", amount: 30_000, total: 30_000 });
    expect(restoreCheck(binned, ledger)).toEqual([
      '#0002 on September 28, 2026 is the same ₱300.00 ("Paid amount due"): restoring may count it twice.',
      "It takes Maya from ₱200.00 to −₱100.00.",
    ]);
  });
  it("says nothing for a row that is neither", () => {
    expect(restoreCheck(row(9, { amount: 5_000, total: 5_000 }), ledger)).toEqual([]);
  });
});
