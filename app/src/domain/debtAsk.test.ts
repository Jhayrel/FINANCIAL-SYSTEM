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
    expect(readDebtAsk("How much do I owe?", [card, friend])?.debt).toBeNull();
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

// 27 October 2026 sweep: "what's my balance on maya credit" got the month's summary.
describe("a debt's balance asked by name", () => {
  it("is a debt question with the debt named, and nothing without one", () => {
    expect(readDebtAsk("what's my balance on Card Credit?", [card, friend])?.debt?.id).toBe("card");
    expect(readDebtAsk("what's my balance on gcash?", [card, friend])).toBeNull();
  });
});

// Owner's chat, 1 November 2026: "I have loan in maya credit" got the month's summary.
describe("a loan said, with no figure", () => {
  it("shows the line named, and is nothing without one or with a figure", () => {
    expect(readDebtAsk("I have loan in Card Credit", [card, friend])?.debt?.id).toBe("card");
    expect(readDebtAsk("may utang ako sa Card Credit", [card, friend])?.debt?.id).toBe("card");
    expect(readDebtAsk("I have a loan in BPI", [card, friend])).toBeNull();
    expect(readDebtAsk("I have loan in Card Credit 500", [card, friend])).toBeNull();
  });

  it("'pay off my maya credit' asks what is owed on it; with a later day it is a plan, not this (3 November 2026)", () => {
    const debts = [{ id: "mc", name: "Maya Credit", counterparty: "Maya", archived: false }] as unknown as Parameters<typeof readDebtAsk>[1];
    expect(readDebtAsk("pay off my maya credit", debts)?.debt?.name).toBe("Maya Credit");
    expect(readDebtAsk("pay off my maya credit next month", debts)).toBeNull();
    expect(readDebtAsk("pay off my car", debts)).toBeNull();
  });
});

