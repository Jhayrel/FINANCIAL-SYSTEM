import { describe, expect, it } from "vitest";

import type { Debt } from "./debt";
import { buildSheet, periodLabel } from "./statementSheet";
import type { ReferenceLists, Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction> & Pick<Transaction, "date" | "type" | "amount">): Transaction => {
  n += 1;
  const fee = over.fee ?? 0;
  return {
    id: `t${n}`,
    recordNumber: n,
    fromWallet: "",
    toWallet: "",
    category: over.type === "Revenue" ? "Revenue" : over.type === "Spending" ? "Spending" : "",
    item: "",
    description: "",
    fee,
    total: over.amount + fee,
    notes: "",
    status: "",
    ...over,
  };
};

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Savings"],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [],
};

// A year that opens the way the owner's does: opening rows on 1 January,
// then spending, income, a withdrawal with a fee, and money sent out.
const opening = [
  row({ date: "2026-01-01", type: "Revenue", category: "Opening", toWallet: "Maya", amount: 245, description: "Transfer of balance 2025" }),
  row({ date: "2026-01-01", type: "Revenue", category: "Opening", toWallet: "Cash", amount: 45000, description: "Transfer of balance 2025" }),
];
const january = [
  row({ date: "2026-01-04", type: "Spending", fromWallet: "Cash", amount: 10000, description: "Lunch" }),
  row({ date: "2026-01-04", type: "Revenue", toWallet: "Gcash", amount: 500000, description: "Pay" }),
  row({ date: "2026-01-04", type: "Transfer", fromWallet: "Gcash", toWallet: "Cash", amount: 200000, fee: 1500, description: "Withdrawal" }),
  row({ date: "2026-01-05", type: "Transfer", fromWallet: "Cash", toWallet: "", amount: 50000, description: "Sent to a friend" }),
];
const march = [row({ date: "2026-03-02", type: "Spending", fromWallet: "Maya", amount: 245, description: "Load" })];
const ledger = [...opening, ...january, ...march];

describe("the account statement", () => {
  const sheet = buildSheet(ledger, { type: "account", year: 2026, fromMonth: 1, toMonth: 12 }, reference);

  it("brings the opening balance forward instead of listing it as money in", () => {
    expect(sheet.broughtForward).toBe(45245);
    expect(sheet.lines.some((l) => l.description.startsWith("Transfer of balance"))).toBe(false);
  });

  it("gives each row the balance the Excel printed beside it", () => {
    expect(sheet.lines.map((l) => l.balance)).toEqual([35245, 535245, 533745, 483745, 483500]);
  });

  it("counts only the fee on a move between two wallets, and all of it when the money left", () => {
    const withdrawal = sheet.lines.find((l) => l.description === "Withdrawal")!;
    expect(withdrawal).toMatchObject({ moneyIn: 0, moneyOut: 1500 });
    const sent = sheet.lines.find((l) => l.description === "Sent to a friend")!;
    expect(sent).toMatchObject({ moneyIn: 0, moneyOut: 50000 });
  });

  it("adds up: brought forward, plus in, less out, is the closing balance", () => {
    expect(sheet.broughtForward! + sheet.totalIn - sheet.totalOut).toBe(sheet.closing);
    expect(sheet.headings).toEqual({ moneyIn: "Money in", moneyOut: "Money out", balance: "Balance" });
  });

  it("starts a later period from everything before it", () => {
    const m = buildSheet(ledger, { type: "account", year: 2026, fromMonth: 3, toMonth: 3 }, reference);
    expect(m.broughtForward).toBe(483745);
    expect(m.lines).toHaveLength(1);
    expect(m.closing).toBe(483500);
    expect(m.period).toBe("March 2026");
  });

  it("folds a year-end handover into the balance brought forward, so imported years add nothing to it", () => {
    const handover = [
      row({ date: "2025-06-01", type: "Revenue", toWallet: "Cash", amount: 30000 }),
      row({ date: "2026-01-01", type: "Spending", category: "Opening", fromWallet: "Cash", amount: 30000, description: "Balance at the end of 2025" }),
    ];
    const s = buildSheet([...handover, ...ledger], { type: "account", year: 2026, fromMonth: 1, toMonth: 12 }, reference);
    expect(s.broughtForward).toBe(45245);
    expect(s.lines).toHaveLength(5);
  });
});

describe("one wallet", () => {
  it("lists only rows touching it, with its own balance", () => {
    const s = buildSheet(ledger, { type: "wallet", year: 2026, fromMonth: 1, toMonth: 12, wallet: "Cash" }, reference);
    expect(s.subject).toBe("Cash");
    expect(s.broughtForward).toBe(45000);
    expect(s.lines.map((l) => [l.description, l.moneyIn, l.moneyOut, l.balance])).toEqual([
      ["Lunch", 0, 10000, 35000],
      ["Withdrawal", 200000, 0, 235000],
      ["Sent to a friend", 0, 50000, 185000],
    ]);
  });
});

