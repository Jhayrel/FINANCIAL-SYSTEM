import { describe, expect, it } from "vitest";

import { buildChart, isChartFollowUp } from "./charts";
import type { Transaction } from "./types";

/**
 * A short message after a chart: the same chart over another window, or a
 * question of its own. 28 September 2026, "so since starting I didnt have
 * good budgeting?" was drawn as September's chart, because "since starting"
 * read as a period and "didnt" was not "did".
 */
describe("a follow-up to the chart on screen", () => {
  it.each([
    ["since march", true],
    ["since aug", true],
    ["since 2025", true],
    ["since last month", true],
    ["2025", true],
    ["even 2022?", true],
    ["how about this month?", true],
    ["this week", true],
    ["by month", true],
    ["by wallets", true],
    ["per category", true],
    ["month by month", true],
    ["so since starting I didnt have good budgeting?", false],
    ["is 2022 bad?", false],
    ["2022 was good", false],
  ] as const)("%s", (said, follows) => {
    expect(isChartFollowUp(said, true)).toBe(follows);
  });
});

describe("charts that were one point", () => {
  const rows: Transaction[] = [];
  let n = 0;
  for (const month of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) {
    for (const [type, item] of [["Spending", "Food"], ["Revenue", "Allowance"]] as const) {
      n += 1;
      rows.push({
        id: `c-${n}`, recordNumber: n, date: `2026-${month}-10`, type, category: type === "Spending" ? "Spending" : "Revenue",
        fromWallet: type === "Spending" ? "Cash" : "", toWallet: type === "Revenue" ? "Cash" : "", item, description: "",
        amount: 100_000, fee: 0, total: 100_000, notes: "", status: type === "Spending" ? "Paid" : "Received",
      });
    }
  }

  // "spending only" after "by year" carried March to today, and drew one point (28 September 2026).
  it("draws the months of a year asked for year by year", () => {
    const chart = buildChart("spending by year from march 2026 to today", rows, "2026-09-28");
    expect(chart?.by).toBe("month");
    expect(chart?.rows.length).toBe(7);
  });

  // "compare income vs spending this year" drew each by item (28 September 2026).
  it("puts income against spending month against month", () => {
    const income = buildChart("compare income vs spending this year", rows, "2026-09-28", "revenue");
    const spending = buildChart("compare income vs spending this year", rows, "2026-09-28", "spending");
    expect(income?.by).toBe("month");
    expect(spending?.by).toBe("month");
    expect(income?.rows.length).toBe(spending?.rows.length);
  });
});
