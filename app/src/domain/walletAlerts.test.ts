import { describe, expect, it } from "vitest";

import { financeAlerts } from "./alerts";
import type { Transaction } from "./types";

/*
 * 13 October 2026: "Gcash is empty" led the bell every time, though the
 * owner keeps it empty on purpose. A wallet is warned about by how it is used.
 */
let n = 0;
const row = (date: string, o: Partial<Transaction>): Transaction =>
  ({ id: `w${(n += 1)}`, recordNumber: n, date, type: "Spending", category: "Spending", item: "Food", fromWallet: "", toWallet: "", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "", ...o }) as Transaction;
const accounts = [{ id: "g", name: "Gcash", kind: "spending", archived: false }] as never;
const alertsOn = (rows: Transaction[], asOf: string) =>
  financeAlerts({ transactions: rows, accounts, budgets: {}, debts: [], bills: [], lowBalanceThreshold: 50000, asOf }).filter((a) => a.area === "wallet");

describe("a low wallet, by how it is used", () => {
  const rows = [row("2026-09-01", { type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Gcash", amount: 100000, total: 100000 }), row("2026-09-02", { fromWallet: "Gcash", amount: 100000, total: 100000 })];
  it("says so once, for a few days, when it runs out", () => {
    expect(alertsOn(rows, "2026-09-03").map((a) => a.title)).toEqual(["Gcash is empty"]);
  });
  it("goes quiet when it is left empty on purpose", () => {
    expect(alertsOn(rows, "2026-10-13")).toEqual([]);
  });
  it("warns while money still leaves it", () => {
    const used = [...rows, row("2026-10-10", { type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Gcash", amount: 20000, total: 20000 }), row("2026-10-11", { fromWallet: "Gcash", amount: 10000, total: 10000 })];
    const [alert] = alertsOn(used, "2026-10-13");
    expect(alert?.level).toBe("warn");
    expect(alert?.detail).toContain("it was last used on October 11, 2026");
  });
  it("always says when it is below zero", () => {
    expect(alertsOn([row("2026-01-01", { fromWallet: "Gcash", amount: 500, total: 500 })], "2026-10-13").map((a) => a.level)).toEqual(["over"]);
  });
});
