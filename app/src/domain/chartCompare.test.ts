/**
 * Two periods side by side. 3 October 2026, the owner asked "Show me my
 * spending this month compared to last month" and was shown September
 * alone, by item. Rows are invented.
 */
import { describe, expect, it } from "vitest";

import { buildChart, chartInWords, comparedPeriods, periodsSaid } from "./charts";
import { twoPeriods } from "../data/aiClient";
import type { Transaction } from "./types";

let n = 0;
const row = (date: string, item: string, amount: number, over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `c-${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending",
    item, description: "", amount, fee: 0, total: amount, notes: "", status: "Paid", ...over,
  };
};

const ASOF = "2026-10-03";
const ledger: Transaction[] = [
  row("2026-10-01", "Food", 30_000),
  row("2026-10-02", "Travel", 5_000),
  row("2026-10-03", "Food", 12_000, { fromWallet: "Wallet A" }),
  row("2026-09-02", "Food", 20_000),
  row("2026-09-03", "Fun", 50_000),
  // After the 3rd of September: not the same days, so not compared.
  row("2026-09-20", "Food", 900_000),
  row("2026-08-15", "Food", 70_000),
];

describe("this month compared to last month", () => {
  it("is both periods, the same days of each", () => {
    expect(comparedPeriods("Show me my spending this month compared to last month", ASOF)).toEqual({
      now: { from: "2026-10-01", to: "2026-10-03", name: "October 2026 so far, the 1st to the 3rd" },
      before: { from: "2026-09-01", to: "2026-09-03", name: "the same days of September 2026" },
    });
  });

  it("draws each item's now beside its then", () => {
    const chart = buildChart("Show me my spending this month compared to last month", ledger, ASOF);
    expect(chart?.title).toBe("Spending by item, October 2026 so far, the 1st to the 3rd, against the same days of September 2026");
    expect(chart?.rows.map((r) => [r.label, r.value, r.previous])).toEqual([
      ["Fun", 0, 50_000],
      ["Food", 42_000, 20_000],
      ["Travel", 5_000, 0],
    ]);
    expect(chart?.total).toBe(47_000);
    expect(chart?.against?.total).toBe(70_000);
    // One scale for both bars, so the lengths can be read against each other.
    expect(chart?.rows[0]?.previousShare).toBe(1);
    expect(chart?.rows[1]?.share).toBeCloseTo(42_000 / 50_000);
  });

  it("says each row's earlier figure in words", () => {
    const chart = buildChart("spending this month vs last month", ledger, ASOF);
    expect(chart && chartInWords(chart)).toBe(
      "Fun PHP 0.00 (was PHP 500.00), Food PHP 420.00 (was PHP 200.00), Travel PHP 50.00 (was PHP 0.00). Total PHP 470.00, against PHP 700.00 for the same days of September 2026.",
    );
  });

  it("is read however it is put", () => {
    for (const said of [
      "how much more did I spend this month than last month, chart it",
      "chart my spending this month versus the previous month",
      "draw how my spending changed from last month",
      "show my spending this month against last month",
    ]) {
      expect(buildChart(said, ledger, ASOF)?.against, said).toBeDefined();
    }
  });

  it("is never a period said alone", () => {
    for (const said of ["chart my spending from last month", "show me last month", "chart my spending over last month"]) {
      expect(buildChart(said, ledger, ASOF)?.against, said).toBeUndefined();
    }
  });

  it("narrows to one item or wallet when one is named", () => {
    const food = buildChart("chart food this month compared to last month", ledger, ASOF);
    expect(food?.rows.map((r) => [r.label, r.value, r.previous])).toEqual([["Food", 42_000, 20_000]]);
    expect(food?.title.startsWith("Spending on Food by item")).toBe(true);
    const wallet = buildChart("chart wallet a spending this month compared to last month", ledger, ASOF);
    expect(wallet?.rows.map((r) => [r.label, r.value, r.previous])).toEqual([["Food", 12_000, 0]]);
  });

  it("groups by wallet when asked", () => {
    const chart = buildChart("spending by wallet this month compared to last month", ledger, ASOF);
    expect(chart?.by).toBe("wallet");
    expect(chart?.rows.map((r) => r.label).sort()).toEqual(["Cash", "Wallet A"]);
  });

  it("leaves two named months to the month bars it always drew", () => {
    const chart = buildChart("compare september vs august spending", ledger, ASOF);
    expect(chart?.by).toBe("month");
    expect(chart?.against).toBeUndefined();
  });
});

describe("two periods the assistant read out of the message", () => {
  it("are the same days of each when one is this and the other last", () => {
    expect(periodsSaid("this month", "last month", ASOF)?.before.to).toBe("2026-09-03");
    expect(periodsSaid("now", "the month before", ASOF)?.before.to).toBe("2026-09-03");
    expect(periodsSaid("this week", "last week", ASOF)).toMatchObject({ now: { from: "2026-09-28", to: ASOF }, before: { from: "2026-09-21", to: "2026-09-26" } });
  });

  it("are whole windows when named", () => {
    expect(periodsSaid("september", "august", ASOF)).toMatchObject({
      now: { from: "2026-09-01", to: "2026-09-30" },
      before: { from: "2026-08-01", to: "2026-08-31" },
    });
  });

  it("are nothing when either names no period, or both name one", () => {
    expect(periodsSaid("food", "last month", ASOF)).toBeNull();
    expect(periodsSaid("september", "september", ASOF)).toBeNull();
  });

  it("are drawn even when the words have no comparison in them", () => {
    const pair = periodsSaid("this month", "last month", ASOF);
    const chart = buildChart("how did I do with spending lately, draw it", ledger, ASOF, undefined, pair);
    expect(chart?.against?.name).toBe("the same days of September 2026");
    expect(chart?.against?.total).toBe(70_000);
  });
});

describe("the assistant's reading of the two periods", () => {
  it("is two halves, or nothing", () => {
    expect(twoPeriods("this month|last month")).toEqual(["this month", "last month"]);
    expect(twoPeriods(" september | august ")).toEqual(["september", "august"]);
    for (const said of ["", "this month", "a|b|c", "may|May", 3, null]) expect(twoPeriods(said)).toEqual([]);
  });
});
