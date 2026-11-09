/**
 * Two or more kinds named in one chart question (heavy test, 9 November
 * 2026): "pie chart of food and gas this month" drew Food alone, and on the
 * owner's data said there was nothing to draw. Invented rows.
 */
import { describe, expect, it } from "vitest";

import { buildChart } from "./charts";
import type { Transaction } from "./types";

let n = 0;
const r = (date: string, item: string, amount: number): Transaction =>
  ({ id: `t${(n += 1)}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description: "", amount, fee: 0, total: amount, notes: "", status: "Paid" }) as Transaction;
const rows = [r("2026-11-02", "Food", 100_000), { ...r("2026-11-03", "Gas", 30_000), description: "Gas purchase" }, r("2026-11-05", "Food", 50_000), r("2026-11-06", "Treat", 20_000), r("2026-11-06", "Self Care", 9_000), r("2026-10-04", "Gas", 40_000)];
const asOf = "2026-11-09";

describe("several kinds in one chart", () => {
  it.each([
    ["pie chart of food and gas this month", "pie"],
    ["chart food and gas this month", "bars"],
    ["food vs gas this month", "bars"],
    ["compare food and gas this month", "bars"],
  ])("%s: those kinds only, one each", (q, kind) => {
    const c = buildChart(q, rows, asOf)!;
    expect(c.kind).toBe(kind);
    expect(c.title).toBe("Food and Gas by item, November 2026");
    expect(c.rows.map((x) => [x.label, x.value])).toEqual([["Food", 150_000], ["Gas", 30_000]]);
    expect(c.total).toBe(180_000);
  });

  it("a two-word kind is one kind, not two", () => {
    const c = buildChart("gas and self care this month", rows, asOf)!;
    expect(c.rows.map((x) => x.label)).toEqual(["Gas", "Self Care"]);
  });

  it("asked over time, the named kinds together by month", () => {
    const c = buildChart("food and gas by month this year", rows, asOf)!;
    expect(c.by).toBe("month");
    expect(c.title.startsWith("Food and Gas by month")).toBe(true);
    expect(c.rows.find((x) => x.label.includes("Oct"))?.value).toBe(40_000);
  });

  it("one kind still draws over time, as before", () => {
    expect(buildChart("pie chart of food this month", rows, asOf)!.title).toBe("Food by week, November 2026");
  });
});
