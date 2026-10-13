import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { owedChange, type Debt } from "./debt";
import { readSettleAsk, settleLine } from "./settleLine";
import { incomeOf, costOf } from "./totals";
import type { Transaction } from "./types";

let n = 0;
const row = (o: Partial<Transaction>): Transaction => {
  n += 1;
  return { id: `s${n}`, recordNumber: n, date: "2026-10-05", type: "Debt", fromWallet: "", toWallet: "", category: "", item: "", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "", ...o } as Transaction;
};
const line = (o: Partial<Debt>): Debt =>
  ({ id: "father", name: "Father", kind: "receivable", counterparty: "Father", openedDate: "2026-10-01", wallet: "Maya", interestType: "none", interestRate: 0, form: "pass-through", notes: "", archived: false, ...o }) as Debt;
const ref = { revenueCategories: ["Random", "Allowance"] };
const owed = (rows: Transaction[], id: string) => rows.filter((t) => t.debtId === id).reduce((s, t) => s + owedChange(t), 0);
const apply = (rows: Transaction[], s: NonNullable<ReturnType<typeof settleLine>>): Transaction[] => [
  ...rows.map((t) => (s.update && t.id === s.update.id ? s.update : t)),
  { ...s.add, id: "new", recordNumber: 999 } as Transaction,
];

describe("clearing what is left on a line (owner, 13 October 2026)", () => {
  it("keeps the extra peso Father gave back as income, and no wallet moves", () => {
    const father = line({});
    const rows = [
      row({ debtId: "father", debtEffect: "lend", fromWallet: "Maya", amount: 59900, total: 59900, description: "Globe Postpaid for Father" }),
      row({ debtId: "father", debtEffect: "collect", toWallet: "Cash", amount: 60000, total: 60000, date: "2026-10-06" }),
    ];
    expect(owed(rows, "father")).toBe(-100);
    const s = settleLine(father, rows, ref, "2026-10-13")!;
    expect(s.action).toBe("Keep the ₱1.00 as yours");
    const after = apply(rows, s);
    expect(owed(after, "father")).toBe(0);
    expect(walletBalance(after, "Cash")).toBe(walletBalance(rows, "Cash"));
    expect(walletBalance(after, "Maya")).toBe(walletBalance(rows, "Maya"));
    expect(after.reduce((sum, t) => sum + incomeOf(t), 0)).toBe(100);
  });

  it("writes off what someone still owes, retains what is held, and forgives a loan", () => {
    const owes = [row({ debtId: "father", debtEffect: "lend", fromWallet: "Maya", amount: 50000, total: 50000 }), row({ debtId: "father", debtEffect: "collect", toWallet: "Maya", amount: 49000, total: 49000 })];
    const w = settleLine(line({}), owes, ref, "2026-10-13")!;
    expect(owed(apply(owes, w), "father")).toBe(0);
    expect(apply(owes, w).reduce((s, t) => s + costOf(t), 0)).toBe(1000);

    const tita = line({ id: "tita", name: "Tita's money", counterparty: "Tita", kind: "payable" });
    const held = [row({ debtId: "tita", debtEffect: "draw", toWallet: "Cash", amount: 2500000, total: 2500000 }), row({ debtId: "tita", debtEffect: "repay", fromWallet: "Cash", amount: 2490000, total: 2490000 })];
    const r = settleLine(tita, held, ref, "2026-10-13")!;
    expect(r.action).toBe("Keep the ₱100.00 as yours");
    expect(owed(apply(held, r), "tita")).toBe(0);
    expect(apply(held, r).reduce((s, t) => s + incomeOf(t), 0)).toBe(10000);

    const gaveMore = [row({ debtId: "tita", debtEffect: "draw", toWallet: "Cash", amount: 100000, total: 100000 }), row({ debtId: "tita", debtEffect: "repay", fromWallet: "Cash", amount: 100500, total: 100500 })];
    const g = settleLine(tita, gaveMore, ref, "2026-10-13")!;
    expect(owed(apply(gaveMore, g), "tita")).toBe(0);
    expect(walletBalance(apply(gaveMore, g), "Cash")).toBe(walletBalance(gaveMore, "Cash"));

    const bank = line({ id: "bank", name: "Bank loan", counterparty: "Bank", kind: "payable", form: "term-loan" });
    const loan = [row({ debtId: "bank", debtEffect: "draw", toWallet: "Cash", amount: 30000, total: 30000 })];
    expect(settleLine(bank, loan, ref, "2026-10-13")?.action).toBe("Mark the ₱300.00 forgiven");
    expect(settleLine(bank, [], ref, "2026-10-13")).toBeNull();
  });
});

describe("clearing a line from the chat", () => {
  const people = [
    { id: "d-dad", name: "Dad", counterparty: "Dad", kind: "receivable", form: "pass-through" },
    { id: "d-boss", name: "Boss", counterparty: "Boss", kind: "payable", form: "pass-through" },
  ] as unknown as Debt[];
  it("reads a name with a word that clears it", () => {
    expect(readSettleAsk("clear Dad", people)?.id).toBe("d-dad");
    expect(readSettleAsk("keep the 1 peso from dad, it's mine", people)?.id).toBe("d-dad");
    expect(readSettleAsk("Boss let me keep the rest, write it off", people)?.id).toBe("d-boss");
  });
  it("leaves questions and bare names alone", () => {
    expect(readSettleAsk("how much does Dad owe me?", people)).toBeNull();
    expect(readSettleAsk("Dad", people)).toBeNull();
    expect(readSettleAsk("clear my cash", people)).toBeNull();
  });
});
