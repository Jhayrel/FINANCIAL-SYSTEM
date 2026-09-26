/**
 * What a debt stood at when the records begin.
 *
 * The 2025 workbook shows three repayments of money borrowed through PNB
 * before its first row. The debt's starting point is a draw that no wallet
 * received inside the ledger, filed Opening, as a wallet's starting balance
 * is. The integrity check must not call that a broken row, and it must count
 * as neither spending nor income.
 */

import { describe, expect, it } from "vitest";

import { checkIntegrity } from "./integrity";
import { costOf, incomeOf } from "./totals";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction>): Transaction => ({
  id: "t1",
  recordNumber: 1,
  date: "2025-01-01",
  type: "Debt",
  fromWallet: "",
  toWallet: "",
  category: "Opening",
  item: "PNB loan",
  description: "Owed to PNB when the 2025 records begin",
  amount: 856000,
  fee: 0,
  total: 856000,
  notes: "",
  status: "Done",
  debtId: "d1",
  debtEffect: "draw",
  ...over,
});

describe("a debt's opening position", () => {
  it("is not a row with no wallet", () => {
    expect(checkIntegrity([row({})]).filter((i) => i.code === "no-wallet")).toEqual([]);
  });

  it("is neither spending nor income", () => {
    expect(costOf(row({}))).toBe(0);
    expect(incomeOf(row({}))).toBe(0);
  });

  it("still flags an ordinary draw that names no wallet", () => {
    expect(checkIntegrity([row({ category: "" })]).map((i) => i.code)).toContain("no-wallet");
  });
});
