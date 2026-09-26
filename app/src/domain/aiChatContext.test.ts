/**
 * What the assistant is given to answer with.
 *
 * These assert the presence of the facts whose absence produced the useless
 * transcripts: a count, a per-month breakdown, a per-category breakdown, and
 * the rows themselves. Each one is quoted in the file it tests.
 */

import { describe, expect, it } from "vitest";

import { buildChatContext, monthsNamedIn } from "./aiChatContext";
import { buildContext } from "./aiContext";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash"],
  savings: [],
  bills: ["Electricity"],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "School", remark: "" }],
};

const row = (over: Partial<Transaction>): Transaction => ({
  id: `t-${over.recordNumber ?? 1}`,
  recordNumber: over.recordNumber ?? 1,
  date: "2026-08-01",
  type: "Spending",
  fromWallet: "Cash",
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
});

const ledger: Transaction[] = [
  row({ recordNumber: 1, date: "2026-05-02", item: "School", amount: 500000, total: 500000 }),
  row({ recordNumber: 2, date: "2026-05-14", item: "Food", amount: 20000, total: 20000 }),
  row({ recordNumber: 3, date: "2026-05-20", item: "Food", amount: 30000, total: 30000 }),
  row({ recordNumber: 4, date: "2026-08-03", item: "Food", amount: 15000, total: 15000, description: "lunch at mcdo" }),
  row({
    recordNumber: 5,
    date: "2026-08-05",
    type: "Revenue",
    category: "Revenue",
    fromWallet: "",
    toWallet: "Gcash",
    item: "Allowance",
    amount: 100000,
    total: 100000,
    status: "Received",
  }),
];

const budgets: Budgets = {};

const build = (question: string, over: { transactions?: Transaction[]; maxRowBytes?: number } = {}) => {
  const transactions = over.transactions ?? ledger;
  const snapshot = buildContext({
    transactions,
    accounts: [],
    budgets,
    credits: [],
    reference,
    lowBalanceThreshold: 0,
    asOf: "2026-08-31",
  });
  return buildChatContext({
    snapshot,
    transactions,
    asOf: "2026-08-31",
    question,
    ...(over.maxRowBytes === undefined ? {} : { maxRowBytes: over.maxRowBytes }),
  });
};

describe("the facts whose absence made the answers useless", () => {
  it('carries a count, so "how many times did I spend" is answerable', () => {
    const { text } = build("how many times did I spend");
    expect(text).toContain("5 entries");
    expect(text).toMatch(/\d+ entries/);
  });

  it('carries every month, so "month by month" is answerable', () => {
    const { text } = build("compare the months");
    expect(text).toContain("## Every month in the ledger");
    expect(text).toContain("May 2026");
    expect(text).toContain("August 2026");
  });

  it('carries a category breakdown for a month the question names', () => {
    const { text } = build("what happened in May");
    expect(text).toContain("May 2026, spending by item");
    expect(text).toContain("May 2026, spending by category");
  });

  it("carries the current month's breakdown even when nothing is named", () => {
    const { text } = build("how is it going");
    expect(text).toContain("August 2026, spending by item");
  });

  it("carries the rows themselves, with dates and items", () => {
    const { text } = build("list my food spending");
    expect(text).toContain("## Entries");
    expect(text).toContain("2026-08-03");
    expect(text).toContain("lunch at mcdo");
    expect(text).toContain("#4");
  });
});

describe("the totals are worked out here, not by the model", () => {
  it("adds up a month exactly, in centavos", () => {
    const { text } = build("may");
    // 5,000.00 school + 200.00 + 300.00 food
    expect(text).toContain("spent PHP 5,500.00");
  });

  it("ranks items by what was actually spent on them", () => {
    const { text } = build("may");
    const may = text.slice(text.indexOf("May 2026, spending by item"));
    expect(may.indexOf("School")).toBeLessThan(may.indexOf("Food"));
  });

  it("counts a transfer between the owner's own wallets as its fee only", () => {
    const transactions = [
      row({
        recordNumber: 9,
        date: "2026-08-10",
        type: "Transfer",
        category: "Transfer",
        fromWallet: "Cash",
        toWallet: "Gcash",
        item: "",
        amount: 100000,
        fee: 1500,
        total: 101500,
        status: "Transferred",
      }),
    ];
    const { text } = build("august", { transactions });
    // The fee, not the thousand pesos that never left.
    expect(text).toContain("spent PHP 15.00");
  });
});

describe("bounds and privacy", () => {
  it("says when it sent everything", () => {
    const built = build("anything");
    expect(built.rowsIncluded).toBe(built.rowsTotal);
    expect(built.text).toContain("All of them");
  });

  it("stays inside the budget and says how many it left out", () => {
    const built = build("anything", { maxRowBytes: 120 });
    expect(built.rowsIncluded).toBeLessThan(built.rowsTotal);
    expect(built.text).toContain(`${built.rowsIncluded} of ${built.rowsTotal}`);
  });

  it("keeps the months the question named when the budget is tight", () => {
    const built = build("what happened in May", { maxRowBytes: 90 });
    expect(built.text.slice(built.text.indexOf("## Entries"))).toContain("2026-05");
  });

  it("never sends the notes field", () => {
    const transactions = [row({ recordNumber: 7, notes: "paid Tita back for the hospital bill" })];
    const { text } = build("anything", { transactions });
    expect(text).not.toContain("hospital");
  });

  it("redacts a key that ended up in a description", () => {
    const transactions = [row({ recordNumber: 8, description: "key sk-abcdefghijklmnop1234" })];
    const { text } = build("anything", { transactions });
    expect(text).not.toContain("sk-abcdefghijklmnop1234");
    expect(text).toContain("[redacted]");
  });
});

