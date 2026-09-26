import { describe, expect, it } from "vitest";

import type { Account } from "./accounts";
import { createBackup, planStartClean, type BackupData } from "./backup";
import type { Debt } from "./debt";
import { allWalletBalances } from "./balances";
import { defaultSettings } from "./settings";
import type { DeletedTransaction, Transaction } from "./types";

const row = (id: string, date: string, over: Partial<Transaction> = {}): Transaction => ({
  id,
  recordNumber: 1,
  date,
  type: "Spending",
  fromWallet: "Cash",
  toWallet: "",
  category: "Spending",
  item: "Food",
  description: `Row ${id}`,
  amount: 10000,
  fee: 0,
  total: 10000,
  notes: "",
  status: "Paid",
  ...over,
});

const account = (name: string): Account => ({ id: `a-${name}`, name, kind: "spending", archived: false });
const debt = (id: string, name: string): Debt => ({
  id, name, kind: "payable", counterparty: name, openedDate: "2026-01-01", wallet: "Maya",
  interestType: "none", interestRate: 0, notes: "", archived: false,
});

// What the app holds: two real rows, two test rows, a test account and debt, and a bin of test rows.
const real1 = row("app-1", "2026-01-04", { description: "Lunch" });
const real2 = row("app-2", "2026-01-05", { description: "Load", amount: 5000, total: 5000 });
const test1 = row("app-t1", "2026-09-20", { type: "Revenue", fromWallet: "", toWallet: "Gcash", category: "Revenue", amount: 47000000, total: 47000000, description: "test" });
const test2 = row("app-t2", "2026-09-21", { type: "Debt", fromWallet: "Cash", debtId: "tester", debtEffect: "lend", category: "", amount: 400, total: 400, description: "test lend" });
const binned: DeletedTransaction[] = [
  { ...row("app-b1", "2026-09-01", { description: "binned test" }), deletedAt: "2026-09-02T00:00:00Z" },
  { ...row("app-b2", "2026-09-03", { description: "binned test 2" }), deletedAt: "2026-09-04T00:00:00Z" },
];

const current: BackupData = {
  transactions: [real1, real2, test1, test2],
  deleted: binned,
  budgets: { "2026": { spending: [], billsSubs: [] } } as unknown as BackupData["budgets"],
  settings: {
    ...defaultSettings(),
    accounts: [account("Cash"), account("Gcash"), account("Reserved Fund")],
    credits: [debt("tester", "Claude Tester"), debt("maya-credit", "Maya Credit")],
  },
  preferences: { theme: "dark" },
  migrations: { debt: true, opening: true },
};

// The file: the same two real rows under other ids, an older row, and a debt row.
const file = createBackup(
  {
    transactions: [
      row("x0", "2025-06-01", { type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", amount: 30000, total: 30000, description: "Old income" }),
      { ...real1, id: "x1", recordNumber: 2 },
      { ...real2, id: "x2", recordNumber: 3 },
      row("x3", "2026-02-01", { type: "Debt", fromWallet: "Maya", debtId: "file-card", debtEffect: "repay", category: "", description: "Card" }),
    ],
    deleted: [],
    budgets: {},
    settings: { ...defaultSettings(), accounts: [account("Cash"), account("Maya")], credits: [debt("file-card", "Maya Credit")] },
    preferences: { theme: "light" },
    migrations: { debt: true, opening: true },
  },
  "2026-09-26T00:00:00Z",
);

describe("starting clean from a file", () => {
  const plan = planStartClean(file, current);

  it("makes the ledger exactly the file's rows", () => {
    expect(plan.transactions).toHaveLength(4);
    expect(plan.transactions.map((t) => t.description)).toEqual(["Old income", "Lunch", "Load", "Card"]);
    expect(allWalletBalances(plan.transactions)).toEqual(allWalletBalances(file.data.transactions));
  });

  it("reuses the document of a row already here, so nothing is doubled", () => {
    expect(plan.kept).toBe(2);
    expect(plan.added).toBe(2);
    expect(plan.transactions.find((t) => t.description === "Lunch")!.id).toBe("app-1");
  });

  it("sets the test rows aside and clears the whole bin, deleting nothing", () => {
    expect(plan.setAside.map((t) => t.id)).toEqual(["app-t1", "app-t2"]);
    expect(plan.binCleared.map((t) => t.id)).toEqual(["app-b1", "app-b2"]);
    expect(plan.discard).toEqual(["app-t1", "app-t2", "app-b1", "app-b2"]);
    expect(plan.deleted).toEqual([]);
  });

  it("points the file's debt rows at the debt already here with that name", () => {
    expect(plan.transactions.find((t) => t.description === "Card")!.debtId).toBe("maya-credit");
    expect(plan.settings.credits.filter((d) => d.name === "Maya Credit")).toHaveLength(1);
  });

  it("archives the test account and debt that nothing uses any more, and adds the file's", () => {
    expect(plan.archivedAccounts).toEqual(["Gcash", "Reserved Fund"]);
    expect(plan.archivedDebts).toEqual(["Claude Tester"]);
    expect(plan.settings.accounts.find((a) => a.name === "Maya")).toBeDefined();
    expect(plan.settings.accounts.find((a) => a.name === "Reserved Fund")!.archived).toBe(true);
    expect(plan.settings.credits.find((d) => d.name === "Claude Tester")!.archived).toBe(true);
  });

  it("keeps this device's settings, budgets and theme", () => {
    expect(plan.preferences.theme).toBe("dark");
    expect(plan.budgets).toBe(current.budgets);
    expect(plan.settings.ai).toEqual(current.settings.ai);
  });

  it("does nothing more the second time", () => {
    const again = planStartClean(file, { ...current, transactions: plan.transactions, deleted: plan.deleted, settings: plan.settings });
    expect(again.kept).toBe(4);
    expect(again.added).toBe(0);
    expect(again.discard).toEqual([]);
  });
});
