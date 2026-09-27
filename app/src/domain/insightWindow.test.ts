/**
 * Insights reads one window, whichever way it was chosen: a month, a whole
 * year, or any two dates (owner, 27 September 2026: "if I want to navigate
 * 2024 March", "see data of the year"). Every part of the screen adds up to
 * the same totals. Figures are invented.
 */

import { describe, expect, it } from "vitest";

import { rangeReport } from "./dayRange";
import {
  billsPaidIn,
  budgetByMonth,
  bucketFor,
  incomeBySource,
  kindsAgainst,
  monthsIn,
  periodWords,
  presetRanges,
  previousWindow,
  previousWords,
  trendOf,
  windowOf,
  windowWords,
} from "./insightWindow";
import type { Budgets, ReferenceLists, Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `r${n}`,
    recordNumber: n,
    date: "2024-03-10",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "",
    description: "",
    amount: 0,
    fee: 0,
    total: 0,
    notes: "",
    status: "",
    ...over,
  };
};

const spend = (date: string, item: string, total: number, category: Transaction["category"] = "Spending"): Transaction =>
  row({ date, item, amount: total, total, category });
const income = (date: string, item: string, total: number): Transaction =>
  row({ date, type: "Revenue", category: "Revenue", item, fromWallet: "", toWallet: "Cash", amount: total, total });

const rows: Transaction[] = [
  row({ date: "2024-01-01", type: "Revenue", category: "Opening", item: "Transfer of balance", fromWallet: "", toWallet: "Cash", amount: 50000, total: 50000 }),
  income("2024-02-01", "Allowance", 300000),
  spend("2024-02-14", "Food", 12000),
  spend("2024-02-28", "Gas", 20000),
  income("2024-03-01", "Allowance", 300000),
  income("2024-03-15", "Tutoring", 80000),
  spend("2024-03-02", "Food", 15000),
  spend("2024-03-05", "Gas", 25000),
  spend("2024-03-05", "Food", 5000),
  spend("2024-03-20", "Internet", 99900, "Bills"),
  spend("2024-03-21", "Music", 14900, "Subscriptions"),
  // A transfer to someone else is spending; one between your own pockets is only its fee.
  row({ date: "2024-03-22", type: "Transfer", fromWallet: "Cash", toWallet: "", item: "Sent to a friend", amount: 50000, fee: 1500, total: 51500 }),
  row({ date: "2024-03-23", type: "Transfer", fromWallet: "Cash", toWallet: "Bank", item: "Moved", amount: 100000, fee: 1500, total: 101500 }),
  spend("2024-04-02", "Food", 9000),
  spend("2024-04-20", "Internet", 99900, "Bills"),
  spend("2024-12-31", "Gas", 30000),
  spend("2025-01-01", "Gas", 40000),
];

const reference: ReferenceLists = {
  wallets: ["Cash"],
  savings: ["Bank"],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [],
};

const asOf = "2024-09-27";
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe("the window a period covers", () => {
  it("is a whole month, a whole year, or the two dates in order", () => {
    expect(windowOf({ kind: "month", year: 2024, month: 2 })).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(windowOf({ kind: "year", year: 2024 })).toEqual({ start: "2024-01-01", end: "2024-12-31" });
    expect(windowOf({ kind: "range", start: "2024-03-20", end: "2024-03-05" })).toEqual({ start: "2024-03-05", end: "2024-03-20" });
  });

  it("is named as a month or a year when it is one, however it was chosen", () => {
    expect(periodWords({ kind: "month", year: 2024, month: 3 })).toBe("March 2024");
    expect(periodWords({ kind: "year", year: 2024 })).toBe("2024");
    expect(windowWords({ start: "2024-03-01", end: "2024-03-31" })).toBe("March 2024");
    expect(windowWords({ start: "2024-01-01", end: "2024-12-31" })).toBe("2024");
    expect(windowWords({ start: "2024-02-01", end: "2024-04-30" })).toBe("February to April 2024");
    expect(windowWords({ start: "2023-11-01", end: "2024-02-29" })).toBe("November 2023 to February 2024");
    expect(windowWords({ start: "2024-03-05", end: "2024-03-20" })).toBe("March 5 to 20, 2024");
  });

  it("counts every month it touches, across a year end", () => {
    expect(monthsIn({ start: "2024-11-15", end: "2025-02-03" })).toEqual([
      { year: 2024, month: 11 },
      { year: 2024, month: 12 },
      { year: 2025, month: 1 },
      { year: 2025, month: 2 },
    ]);
  });
});

