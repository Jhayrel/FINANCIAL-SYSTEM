/**
 * Every window, asked every way.
 *
 * The owner, 26 September 2026: "what if I ask today only, or this week, or
 * a range, all should work". Each case below is a way of naming a window
 * and the rows it must draw, on an invented ledger with one entry a day.
 * The totals are checked against the rows in the window, never against a
 * figure typed into the test.
 */

import { describe, expect, it } from "vitest";

import { buildChart } from "./charts";
import { costOf, incomeOf } from "./totals";
import type { Transaction } from "./types";

const AS_OF = "2026-09-26";

/** One spending row a day from 1 June to 26 September, PHP 100.00 plus the day of the month. */
const ledger: Transaction[] = [];
let n = 1;
for (let d = new Date("2026-06-01T00:00:00Z"); d.toISOString().slice(0, 10) <= AS_OF; d.setUTCDate(d.getUTCDate() + 1)) {
  const date = d.toISOString().slice(0, 10);
  const amount = 10_000 + d.getUTCDate() * 100;
  ledger.push({
    id: `t${n}`, recordNumber: n++, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending",
    item: n % 3 === 0 ? "Treat" : "Food", description: "", amount, fee: 0, total: amount, notes: "", status: "Paid",
  });
}
ledger.push({
  id: "income", recordNumber: n++, date: "2026-09-15", type: "Revenue", fromWallet: "", toWallet: "Gcash", category: "Revenue",
  item: "Allowance", description: "", amount: 1_200_000, fee: 0, total: 1_200_000, notes: "", status: "Received",
});

const spentBetween = (from: string, to: string): number =>
  ledger.filter((t) => t.date >= from && t.date <= to).reduce((sum, t) => sum + costOf(t), 0);

const CASES: [string, string, string, string][] = [
  // asked, from, to, what the title calls it
  ["chart my spending today", AS_OF, AS_OF, "today"],
  ["chart yesterday", "2026-09-25", "2026-09-25", "yesterday"],
  ["chart this week", "2026-09-20", AS_OF, "the last 7 days"],
  ["chart last week", "2026-09-13", "2026-09-19", "Sep 13 to Sep 19"],
  ["chart the last 10 days", "2026-09-17", AS_OF, "the last 10 days"],
  ["chart sep 1 to sep 15", "2026-09-01", "2026-09-15", "Sep 1 to Sep 15 2026"],
  ["chart september 5-12", "2026-09-05", "2026-09-12", "Sep 5 to Sep 12 2026"],
  ["chart aug 28 to sep 3", "2026-08-28", "2026-09-03", "Aug 28 to Sep 3 2026"],
  ["chart from the 1st to the 10th", "2026-09-01", "2026-09-10", "Sep 1 to Sep 10 2026"],
  ["chart 2026-07-01 to 2026-07-15", "2026-07-01", "2026-07-15", "Jul 1 to Jul 15 2026"],
  ["what did I spend on sept 20, chart it", "2026-09-20", "2026-09-20", "Sep 20"],
  ["chart since august", "2026-08-01", AS_OF, "Aug 1 to today"],
  ["chart this quarter", "2026-07-01", "2026-09-30", "Q3 2026"],
  ["chart last month", "2026-08-01", "2026-08-31", "August 2026"],
  ["chart this month", "2026-09-01", "2026-09-31", "September 2026"],
  ["chart june to august", "2026-06-01", "2026-08-31", "June 2026 to August 2026"],
];

describe("a chart over the window that was asked for", () => {
  for (const [asked, from, to, name] of CASES) {
    it(asked, () => {
      const chart = buildChart(asked, ledger, AS_OF);
      expect(chart, asked).not.toBeNull();
      expect(chart!.title.endsWith(name), `${asked}: ${chart!.title}`).toBe(true);
      expect(chart!.total, asked).toBe(spentBetween(from, to));
    });
  }

  it("draws last year as last year, and says there is nothing there", () => {
    expect(buildChart("chart last year", ledger, AS_OF)).toBeNull();
  });
});

describe("a trend over a short window is day by day", () => {
  it("draws this week's trend as a line of days", () => {
    const chart = buildChart("show my spending trend this week", ledger, AS_OF)!;
    expect(chart.by).toBe("day");
    expect(chart.kind).toBe("line");
    expect(chart.rows.map((r) => r.label)).toEqual(["Sep 20", "Sep 21", "Sep 22", "Sep 23", "Sep 24", "Sep 25", "Sep 26"]);
  });

  it("draws daily spending for a month when asked for daily", () => {
    const chart = buildChart("chart my daily spending in august", ledger, AS_OF)!;
    expect(chart.by).toBe("day");
    expect(chart.rows).toHaveLength(31);
    expect(chart.total).toBe(spentBetween("2026-08-01", "2026-08-31"));
  });

  it("shows a quiet day as zero, so a week with one spending day is still a week", () => {
    const sparse = ledger.filter((t) => t.date !== "2026-09-22" && t.date !== "2026-09-24");
    const chart = buildChart("show my spending trend this week", sparse, AS_OF)!;
    expect(chart.rows).toHaveLength(7);
    expect(chart.rows.find((r) => r.label === "Sep 22")).toMatchObject({ value: 0, count: 0 });
    expect(chart.total).toBe(chart.rows.reduce((s, r) => s + r.value, 0));
  });

  it("never draws days that have not happened yet", () => {
    const chart = buildChart("chart my daily spending this month", ledger, AS_OF)!;
    expect(chart.rows).toHaveLength(26);
    expect(chart.rows[chart.rows.length - 1]?.label).toBe("Sep 26");
  });

  it("keeps a trend over months as months", () => {
    const chart = buildChart("show my spending trend this year", ledger, AS_OF)!;
    expect(chart.by).toBe("month");
  });

  it("draws one item over a month day by day", () => {
    const chart = buildChart("chart treat this month", ledger, AS_OF)!;
    expect(chart.by).toBe("day");
    expect(chart.title.startsWith("Treat by day")).toBe(true);
  });
});

describe("money in or money out, as the caller decides", () => {
  it("draws income when told to, whatever the words", () => {
    const chart = buildChart("chart this month", ledger, AS_OF, "revenue")!;
    expect(chart.direction).toBe("revenue");
    expect(chart.total).toBe(ledger.filter((t) => t.date >= "2026-09-01").reduce((s, t) => s + incomeOf(t), 0));
  });
});

describe("a range typed with a phone's dash", () => {
  it("reads September 1 to 15 whatever dash joins them", () => {
    // Built from its code point, so this file names no dash character (W1).
    const dash = String.fromCharCode(0x2013);
    const chart = buildChart(`chart spending sep 1${dash}15`, ledger, AS_OF)!;
    expect(chart.total).toBe(spentBetween("2026-09-01", "2026-09-15"));
  });
});
