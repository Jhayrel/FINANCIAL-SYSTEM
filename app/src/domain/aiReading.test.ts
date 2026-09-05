/**
 * What the assistant can actually see.
 *
 * Two failures from the owner's own record, both of which read as the app
 * being broken and were really the assistant being handed the wrong thing:
 *
 *   "This week is not separated out in the entries, so I do not have a clean
 *    cut for it."
 *
 *   "Charts do not exist in the data I have."
 *
 * The first was true: the context had months and years and nothing smaller.
 * The second was the request never reaching the part that draws charts.
 */

import { describe, expect, it } from "vitest";

import { buildChatContext } from "./aiChatContext";
import { buildContext } from "./aiContext";
import { wantsChart } from "./charts";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

const budgets: Budgets = {};

const ASOF = "2026-09-05"; // A Saturday.

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: ASOF,
    type: "Spending",
    fromWallet: "Gcash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const build = (rows: readonly Transaction[], question = "how is this week going"): string => {
  const transactions = [...rows];
  const snapshot = buildContext({
    transactions,
    accounts: [],
    budgets,
    credits: [],
    reference,
    lowBalanceThreshold: 0,
    asOf: ASOF,
  });
  return buildChatContext({ snapshot, transactions, asOf: ASOF, question }).text;
};

describe("the windows a month total cannot answer", () => {
  const ledger = [
    row({ date: "2026-09-05", amount: 10000, total: 10000 }),
    row({ date: "2026-09-04", amount: 20000, total: 20000 }),
    row({ date: "2026-08-31", amount: 40000, total: 40000 }),
    row({ date: "2026-08-01", amount: 80000, total: 80000 }),
  ];

  it("gives the section at all, which is what was missing", () => {
    expect(build(ledger)).toContain("## Recent windows, already worked out");
  });

  it("gives today", () => {
    expect(build(ledger)).toContain("Today");
  });

  it("gives yesterday", () => {
    expect(build(ledger)).toContain("Yesterday");
  });

  /** The question it refused outright. */
  it("gives this week, Monday to now", () => {
    expect(build(ledger)).toContain("This week, Monday to now");
  });

  it("gives last week as its own window", () => {
    expect(build(ledger)).toContain("Last week, Monday to Sunday");
  });

  it("gives rolling windows too, because 'the last few days' is not a week", () => {
    const text = build(ledger);
    expect(text).toContain("The last 7 days");
    expect(text).toContain("The last 30 days");
  });

  /**
   * The week runs Monday to Sunday, so a Saturday's week starts on the
   * Monday before it. Only the two September rows fall inside.
   */
  it("counts the week from Monday, not from seven days ago", () => {
    const week = build(ledger)
      .split("\n")
      .find((l) => l.startsWith("This week, Monday to now"));
    expect(week).toContain("2026-08-31 to 2026-09-05");
    expect(week).toContain("3 entries");
  });

  it("breaks the fortnight down day by day", () => {
    const text = build(ledger);
    expect(text).toContain("## The last fortnight, day by day");
    expect(text).toContain("2026-09-04: spent");
  });

  it("skips days with nothing on them rather than printing empty rows", () => {
    expect(build(ledger)).not.toContain("2026-09-03: spent");
  });

  it("says nothing about a fortnight when nothing happened in one", () => {
    const old = [row({ date: "2026-01-04" })];
    expect(build(old)).not.toContain("## The last fortnight, day by day");
  });

  it("still gives the months, which nothing here replaces", () => {
    expect(build(ledger)).toContain("## Every month in the ledger");
  });
});

describe("a request to see something reaches the part that draws", () => {
  /**
   * Every one of these went to a model that can only write sentences, and it
   * answered honestly that it could not draw. The app can.
   */
  it("treats a trend as something to draw", () => {
    expect(wantsChart("show me the trend of this year treats")).toBe(true);
    expect(wantsChart("what is the trend")).toBe(true);
    expect(wantsChart("my spending trends this year")).toBe(true);
  });

  it("treats 'over time' as something to draw", () => {
    expect(wantsChart("spending over time")).toBe(true);
  });

  it("still catches the plain words", () => {
    expect(wantsChart("chart my food")).toBe(true);
    expect(wantsChart("break down august")).toBe(true);
  });

  it("leaves an ordinary question alone", () => {
    expect(wantsChart("how much did I spend on food")).toBe(false);
    expect(wantsChart("what should I do about my debt")).toBe(false);
  });
});