describe("the income and expense sheets use the one definition of each", () => {
  it("leaves opening balances off the revenue sheet", () => {
    const s = buildSheet(ledger, { type: "revenue", year: 2026, fromMonth: 1, toMonth: 12 }, reference);
    expect(s.lines.map((l) => l.moneyIn)).toEqual([500000]);
    expect(s.broughtForward).toBeNull();
  });

  it("puts a transfer fee, not the transfer, on the expense sheet, and leaves unclassified rows off", () => {
    const unsure = row({ date: "2026-01-06", type: "Spending", category: "", item: "Not classified", fromWallet: "Gcash", amount: 7000 });
    const s = buildSheet([...ledger, unsure], { type: "expense", year: 2026, fromMonth: 1, toMonth: 12 }, reference);
    expect(s.lines.map((l) => l.moneyOut)).toEqual([10000, 1500, 50000, 245]);
    expect(s.closing).toBe(61745);
  });

  it("lists bills and subscriptions on their own", () => {
    const bill = row({ date: "2026-02-01", type: "Spending", category: "Bills", fromWallet: "Maya", amount: 99900, description: "Internet" });
    const s = buildSheet([...ledger, bill], { type: "bills", year: 2026, fromMonth: 1, toMonth: 12 }, reference);
    expect(s.lines.map((l) => [l.kind, l.moneyOut])).toEqual([["Bill", 99900]]);
  });

  it("shows what each transfer moved and what it cost", () => {
    const s = buildSheet(ledger, { type: "transfers", year: 2026, fromMonth: 1, toMonth: 12 }, reference);
    expect(s.lines.map((l) => [l.moneyIn, l.moneyOut])).toEqual([[200000, 1500], [50000, 50000]]);
    expect(s.headings).toEqual({ moneyIn: "Moved", moneyOut: "Cost", balance: "Cost so far" });
  });
});

describe("debt statements", () => {
  const card: Debt = {
    id: "card", name: "Maya Credit", kind: "payable", counterparty: "Maya", openedDate: "2026-01-01",
    wallet: "Maya", interestType: "none", interestRate: 0, form: "credit-line", notes: "", archived: false,
  };
  const loan: Debt = { ...card, id: "loan", name: "Bank loan", form: "term-loan" };
  const friend: Debt = { ...card, id: "friend", name: "Loan to a friend", kind: "receivable", form: "informal" };
  const debts = [card, loan, friend];
  const rows = [
    row({ date: "2025-12-01", type: "Debt", debtId: "card", debtEffect: "draw", toWallet: "Maya", amount: 100000 }),
    row({ date: "2026-02-01", type: "Debt", debtId: "card", debtEffect: "repay", fromWallet: "Maya", amount: 40000, description: "Paid the card" }),
    row({ date: "2026-02-01", type: "Debt", debtId: "card", debtEffect: "interest", fromWallet: "Maya", amount: 1879, description: "Interest" }),
    row({ date: "2026-03-01", type: "Debt", debtId: "loan", debtEffect: "draw", toWallet: "Cash", amount: 500000, description: "Loan released" }),
    row({ date: "2026-04-01", type: "Debt", debtId: "friend", debtEffect: "lend", fromWallet: "Cash", amount: 50000, description: "Lent" }),
  ];

  it("adds every loan and credit line together, from what was owed before the period", () => {
    const s = buildSheet(rows, { type: "borrowed", year: 2026, fromMonth: 1, toMonth: 12 }, reference, debts);
    expect(s.broughtForward).toBe(100000);
    expect(s.lines.map((l) => [l.description, l.moneyIn, l.moneyOut, l.balance])).toEqual([
      ["Maya Credit: Paid the card", 0, 40000, 60000],
      ["Maya Credit: Interest", 0, 1879, 60000],
      ["Bank loan: Loan released", 500000, 0, 560000],
    ]);
    expect(s.notes[0]).toContain("₱18.79");
  });

  it("keeps credit lines apart from loans", () => {
    const s = buildSheet(rows, { type: "credit", year: 2026, fromMonth: 1, toMonth: 12 }, reference, debts);
    expect(s.lines.every((l) => l.description.startsWith("Maya Credit"))).toBe(true);
    expect(s.closing).toBe(60000);
  });

  it("says what is owed to you on a statement of money lent", () => {
    const s = buildSheet(rows, { type: "lent", year: 2026, fromMonth: 1, toMonth: 12 }, reference, debts);
    expect(s.headings).toEqual({ moneyIn: "Lent", moneyOut: "Collected", balance: "Owed to you" });
    expect(s.closing).toBe(50000);
  });

  it("follows one debt by name", () => {
    const s = buildSheet(rows, { type: "debt", year: 2026, fromMonth: 1, toMonth: 12, debtId: "card" }, reference, debts);
    expect(s.subject).toBe("Maya Credit");
    expect(s.lines).toHaveLength(2);
    expect(s.lines[0]!.description).toBe("Paid the card");
  });
});

describe("the period", () => {
  it("names one month or a span", () => {
    expect(periodLabel(2026, 1, 9)).toBe("January to September 2026");
    expect(periodLabel(2026, 9, 9)).toBe("September 2026");
    expect(periodLabel(2026, 9, 1)).toBe("January to September 2026");
  });
});
