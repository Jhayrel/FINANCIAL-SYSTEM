/**
 * A month already over its budget is never given to the model as a negative
 * figure a day. On 30 September 2026 the context said "What is left of the
 * budget works out to PHP -10,218.71 a day" and the model passed it on as "a
 * daily shortfall of PHP -10,218.71". Figures are invented.
 */
import { describe, expect, it } from "vitest";

import { buildContext, contextToText } from "./aiContext";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const spend = (date: string, total: number): Transaction => ({
  id: `t-${date}-${total}`,
  recordNumber: 1,
  date,
  type: "Spending",
  fromWallet: "Cash",
  toWallet: "",
  category: "Spending",
  item: "Food",
  description: "",
  amount: total,
  fee: 0,
  total,
  notes: "",
  status: "Paid",
});

const reference: ReferenceLists = {
  wallets: ["Cash"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [{ name: "Food", remark: "" }],
};

const budget = (spending: number): Budgets =>
  ({ "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, spending, 0, 0, 0], billsSubs: Array(12).fill(0) } }) as unknown as Budgets;

const textFor = (budgets: Budgets): string =>
  contextToText(
    buildContext({
      transactions: [spend("2026-09-10", 500000)],
      accounts: [{ id: "cash", name: "Cash", kind: "spending", archived: false }],
      budgets,
      credits: [],
      reference,
      lowBalanceThreshold: 0,
      asOf: "2026-09-26",
    }),
  );

describe("what is left of the budget a day", () => {
  it("is said as a figure while some is left", () => {
    expect(textFor(budget(1000000))).toMatch(/works out to PHP [\d,]+\.\d{2} a day/);
  });

  it("is never negative once the month is over it", () => {
    const text = textFor(budget(300000));
    expect(text).not.toMatch(/-\s?(?:PHP\s)?[\d,]+\.\d{2} a day/);
    expect(text).toMatch(/Nothing is left of the budget to spend a day/);
    expect(text).toMatch(/over by PHP 2,000\.00/);
  });
});
