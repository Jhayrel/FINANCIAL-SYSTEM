/**
 * One definition of spending, everywhere.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * Three places have now had their own private copy of "what counts as
 * spending", and all three eventually disagreed with the app:
 *
 *   `charts.ts`          over-counted 2026 by PHP 13,128.00
 *   `aiChatContext.ts`   wrong in both directions at once
 *   `totals.ts`          the one that is right, and the only one left
 *
 * Every one of them looked correct for a long time, because the Excel
 * fixture happens not to contain the rows where the definitions differ: it
 * has no Spending row with a blank category, and its Debt rows are created
 * by a migration that runs in the app rather than in the fixture.
 *
 * So a passing test suite proved nothing. This file supplies those rows
 * deliberately, and asserts that everything which reports a figure to the
 * owner reports the same one. The rows below are the whole point: keep them.
 */

import { describe, expect, it } from "vitest";

import { buildChart } from "./charts";
import { costOf, totalsFor } from "./totals";
import { buildChatContext } from "./aiChatContext";
import { buildContext } from "./aiContext";
import type { Transaction } from "./types";

const base = {
  recordNumber: 1,
  date: "2026-08-10",
  fromWallet: "Maya",
  toWallet: "",
  description: "",
  fee: 0,
  notes: "",
  status: "Paid" as const,
};

/** The three rows the fixture does not have, and the definitions differ on. */
const awkward: Transaction[] = [
  { ...base, id: "a", type: "Spending", category: "Spending", item: "Food", amount: 10000, total: 10000 },
  // Debt interest: counted by the app, ignored by the chat's old copy.
  {
    ...base,
    id: "b",
    recordNumber: 2,
    type: "Debt",
    category: "",
    item: "",
    debtId: "d1",
    debtEffect: "interest",
    amount: 18879,
    total: 18879,
  },
  // Blank category: ignored by the app, counted by the chat's old copy.
  { ...base, id: "c", recordNumber: 3, type: "Spending", category: "", item: "Mystery", amount: 99900, total: 99900 },
  // Between the owner's own pockets: the fee, not the thousand.
  {
    ...base,
    id: "d",
    recordNumber: 4,
    type: "Transfer",
    category: "Transfer",
    item: "",
    toWallet: "Cash",
    amount: 100000,
    fee: 1500,
    total: 101500,
  },
];

/** Food 100.00 + interest 188.79 + transfer fee 15.00. Not the Mystery 999. */
const TRUTH = 10000 + 18879 + 1500;

describe("every figure the owner can see agrees", () => {
  it("totalsFor is the definition", () => {
    expect(totalsFor(awkward).total).toBe(TRUTH);
  });

  it("costOf sums to the same", () => {
    expect(awkward.reduce((sum, t) => sum + costOf(t), 0)).toBe(TRUTH);
  });

  it("a chart of the same window draws the same figure", () => {
    expect(buildChart("chart this month", awkward, "2026-08-29")?.total).toBe(TRUTH);
  });

  /**
   * The one that was wrong.
   *
   * On these rows the model was given a total built from its own definition,
   * which counted the blank-category PHP 999.00 and dropped the PHP 188.79 of
   * debt interest. Every screen showed PHP 303.79 while it answered from
   * something else entirely.
   */
  it("the figures handed to the model are the same ones", () => {
    const snapshot = buildContext({
      transactions: awkward,
      accounts: [],
      budgets: {},
      credits: [],
      reference: {
        wallets: ["Cash", "Maya"],
        savings: [],
        bills: [],
        subscriptions: [],
        revenueCategories: [],
        spendingTypes: [{ name: "Food", remark: "" }],
      },
      lowBalanceThreshold: 0,
      asOf: "2026-08-29",
    });
    const context = buildChatContext({
      snapshot,
      transactions: awkward,
      asOf: "2026-08-29",
      question: "how much did I spend this month",
    });
    expect(context.text).toContain("Spent PHP 303.79");

    /**
     * The row itself is still listed, and should be: the model gets the raw
     * ledger so it can answer "which ones" and "when". What matters is that
     * it is not counted, so the breakdown must not name it.
     */
    const from = context.text.indexOf("spending by item");
    const byItem = context.text.slice(from, context.text.indexOf("##", from + 1));
    expect(byItem).toContain("Food");
    expect(byItem).not.toContain("Mystery");

    // The debt interest the app counts is in the split.
    expect(context.text).toContain("debt interest PHP 188.79");
  });
});

describe("the rows that expose a difference", () => {
  it("counts debt interest", () => {
    const interest = awkward.filter((t) => t.debtEffect === "interest");
    expect(interest.reduce((s, t) => s + costOf(t), 0)).toBe(18879);
  });

  it("ignores a Spending row with no category", () => {
    const mystery = awkward.filter((t) => t.item === "Mystery");
    expect(mystery.reduce((s, t) => s + costOf(t), 0)).toBe(0);
  });

  it("counts only the fee on a move between your own pockets", () => {
    const moved = awkward.filter((t) => t.type === "Transfer");
    expect(moved.reduce((s, t) => s + costOf(t), 0)).toBe(1500);
  });
});
