/**
 * A chart asked for money in draws money in.
 *
 * From the owner's own chat, 26 September 2026: "show my in chart all my
 * positive spending?" came back as a spending chart, and underneath it they
 * wrote "//why it didnt show my my positive spending etc".
 */

import { describe, expect, it } from "vitest";

import { buildChart } from "./charts";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction>): Transaction =>
  ({
    id: Math.random().toString(),
    recordNumber: 1,
    date: "2026-09-10",
    type: "Spending",
    category: "Spending",
    item: "Food",
    description: "",
    fromWallet: "Cash",
    toWallet: "",
    amount: 10_000,
    fee: 0,
    total: 10_000,
    notes: "",
    status: "Paid",
    ...over,
  }) as Transaction;

const ledger: Transaction[] = [
  row({ amount: 10_000, total: 10_000 }),
  row({
    type: "Revenue",
    category: "Revenue",
    item: "Allowance",
    fromWallet: "",
    toWallet: "Gcash",
    amount: 50_000,
    total: 50_000,
    status: "Done",
  }),
];

const drawn = (question: string) => buildChart(question, ledger, "2026-09-26");

describe("which way the money goes", () => {
  const MONEY_IN = [
    "show my in chart all my positive spending",
    "chart my income this year",
    "chart my revenue per month",
    "chart my gains this month",
    "chart what came in this month",
    "chart my deposits this year",
    "i-chart mo yung natanggap ko this month",
  ];

  for (const question of MONEY_IN) {
    it(`draws money in for "${question}"`, () => {
      const chart = drawn(question);
      expect(chart?.direction, question).toBe("revenue");
      expect(chart?.title, question).toContain("Income");
    });
  }

  const MONEY_OUT = [
    "chart my spending this year",
    "chart where my money went this month",
    "chart my food this year",
  ];

  for (const question of MONEY_OUT) {
    it(`still draws money out for "${question}"`, () => {
      expect(drawn(question)?.direction, question).toBe("spending");
    });
  }

  /*
   * "kita" is earnings in one sentence and "see you" in the next, so it is
   * deliberately not a word for income. This pins that decision rather than
   * leaving it to be undone by someone adding the obvious translation.
   */
  it("does not read a bare kita as income", () => {
    expect(drawn("chart my spending, kita tayo bukas")?.direction).toBe("spending");
  });
});
