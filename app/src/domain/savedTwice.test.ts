/**
 * The same entry saved twice within seconds is reported in Needs review
 * (owner's backup, 15 November 2026). Invented figures.
 */
import { describe, expect, it } from "vitest";

import { actionableIssues, checkIntegrity, todoFor } from "./integrity";
import type { Transaction } from "./types";

const row = (id: string, n: number, over: Partial<Transaction> = {}): Transaction =>
  ({ id, recordNumber: n, date: "2026-10-15", type: "Revenue", category: "Revenue", item: "Bank interest", fromWallet: "", toWallet: "Bank C", description: "Interest", amount: 31, fee: 0, total: 31, notes: "", status: "Done", ...over }) as Transaction;

describe("the same entry saved twice in a row", () => {
  it("is reported, with both numbers and the seconds between them", () => {
    const found = checkIntegrity([row("t-1792230426103-5", 900), row("t-1792230434507-6", 901)]).filter((i) => i.code === "saved-twice");
    expect(found).toHaveLength(1);
    expect(found[0]!.recordNumbers).toEqual([900, 901]);
    expect(found[0]!.message).toBe("#0900 and #0901 are the same entry saved 8 seconds apart: the same day, kind, amount and account.");
    expect(actionableIssues(found)).toHaveLength(1);
    expect(todoFor("saved-twice")).toMatch(/move the later one to the bin/);
  });
  it("never for minutes apart, another amount or account, or rows the app did not save", () => {
    const quiet = (rows: Transaction[]) => checkIntegrity(rows).filter((i) => i.code === "saved-twice");
    expect(quiet([row("t-1792230426103-5", 900), row("t-1792230726103-6", 901)])).toEqual([]);
    expect(quiet([row("t-1792230426103-5", 900), row("t-1792230434507-6", 901, { amount: 32, total: 32 })])).toEqual([]);
    expect(quiet([row("t-1792230426103-5", 900), row("t-1792230434507-6", 901, { toWallet: "Wallet B" })])).toEqual([]);
    expect(quiet([row("x258", 900), row("x260", 901)])).toEqual([]);
  });
});
