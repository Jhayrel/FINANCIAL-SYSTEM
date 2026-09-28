import { describe, expect, it } from "vitest";

import { inLedgerOrNot } from "./checkPicture";
import { duplicatesOf } from "./duplicates";
import { emptyDraft, type Draft } from "./entry";
import type { Transaction } from "./types";

/**
 * 28 September 2026: the owner sent their Maya and GCash histories again,
 * every row already logged by hand the day before, and 7 of 11 came back as
 * new. The ledger's rows below are those rows, figures as saved; the cards
 * are as the model read them, dates and kinds included.
 */
const row = (recordNumber: number, date: string, type: Transaction["type"], fromWallet: string, toWallet: string, amount: number, fee = 0, extra: Partial<Transaction> = {}): Transaction =>
  ({ id: `r${recordNumber}`, recordNumber, date, type, fromWallet, toWallet, category: "", item: "", description: "", amount, fee, total: amount + fee, notes: "", status: "Paid", ...extra }) as Transaction;

const ledger: Transaction[] = [
  row(3807, "2026-09-23", "Revenue", "", "Maya", 174, 0, { item: "Random" }),
  row(3812, "2026-09-24", "Transfer", "Maya", "Cash", 51600),
  row(3823, "2026-09-26", "Spending", "Maya", "", 18500, 0, { item: "Food" }),
  row(3824, "2026-09-26", "Transfer", "Maya", "Cash", 21800),
  row(3831, "2026-09-26", "Spending", "Maya", "", 39900, 0, { item: "Food" }),
  row(3825, "2026-09-27", "Debt", "", "Cash", 9400, 0, { debtEffect: "collect" }),
  row(3826, "2026-09-27", "Revenue", "", "Gcash", 1500000, 0, { item: "Allowance" }),
  row(3827, "2026-09-27", "Debt", "", "Gcash", 2500000, 0, { debtEffect: "draw" }),
  row(3828, "2026-09-27", "Transfer", "Gcash", "", 500000, 1000, { item: "Money Send" }),
  row(3829, "2026-09-27", "Debt", "Gcash", "", 2500000, 0, { debtEffect: "repay" }),
  row(3830, "2026-09-27", "Transfer", "Gcash", "Maya", 998000, 1000, { item: "Transaction Fee" }),
  row(3834, "2026-09-27", "Transfer", "Maya", "Cash", 150000, 1800, { item: "Transaction Fee" }),
  row(3839, "2026-09-27", "Debt", "Maya", "", 430206, 0, { debtEffect: "repay" }),
];

const card = (flow: Draft["flow"], date: string, fromWallet: string, toWallet: string, amount: number, item = ""): Draft => ({
  ...emptyDraft(date),
  flow,
  fromWallet,
  toWallet,
  amount,
  item,
});

const CARDS: [string, Draft, number[]][] = [
  ["BAUANG CROSSING, the ledger's 1,500 plus 18 fee", card("Spending", "2026-09-26", "Maya", "", 151800, "Food"), [3834]],
  ["MCDO 878 BAUANG", card("Spending", "2026-09-26", "Maya", "", 39900, "Food"), [3831]],
  ["Bills Payment for Maya Bank, read with no account", card("Transfer", "2026-09-26", "", "", 430206), [3839]],
  ["received from their own name, into Maya", card("Revenue", "2026-09-26", "", "Maya", 998000), [3830]],
  ["7-Eleven, two days out", card("Spending", "2026-09-24", "Maya", "", 18500, "Food"), [3823]],
  ["TANQUI SFLU, a withdrawal read as food, two days out", card("Spending", "2026-09-24", "Maya", "", 21800, "Food"), [3824]],
  ["St.Louis College, a withdrawal read as school", card("Spending", "2026-09-23", "Maya", "", 51600, "School"), [3812]],
  ["cash back of 1.74", card("Revenue", "2026-09-23", "", "Maya", 174), [3807]],
  ["GCash to PNB, logged as two rows", card("Transfer", "2026-09-27", "Gcash", "", 3001000), [3829, 3828]],
  ["GCash to Maya, 9,980 plus 10 fee", card("Transfer", "2026-09-27", "Gcash", "Maya", 999000), [3830]],
  ["Send Money received, logged as two rows", card("Revenue", "2026-09-27", "", "Gcash", 4000000), [3827, 3826]],
];

describe("a bank's history, against what was logged by hand", () => {
  it.each(CARDS)("%s", (_, draft, records) => {
    const match = duplicatesOf(draft, ledger)[0];
    expect(match, "found").toBeDefined();
    expect([match!.row.recordNumber, ...(match!.also ?? []).map((t) => t.recordNumber)]).toEqual(records);
  });

  it("says all eleven are already in, and offers none to add", () => {
    const answer = inLedgerOrNot(CARDS.map(([, d]) => d), ledger);
    expect(answer.missing).toEqual([]);
    expect(answer.already).toHaveLength(11);
  });

  it("still leaves a new purchase alone", () => {
    expect(duplicatesOf(card("Spending", "2026-09-27", "Maya", "", 25000, "Food"), ledger)).toEqual([]);
    // A round figure with no account named is not matched on the figure alone.
    expect(duplicatesOf(card("Spending", "2026-09-27", "", "", 50000), ledger)).toEqual([]);
  });
});