describe("the period before", () => {
  it("is the month before a month, the year before a year, and the same days before anything else", () => {
    expect(previousWindow({ start: "2024-03-01", end: "2024-03-31" })).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(previousWindow({ start: "2024-01-01", end: "2024-12-31" })).toEqual({ start: "2023-01-01", end: "2023-12-31" });
    expect(previousWindow({ start: "2024-03-05", end: "2024-03-18" })).toEqual({ start: "2024-02-20", end: "2024-03-04" });
    expect(previousWords({ start: "2024-03-01", end: "2024-03-31" })).toBe("February");
    expect(previousWords({ start: "2024-01-01", end: "2024-01-31" })).toBe("December 2023");
    expect(previousWords({ start: "2024-01-01", end: "2024-12-31" })).toBe("2023");
    expect(previousWords({ start: "2024-03-05", end: "2024-03-18" })).toBe("the 14 days before");
  });

  it("is the same days of the month before for a month so far, and the same part of last year for a year so far", () => {
    expect(previousWindow({ start: "2026-08-01", end: "2026-08-29" })).toEqual({ start: "2026-07-01", end: "2026-07-29" });
    expect(previousWords({ start: "2026-08-01", end: "2026-08-29" })).toBe("the same days of July");
    // March 30 so far against a February that has no 30th: all of February.
    expect(previousWindow({ start: "2024-03-01", end: "2024-03-30" })).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(previousWords({ start: "2026-01-01", end: "2026-01-15" })).toBe("the same days of December 2025");
    expect(previousWindow({ start: "2026-01-01", end: "2026-08-29" })).toEqual({ start: "2025-01-01", end: "2025-08-29" });
    expect(previousWords({ start: "2026-01-01", end: "2026-08-29" })).toBe("the same part of 2025");
    // A year so far that ends on a month's last day is still a year so far.
    expect(previousWindow({ start: "2026-01-01", end: "2026-08-31" })).toEqual({ start: "2025-01-01", end: "2025-08-31" });
    expect(previousWindow({ start: "2025-01-01", end: "2025-02-28" })).toEqual({ start: "2024-01-01", end: "2024-02-28" });
  });
});

