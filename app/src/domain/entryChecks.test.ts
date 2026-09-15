/**
 * Entries that would quietly break the ledger, and what the form says first.
 *
 * Each case is one that saved without a word before 2026-09-15: money lent
 * "drawn", a line archived yet still taking rows, a repayment of nothing, the
 * Maya Credit bill as spending, extra zeros, a year typed wrong, and a fee in
 * the amount box.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import type { Debt } from "./debt";
import { checkDraft, emptyDraft, type Draft } from "./entry";
import { unusualAgainst, unusualRows } from "./unusual";
import type { Transaction } from "./types";

const fx = loadFixture();
const AS_OF = fx.expected.asOf;
const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft(AS_OF), ...over });

const owed: Debt = {
  id: "maya-credit-line",
  name: "Maya Credit Line",
  kind: "payable",
  counterparty: "Maya",
  openedDate: "2026-07-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};
const lent: Debt = { ...owed, id: "ben", name: "Ben", kind: "receivable", form: "informal", wallet: "Cash" };

const lendRow: Transaction = {
  id: "lend-1",
  recordNumber: 9001,
  date: "2026-08-01",
  type: "Debt",
  fromWallet: "Cash",
  toWallet: "",
  category: "",
  item: "Ben",
  description: "",
  amount: 50000,
  fee: 0,
  total: 50000,
  notes: "",
  status: "",
  debtId: "ben",
  debtEffect: "lend",
};

const check = (d: Draft, debts: readonly Debt[] = [owed, lent], rows: readonly Transaction[] = fx.transactions) =>
  checkDraft(d, rows, fx.reference, debts, AS_OF);

describe("debts", () => {
  it("refuses a draw against money owed to you, and takes lending", () => {
    const drawn = check(draft({ flow: "Debt", debtId: "ben", debtEffect: "draw", toWallet: "Cash", amount: 50000 }));
    expect(drawn.errors.some((e) => e.field === "debtEffect" && e.message.includes("owed to you"))).toBe(true);

    const lending = check(draft({ flow: "Debt", debtId: "ben", debtEffect: "lend", fromWallet: "Cash", amount: 50000 }));
    expect(lending.errors.some((e) => e.field === "debtEffect")).toBe(false);
  });

  it("refuses a new row against an archived debt, and still lets a saved one be corrected", () => {
    const archived = [{ ...owed, archived: true }];
    const fresh = check(draft({ flow: "Debt", debtId: owed.id, debtEffect: "draw", toWallet: "Maya", amount: 10000 }), archived);
    expect(fresh.errors.some((e) => e.field === "debt")).toBe(true);

    const edit = check(draft({ id: "t-1", flow: "Debt", debtId: owed.id, debtEffect: "draw", toWallet: "Maya", amount: 10000 }), archived);
    expect(edit.errors.some((e) => e.field === "debt")).toBe(false);
  });

  it("says so when a repayment has nothing to repay", () => {
    const paid = check(draft({ flow: "Debt", debtId: owed.id, debtEffect: "repay", fromWallet: "Maya", amount: 100000 }));
    expect(paid.warnings.some((w) => w.message.includes("Nothing is owed on Maya Credit Line"))).toBe(true);
  });

  it("warns when collecting more than is owed to you", () => {
    const back = check(
      draft({ flow: "Debt", debtId: "ben", debtEffect: "collect", toWallet: "Cash", amount: 80000 }),
      [owed, lent],
      [...fx.transactions, lendRow],
    );
    expect(back.warnings.some((w) => w.message.includes("below zero"))).toBe(true);
  });

  it("offers to book a bill named after a debt as a repayment", () => {
    const bill = check(
      draft({ flow: "Spending", fromWallet: "Maya", category: "Bills", item: "Maya Credit Line", amount: 402136 }),
    );
    expect(bill.debtPayment).toEqual({ debtId: owed.id, name: owed.name });
    expect(bill.warnings.some((w) => w.field === "item")).toBe(true);
  });
});

describe("figures that are probably typos", () => {
  it("asks about extra zeros on income, and not about an ordinary amount", () => {
    const million = check(
      draft({ flow: "Revenue", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 100_000_000 }),
    );
    expect(million.unusual?.times).toBeGreaterThanOrEqual(5);
    expect(million.warnings.some((w) => w.message.includes("Check the zeros"))).toBe(true);

    const usual = check(draft({ flow: "Revenue", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 50000 }));
    expect(usual.unusual).toBeUndefined();
  });

  it("warns about a new entry dated well ahead, and says nothing when correcting an old one", () => {
    const ahead = check(draft({ date: "2026-09-10", flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 10000 }));
    expect(ahead.warnings.some((w) => w.field === "date")).toBe(true);

    const lastYear = check(draft({ date: "2025-08-01", flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 10000 }));
    expect(lastYear.warnings.some((w) => w.field === "date")).toBe(true);

    const edit = check(draft({ id: "t-2", date: "2025-08-01", flow: "Spending", fromWallet: "Cash", category: "Spending", item: "Food", amount: 10000 }));
    expect(edit.warnings.some((w) => w.field === "date")).toBe(false);
  });

  it("warns when the fee is larger than the amount it was charged on", () => {
    const swapped = check(draft({ flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 1000, fee: 1500 }));
    expect(swapped.warnings.some((w) => w.field === "fee")).toBe(true);
  });
});

describe("measuring what is unusual", () => {
  const income = (id: string, date: string, total: number): Transaction => ({
    ...lendRow,
    id,
    date,
    type: "Revenue",
    category: "Revenue",
    toWallet: "Cash",
    fromWallet: "",
    debtId: undefined,
    debtEffect: undefined,
    amount: total,
    total,
  });

  it("needs enough rows to judge by, and a figure worth asking about", () => {
    const five = ["a", "b", "c", "d", "e"].map((id, i) => income(id, `2026-07-0${i + 1}`, 1_000_000));
    expect(unusualAgainst(100_000_000, five.slice(0, 4))).toBeNull();
    expect(unusualAgainst(100_000_000, five)).toEqual({ largest: 1_000_000, times: 100 });
    expect(unusualAgainst(900_000, five)).toBeNull();
  });

  it("flags a large row once, against what came before it", () => {
    const rows = [
      ...["a", "b", "c", "d", "e"].map((id, i) => income(id, `2026-07-0${i + 1}`, 1_000_000)),
      income("big", "2026-08-10", 100_000_000),
      income("again", "2026-08-12", 100_000_000),
    ];
    expect(unusualRows(rows, "2026-08-29").map((u) => u.row.id)).toEqual(["big"]);
    expect(unusualRows(rows, "2026-12-01")).toHaveLength(0);
  });
});