describe("monthsNamedIn", () => {
  it("finds one month, and both of a comparison", () => {
    expect(monthsNamedIn("what happened in May", "2026")).toEqual(["2026-05"]);
    expect(monthsNamedIn("why did spending go up from april to may", "2026")).toEqual([
      "2026-04",
      "2026-05",
    ]);
  });

  it("uses a year named in the question", () => {
    expect(monthsNamedIn("March 2025", "2026")).toEqual(["2025-03"]);
  });

  it("finds nothing in a question that names no month", () => {
    expect(monthsNamedIn("how is this month going", "2026")).toEqual([]);
    // "may" the verb is a real risk, and a real miss is better than a wrong
    // breakdown, so this is documented rather than defended against.
    expect(monthsNamedIn("what is my balance", "2026")).toEqual([]);
  });
});

/**
 * The reasoning the owner asked for (26 September 2026, "Improving your
 * system's AI"): every magnitude word needs a baseline the app worked out,
 * a recommendation needs the app's forecast, and a total needs the rows
 * that produced it. None of those were sent, so the model either refused
 * ("no budget amount for the upcoming period is present in the data") or
 * made a figure up from one month.
 */
describe("what the model is given to reason with", () => {
  const months: Transaction[] = [];
  let n = 100;
  for (const [month, food, treat] of [
    ["05", 200000, 50000],
    ["06", 220000, 60000],
    ["07", 210000, 40000],
    ["08", 230000, 900000],
  ] as const) {
    months.push(row({ recordNumber: n++, date: `2026-${month}-10`, item: "Food", amount: food, total: food }));
    months.push(row({ recordNumber: n++, date: `2026-${month}-12`, item: "Treat", amount: treat, total: treat, description: `treat in ${month}` }));
  }
  const text = build("what budget should I set next month?", { transactions: months }).text;

  it("sends next month's forecast, with a budget that covers it", () => {
    expect(text).toContain("## September 2026, forecast by the app");
    expect(text).toMatch(/A budget that covers this forecast: PHP [\d,]+\.\d\d for spending/);
    expect(text).toMatch(/likely between PHP [\d,]+\.\d\d and PHP [\d,]+\.\d\d/);
  });

  it("sends each item this month against its own last three months", () => {
    expect(text).toContain("## August 2026 so far, each item against its last three months");
    expect(text).toContain("Treat: PHP 9,000.00 now. July 2026 PHP 400.00, June 2026 PHP 600.00, May 2026 PHP 500.00, an average of PHP 500.00 a month.");
  });

  it("names the entries that produced the month", () => {
    expect(text).toContain("## August 2026, the largest single entries");
    expect(text).toMatch(/#0107 2026-08-12 Treat: PHP 9,000\.00, "treat in 08"/);
  });

  it("says an item is new rather than comparing it with nothing", () => {
    const fresh = build("", { transactions: [...months, row({ recordNumber: 200, date: "2026-08-20", item: "School", amount: 300000, total: 300000 })] }).text;
    expect(fresh).toMatch(/School: PHP 3,000\.00 now\..*New this month\./);
  });
});

describe("any window, and what if", () => {
  const days: Transaction[] = [];
  for (let d = 1; d <= 30; d += 1) {
    days.push(row({ recordNumber: 300 + d, date: `2026-08-${String(d).padStart(2, "0")}`, item: d % 2 ? "Food" : "Treat", amount: 10_000, total: 10_000 }));
  }

  it("works out a range of days the question names", () => {
    const text = build("how much did I spend from aug 1 to aug 10?", { transactions: days }).text;
    expect(text).toContain("## The window asked about: Aug 1 to Aug 10 2026 (2026-08-01 to 2026-08-10)");
    expect(text).toContain("Spent PHP 1,000.00, received PHP 0.00, 10 entries.");
  });

  it("works out a count of days", () => {
    const text = build("what did I spend in the last 5 days", { transactions: days }).text;
    expect(text).toContain("## The window asked about: the last 5 days");
  });

  it("says what is left after a purchase that has not happened", () => {
    const text = build("what if I buy a 25k phone?", { transactions: days }).text;
    expect(text).toContain("## What if PHP 25,000.00 is spent now");
    expect(text).toMatch(/Net worth after debt: PHP [\d,.-]+ before, PHP [\d,.-]+ after\./);
  });

  it("adds nothing for a question that is not a what if", () => {
    expect(build("how is this month going", { transactions: days }).text).not.toContain("## What if");
  });
});
