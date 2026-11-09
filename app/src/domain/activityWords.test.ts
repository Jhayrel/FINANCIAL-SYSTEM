/**
 * What the trail calls each kind of entry (heavy test on the owner's data,
 * 9 November 2026): a borrowing and its repayment both read "Debt", and a
 * ₱200.00 move read as a ₱210.00 "Transaction Fee". Invented rows.
 */
import { describe, expect, it } from "vitest";

import { binned, created, restored } from "./activity";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction>): Transaction =>
  ({ id: "t1", recordNumber: 4005, date: "2026-11-09", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", amount: 12_345, fee: 0, total: 12_345, notes: "", status: "Paid", ...over }) as Transaction;
const debts = [
  { id: "maya-credit", name: "Maya Credit", kind: "payable" as const },
  { id: "ana", name: "Ana", kind: "receivable" as const, form: "pass-through" as const },
];

describe("the trail names what happened", () => {
  it("a borrowing and its repayment, by their line", () => {
    const draw = row({ type: "Debt", category: "" as never, item: "", debtId: "maya-credit", debtEffect: "draw", fromWallet: "", toWallet: "Maya", amount: 100_000, total: 100_000 });
    const repay = row({ ...draw, recordNumber: 4006, debtEffect: "repay", fromWallet: "Maya", toWallet: "" });
    expect(created(draw, undefined, debts).summary).toBe("Added #4005, Maya Credit, borrowed, PHP 1,000.00.");
    expect(created(repay, undefined, debts).summary).toBe("Added #4006, Maya Credit, paid, PHP 1,000.00.");
  });

  it("on someone's behalf, in its own words", () => {
    const lend = row({ type: "Debt", item: "", debtId: "ana", debtEffect: "lend", amount: 50_000, total: 50_000 });
    expect(created(lend, undefined, debts).summary).toBe("Added #4005, Ana, paid for them, PHP 500.00.");
  });

  it("without the lines, the row's own words, never just Debt when it has some", () => {
    const draw = row({ type: "Debt", item: "Maya Credit", debtId: "maya-credit", debtEffect: "draw", amount: 100_000, total: 100_000 });
    expect(created(draw).summary).toBe("Added #4005, Maya Credit, borrowed, PHP 1,000.00.");
  });

  it("a transfer is where the money went, the fee apart", () => {
    const move = row({ type: "Transfer", item: "Transaction Fee", fromWallet: "Gcash", toWallet: "Maya", amount: 20_000, fee: 1_000, total: 21_000 });
    expect(created(move).summary).toBe("Added #4005, Gcash to Maya, PHP 200.00 and a PHP 10.00 fee.");
    const sent = row({ type: "Transfer", item: "", fromWallet: "Gcash", toWallet: "", amount: 20_000, fee: 0, total: 20_000 });
    expect(created(sent).summary).toBe("Added #4005, Gcash to someone else, PHP 200.00.");
    expect(binned(move).summary).toBe("Moved #4005, Gcash to Maya, to the bin.");
    expect(restored(move).summary).toBe("Restored #4005, Gcash to Maya.");
  });

  it("spending and income read as before", () => {
    expect(created(row({})).summary).toBe("Added #4005, Food, PHP 123.45.");
  });
});