describe("the trend", () => {
  it("is by day for a month, by week for a quarter, by month for a year", () => {
    expect(bucketFor({ start: "2024-03-01", end: "2024-03-31" })).toBe("day");
    expect(bucketFor({ start: "2024-02-01", end: "2024-04-30" })).toBe("week");
    expect(bucketFor({ start: "2024-01-01", end: "2024-12-31" })).toBe("month");
  });

  it("adds up to the window's own totals, whatever the buckets", () => {
    for (const w of [
      { start: "2024-03-01", end: "2024-03-31" },
      { start: "2024-02-10", end: "2024-04-25" },
      { start: "2024-01-01", end: "2024-12-31" },
      { start: "2023-12-15", end: "2025-01-10" },
    ]) {
      const points = trendOf(rows, w);
      const report = rangeReport({ transactions: rows, reference, debts: [], range: w, asOf });
      expect(sum(points.map((p) => p.spent))).toBe(report.spent);
      expect(sum(points.map((p) => p.cameIn))).toBe(report.cameIn);
    }
  });

  it("names each point in full for the reading and briefly for the axis", () => {
    const year = trendOf(rows, { start: "2024-01-01", end: "2024-12-31" });
    expect(year).toHaveLength(12);
    expect(year[2]).toMatchObject({ label: "Mar", title: "March 2024", start: "2024-03-01", end: "2024-03-31" });
    // March: food 150 + 50, gas 250, internet 999, music 149, sent 500 + 15 fee, own move 15 fee.
    expect(year[2]!.spent).toBe(15000 + 25000 + 5000 + 99900 + 14900 + 51500 + 1500);
    expect(year[2]!.cameIn).toBe(380000);
    // The opening balance is not income.
    expect(year[0]!.cameIn).toBe(0);

    const month = trendOf(rows, { start: "2024-03-01", end: "2024-03-31" });
    expect(month).toHaveLength(31);
    expect(month[4]).toMatchObject({ label: "5", title: "Tuesday, March 5, 2024", spent: 30000 });

    const weeks = trendOf(rows, { start: "2024-02-10", end: "2024-04-25" });
    // Clipped to the window: the first week starts on the tenth, not the Monday before.
    expect(weeks[0]!.start).toBe("2024-02-10");
    expect(weeks[weeks.length - 1]!.end).toBe("2024-04-25");
  });
});

describe("where it went and came from", () => {
  it("sets each kind beside the period before", () => {
    const march = kindsAgainst(rows, [], { start: "2024-03-01", end: "2024-03-31" });
    expect(march.find((k) => k.name === "Food")).toEqual({ name: "Food", amount: 20000, before: 12000 });
    expect(march.find((k) => k.name === "Money Send")).toEqual({ name: "Money Send", amount: 51500, before: 0 });
    expect(march.find((k) => k.name === "Transaction Fee")).toEqual({ name: "Transaction Fee", amount: 1500, before: 0 });
  });

  it("lists income by source with the opening balance left out", () => {
    expect(incomeBySource(rows, { start: "2024-01-01", end: "2024-12-31" })).toEqual([
      { name: "Allowance", amount: 600000 },
      { name: "Tutoring", amount: 80000 },
    ]);
  });
});

describe("budget and bills over the window", () => {
  const budgets = {
    "2024": { spending: [0, 50000, 60000, 0, 0, 0, 0, 0, 0, 0, 0, 0], billsSubs: [0, 0, 110000, 100000, 0, 0, 0, 0, 0, 0, 0, 0] },
  } as unknown as Budgets;

  it("gives each month touched its whole budget", () => {
    const months = budgetByMonth(rows, budgets, { start: "2024-02-15", end: "2024-04-10" });
    expect(months.map((m) => [m.month, m.budget])).toEqual([
      [2, 50000],
      [3, 170000],
      [4, 100000],
    ]);
    expect(months[1]!.spent).toBeGreaterThan(0);
  });

  it("counts bills and subscriptions paid, by name", () => {
    expect(billsPaidIn(rows, { start: "2024-01-01", end: "2024-12-31" })).toEqual([
      { item: "Internet", category: "Bills", times: 2, total: 199800, last: "2024-04-20" },
      { item: "Music", category: "Subscriptions", times: 1, total: 14900, last: "2024-03-21" },
    ]);
  });
});

describe("ranges said in words", () => {
  it("count back from today, and last year is the whole of it", () => {
    const presets = Object.fromEntries(presetRanges("2026-08-29").map((p) => [p.id, p.range]));
    expect(presets["7d"]).toEqual({ start: "2026-08-23", end: "2026-08-29" });
    expect(presets["30d"]).toEqual({ start: "2026-07-31", end: "2026-08-29" });
    expect(presets["ytd"]).toEqual({ start: "2026-01-01", end: "2026-08-29" });
    expect(presets["ly"]).toEqual({ start: "2025-01-01", end: "2025-12-31" });
    expect(presets["12m"]).toEqual({ start: "2025-08-30", end: "2026-08-29" });
  });
});
