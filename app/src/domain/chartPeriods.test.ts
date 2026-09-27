/**
 * Charts over any period, grouped any way, and a pie that is a whole.
 *
 * The owner, 27 September 2026: "fix the charts, pie, trent any types, make
 * it work like day, month, week, year, custom". A bare year drew this
 * month, a range across two years drew this month, "since august 15" drew
 * one day, "q2 2025" drew this year's second quarter, and a month ended on
 * its 31st whatever its length. A pie of the months was drawn as slices, and
 * a pie left its smaller slices off, so it did not close. Invented ledger.
 */

import { describe, expect, it } from "vitest";

import { buildChart, isChartFollowUp, narrowsChart, windowOf } from "./charts";
import type { Transaction } from "./types";

const AS_OF = "2026-09-28";
const w = (q: string) => windowOf(q, AS_OF);

describe("the window, however it is said", () => {
  it.each([
    ["chart 2025", "2025-01-01", "2025-12-31", "2025"],
    ["spending in 2024", "2024-01-01", "2024-12-31", "2024"],
    ["dec 2025 to feb 2026", "2025-12-01", "2026-02-28", "December 2025 to February 2026"],
    ["march 2024 to june 2025", "2024-03-01", "2025-06-30", "March 2024 to June 2025"],
    ["2024 to 2025", "2024-01-01", "2025-12-31", "2024 to 2025"],
    ["since august 15", "2026-08-15", AS_OF, "Aug 15 to today"],
    ["q2 2025", "2025-04-01", "2025-06-30", "Q2 2025"],
    ["past 2 years", "2024-10-01", "2026-09-30", "October 2024 to September 2026"],
    ["this month", "2026-09-01", "2026-09-30", "September 2026"],
    ["from march to june", "2026-03-01", "2026-06-30", "March 2026 to June 2026"],
    ["february 2026", "2026-02-01", "2026-02-28", "February 2026"],
    ["march 2024", "2024-03-01", "2024-03-31", "March 2024"],
  ])("%s", (q, from, to, name) => {
    expect(w(q)).toEqual({ from, to, name });
  });
});

let n = 0;
const spend = (date: string, item: string, amount: number): Transaction => {
  n += 1;
  return {
    id: `t${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending",
    item, description: "", amount, fee: 0, total: amount, notes: "", status: "Paid",
  };
};

const ledger: Transaction[] = [
  spend("2024-03-05", "Food", 10000),
  spend("2025-06-10", "Gas", 20000),
  spend("2026-09-01", "Food", 30000),
  spend("2026-09-08", "Gas", 20000),
  spend("2026-09-15", "Treat", 5000),
  spend("2026-09-16", "School", 40000),
  spend("2026-09-17", "Load", 1000),
  spend("2026-09-18", "Parking", 2000),
  spend("2026-09-19", "Fun", 3000),
  spend("2026-09-20", "Health", 4000),
  spend("2026-09-21", "Travel", 6000),
];

describe("grouped by week and by year", () => {
  it("draws one point a week, named by its Monday", () => {
    const chart = buildChart("weekly spending", ledger, AS_OF)!;
    expect(chart.by).toBe("week");
    expect(chart.kind).toBe("line");
    expect(chart.rows.map((r) => r.label)).toEqual(["Week of Aug 31", "Week of Sep 7", "Week of Sep 14", "Week of Sep 21"]);
    expect(chart.total).toBe(30000 + 20000 + 5000 + 40000 + 1000 + 2000 + 3000 + 4000 + 6000);
  });

  it("draws one point a year across the whole ledger", () => {
    const chart = buildChart("spending by year", ledger, AS_OF)!;
    expect(chart.by).toBe("year");
    expect(chart.rows.map((r) => [r.label, r.value])).toEqual([
      ["2024", 10000],
      ["2025", 20000],
      ["2026", 111000],
    ]);
  });
});

describe("a pie is the whole", () => {
  it("folds what does not get a slice into Other, so the slices add up to the total", () => {
    const chart = buildChart("pie chart of spending this month", ledger, AS_OF)!;
    expect(chart.kind).toBe("pie");
    expect(chart.rows).toHaveLength(7);
    expect(chart.rows.at(-1)?.label).toBe("Other (3)");
    expect(chart.rows.reduce((s, r) => s + r.value, 0)).toBe(chart.total);
    expect(chart.othersCount).toBe(0);
  });
});

describe("following up a chart", () => {
  it("narrows to one thing with only or just", () => {
    expect(narrowsChart("gas only")).toBe(true);
    expect(narrowsChart("just food")).toBe(true);
    expect(narrowsChart("only treats")).toBe(true);
    expect(narrowsChart("I paid 200 for gas only")).toBe(false);
    expect(narrowsChart("gas")).toBe(false);
  });

  it("draws the item alone, over the window already shown", () => {
    const chart = buildChart("gas only Spending by item, September 2026", ledger, AS_OF)!;
    expect(chart.title).toBe("Gas by day, September 2026");
    expect(chart.total).toBe(20000);
  });

  it("takes a year, a week or a count of years as a new window for the chart on screen", () => {
    expect(isChartFollowUp("how about 2025", true)).toBe(true);
    expect(isChartFollowUp("weekly", true)).toBe(true);
    expect(isChartFollowUp("by year", true)).toBe(true);
    expect(isChartFollowUp("past 2 years", true)).toBe(true);
  });
});
