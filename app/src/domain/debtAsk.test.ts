import { describe, expect, it } from "vitest";

import type { Debt } from "./debt";
import { debtAnswer, readDebtAsk } from "./debtAsk";
import type { Transaction } from "./types";

/* 19 October 2026 audit: debt questions got the month's summary. Names and figures invented. */
let n = 0;
const row = (o: Partial<Transaction>): Transaction =>
  ({ id: `q${(n += 1)}`, recordNumber: n, date: "2026-01-05", type: "Debt", category: "", item: "", fromWallet: "", toWallet: "", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "", ...o }) as Transaction;
const card = { id: "card", name: "Card Credit", counterparty: "Bank", kind: "payable", form: "credit-line", archived: false, openedDate: "2026-01-01", interestRate: 0 } as unknown as Debt;
const friend = { id: "pal", name: "Pal", counterparty: "Pal", kind: "receivable", form: "informal", archived: false, openedDate: "2026-01-01", interestRate: 0 } as unknown as Debt;
const rows = [
  row({ debtId: "card", debtEffect: "draw", toWallet: "Cash", amount: 300000, total: 300000 }),
  row({ debtId: "pal", debtEffect: "lend", fromWallet: "Cash", amount: 50000, total: 50000 }),
];

describe("debt questions", () => {
  it("are read as questions, never entries", () => {
    expect(readDebtAsk("How much do I owe?", [card, friend])).toEqual({ debt: null });
    expect(readDebtAsk("When is my Card Credit due?", [card, friend])?.debt?.id).toBe("card");
    expect(readDebtAsk("How much does Pal owe me?", [card, friend])?.debt?.id).toBe("pal");
    expect(readDebtAsk("I owe Pal 500, he lent it to me", [card, friend])).toBeNull();
  });
  it("answer with each line's balance", () => {
    const all = debtAnswer({ debt: null }, [card, friend], rows, "2026-01-20");
    expect(all).toContain("You owe **PHP 3,000.00** in all; owed to you: PHP 500.00");
    expect(debtAnswer({ debt: friend }, [card, friend], rows, "2026-01-20")).toBe("Pal owes you PHP 500.00.");
  });
});
