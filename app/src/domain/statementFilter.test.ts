import { describe, expect, it } from "vitest";

import type { Debt } from "./debt";
import { filterChoices, filterName, matchesFilter } from "./statementFilter";
import { buildSheet } from "./statementSheet";
import { buildStatementBetween } from "./statements";
import { readExportAsk, sheetRequestOf, withCut } from "./exportAsk";
import type { ReferenceLists, Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction> & Pick<Transaction, "date" | "type" | "amount">): Transaction => {
  n += 1;
  const fee = over.fee ?? 0;
  return {
    id: `f${n}`,
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
  wallets: ["Cash", "Maya"],
  savings: ["Savings A", "Savings B"],
  bills: ["Internet", "Phone"],
  subscriptions: ["Music", "Storage"],
  revenueCategories: [],
  spendingTypes: [],
};
const savings = new Set(reference.savings);

const rows = [
  row({ date: "2026-01-01", type: "Revenue", category: "Opening", toWallet: "Maya", amount: 1000000 }),
  row({ date: "2026-01-02", type: "Revenue", item: "Salary", toWallet: "Maya", amount: 2000000 }),
  row({ date: "2026-01-04", type: "Spending", category: "Subscriptions", item: "Music", fromWallet: "Maya", amount: 8500 }),
  row({ date: "2026-01-15", type: "Spending", category: "Subscriptions", item: "Storage", fromWallet: "Maya", amount: 11900 }),
  row({ date: "2026-01-17", type: "Spending", category: "Bills", item: "Phone", fromWallet: "Maya", amount: 19900 }),
  row({ date: "2026-01-18", type: "Spending", category: "Bills", item: "Internet", fromWallet: "Maya", amount: 99900 }),
  row({ date: "2026-02-04", type: "Spending", category: "Subscriptions", item: "Music", fromWallet: "Maya", amount: 8500 }),
  row({ date: "2026-02-05", type: "Spending", item: "Food", fromWallet: "Cash", amount: 20000 }),
  row({ date: "2026-02-06", type: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 100000, fee: 1800, description: "ATM withdrawal" }),
  row({ date: "2026-02-07", type: "Transfer", fromWallet: "Maya", toWallet: "Savings A", amount: 50000, fee: 1500 }),
  row({ date: "2026-02-08", type: "Transfer", fromWallet: "Maya", toWallet: "", amount: 30000, fee: 1000, description: "Sent to a friend" }),
  row({ date: "2026-02-09", type: "Transfer", fromWallet: "Maya", toWallet: "Savings B", amount: 20000 }),
];
const sheetOf = (type: Parameters<typeof buildSheet>[1]["type"], only?: string, debts: readonly Debt[] = []) =>
  buildSheet(rows, { type, year: 2026, fromMonth: 1, toMonth: 2, only }, reference, debts);

describe("bills and subscriptions, cut to part", () => {
  it("offers bills only, subscriptions only, and each one by name under its heading", () => {
    const c = filterChoices("bills", rows.filter((t) => t.category === "Bills" || t.category === "Subscriptions"), savings, "Cash");
    expect(c.options).toEqual(["All bills and subscriptions", "Bills only", "Subscriptions only", "Internet", "Phone", "Music", "Storage"]);
    expect(c.groups["Music"]).toBe("Subscriptions");
    expect(c.groups["Phone"]).toBe("Bills");
  });

  it("totals only what was picked, and names it", () => {
    expect(sheetOf("bills").lines.at(-1)?.balance).toBe(8500 + 11900 + 19900 + 99900 + 8500);
    const subs = sheetOf("bills", "cat:Subscriptions");
    expect(subs.lines.map((l) => l.moneyOut)).toEqual([8500, 11900, 8500]);
    expect(subs.lines.at(-1)?.balance).toBe(28900);
    expect(subs.subject).toBe("Subscriptions only");
    const bills = sheetOf("bills", "cat:Bills");
    expect(bills.lines.at(-1)?.balance).toBe(119800);
    const music = sheetOf("bills", "kind:Music");
    expect(music.lines.map((l) => l.moneyOut)).toEqual([8500, 8500]);
    expect(music.subject).toBe("Music");
  });

  it("gives the CSV the same rows as the screen", () => {
    const s = buildStatementBetween(rows, "bills", "2026-01-01", "2026-02-28", reference, undefined, { only: "kind:Music" });
    expect(s.rows).toHaveLength(2);
  });
});

describe("transfers, cut to part", () => {
  it("tells money moved between your accounts, cash taken out and money sent away apart", () => {
    const transfers = rows.filter((t) => t.type === "Transfer");
    const c = filterChoices("transfers", transfers, savings, "Cash");
    expect(c.options.slice(0, 4)).toEqual(["All transfers", "Between your accounts", "Cash withdrawals", "Sent out"]);
    expect(transfers.filter((t) => matchesFilter(t, "withdrawals", "Cash")).map((t) => t.description)).toEqual(["ATM withdrawal"]);
    expect(transfers.filter((t) => matchesFilter(t, "out", "Cash")).map((t) => t.description)).toEqual(["Sent to a friend"]);
    expect(transfers.filter((t) => matchesFilter(t, "between", "Cash"))).toHaveLength(2);
    expect(sheetOf("transfers", "out").lines.at(-1)?.balance).toBe(1000);
    expect(sheetOf("transfers", "wallet:Savings A").lines).toHaveLength(1);
  });
});

describe("the other statements, cut to part", () => {
  it("expense by kind or by wallet, income by kind", () => {
    expect(sheetOf("expense", "kind:Food").lines.map((l) => l.moneyOut)).toEqual([20000]);
    expect(sheetOf("expense", "from:Cash").lines.map((l) => l.moneyOut)).toEqual([20000]);
    expect(sheetOf("revenue", "kind:Salary").lines.map((l) => l.moneyIn)).toEqual([2000000]);
    expect(sheetOf("revenue", "into:Maya").lines.map((l) => l.moneyIn)).toEqual([2000000]);
    expect(sheetOf("expense", "from:Cash").subject).toBe("Paid from Cash");
  });

  it("one savings account keeps that account's own balance", () => {
    const a = sheetOf("savings", "wallet:Savings A");
    expect(a.lines.map((l) => [l.moneyIn, l.balance])).toEqual([[50000, 50000]]);
    const all = sheetOf("savings");
    expect(all.lines.at(-1)?.balance).toBe(70000);
  });

  it("one lender keeps what that lender is owed", () => {
    const card: Debt = {
      id: "card", name: "Card", kind: "payable", counterparty: "Bank", openedDate: "2025-01-01",
      wallet: "Maya", interestType: "none", interestRate: 0, form: "credit-line", notes: "", archived: false,
    };
    const loan: Debt = { ...card, id: "loan", name: "Loan", form: "term-loan" };
    const owed = [
      row({ date: "2025-12-01", type: "Debt", debtId: "card", debtEffect: "draw", toWallet: "Maya", amount: 100000 }),
      row({ date: "2026-01-10", type: "Debt", debtId: "loan", debtEffect: "draw", toWallet: "Cash", amount: 500000 }),
      row({ date: "2026-01-20", type: "Debt", debtId: "card", debtEffect: "repay", fromWallet: "Maya", amount: 40000 }),
    ];
    const s = buildSheet(owed, { type: "borrowed", year: 2026, fromMonth: 1, toMonth: 1, only: "debt:card" }, reference, [card, loan]);
    expect(s.broughtForward).toBe(100000);
    expect(s.lines.map((l) => l.balance)).toEqual([60000]);
    expect(s.subject).toBe("Card");
    expect(filterName("debt:loan", [card, loan])).toBe("Loan");
  });

  it("is ignored on a statement it does not apply to", () => {
    expect(sheetOf("account", "kind:Music").lines.length).toBe(sheetOf("account").lines.length);
  });
});

describe("asked for in chat, cut the same way", () => {
  const ask = (said: string) => {
    const read = readExportAsk(said, "2026-10-12");
    return read ? withCut(read, rows, reference, []) : null;
  };
  it("reads the part of the statement named", () => {
    expect(ask("subscriptions only statement for 2026")).toMatchObject({ type: "bills", only: "cat:Subscriptions" });
    expect(ask("bills statement 2026")).toMatchObject({ type: "bills", only: "cat:Bills" });
    expect(ask("bills and subscriptions statement 2026")?.only).toBeUndefined();
    expect(ask("statement of my Music subscription 2026")).toMatchObject({ type: "bills", only: "kind:Music" });
    expect(ask("Music statement this year")).toMatchObject({ type: "bills", only: "kind:Music" });
    expect(ask("expense statement for food 2026")).toMatchObject({ type: "expense", only: "kind:Food" });
    expect(ask("cash withdrawals statement 2026")).toMatchObject({ type: "transfers", only: "withdrawals" });
    expect(ask("Maya statement 2026")).toMatchObject({ type: "wallet", wallet: "Maya" });
  });
  it("leaves a statement named only by its sheet or period whole", () => {
    expect(ask("statement for October 2026")).toMatchObject({ type: "account" });
    expect(ask("statement for October 2026")?.only).toBeUndefined();
    expect(ask("revenue statement 2026")?.only).toBeUndefined();
  });
  it("hands the cut to the sheet the file is made from", () => {
    const read = ask("subscriptions only statement for 2026")!;
    const sheet = buildSheet(rows, sheetRequestOf(read, "2026-10-12"), reference, []);
    expect(sheet.subject).toBe("Subscriptions only");
    expect(sheet.lines.every((l) => l.kind === "Subscription")).toBe(true);
  });
});
