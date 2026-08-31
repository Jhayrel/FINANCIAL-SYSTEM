/**
 * The chart that answered a different question.
 *
 * Asked: "chart about treats this past 3 months".
 * Drawn: "Spending by item, August 2026", every item in the ledger.
 *
 * Both halves of the question were ignored. `dimensionOf` decides how to
 * group and `windowOf` decides when, and neither had any way to express
 * "only this item", nor any idea what "past 3 months" meant, so the period
 * fell through to the default: the current month.
 *
 * A chart is a claim about money. One that quietly answers a different
 * question is worse than no chart, because it looks like an answer.
 */

import { describe, expect, it } from "vitest";

import { buildChart } from "./charts";
import { totalsFor } from "./totals";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: "2026-08-10",
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
  };
};

const ASOF = "2026-08-29";

const ledger: Transaction[] = [
  // Treat, spread across the three months that "past 3 months" covers.
  row({ item: "Treat", date: "2026-06-04", amount: 50000, total: 50000 }),
  row({ item: "Treat", date: "2026-07-11", amount: 30000, total: 30000 }),
  row({ item: "Treat", date: "2026-08-02", amount: 20000, total: 20000 }),
  // Treat outside the window, which must not be counted.
  row({ item: "Treat", date: "2026-03-01", amount: 99900, total: 99900 }),
  // Other items inside it, which must not be counted either.
  row({ item: "Food", date: "2026-07-20", amount: 70000, total: 70000 }),
  row({ item: "Online Buy", date: "2026-08-05", amount: 88800, total: 88800 }),
];

describe("the question that was ignored", () => {
  const chart = buildChart("chart about treats this past 3 months", ledger, ASOF);

  it("draws something", () => {
    expect(chart).not.toBeNull();
  });

  /** Three months of Treat: 500 + 300 + 200. Nothing else. */
  it("counts only the item that was asked about", () => {
    expect(chart?.total).toBe(100000);
  });

  it("counts only the months that were asked about", () => {
    expect(chart?.rows.map((r) => r.label)).toEqual(["June 2026", "July 2026", "August 2026"]);
  });

  /**
   * One item by item is a single bar, which says nothing you did not type.
   * Across months it says whether it is growing, which is the question.
   */
  it("groups a single item over time", () => {
    expect(chart?.by).toBe("month");
  });

  /** A chart of one item headed "Spending" is a lie by omission. */
  it("says in the title what it left out", () => {
    expect(chart?.title).toContain("Treat");
    expect(chart?.title).toContain("June 2026 to August 2026");
  });
});

describe("the window on its own", () => {
  /**
   * With no item named this groups by item, so the window is checked by what
   * it adds up to: June, July and August is everything except the March row.
   *
   *   Treat 500 + 300 + 200, Food 700, Online Buy 888 = 2,588.00
   */
  it("counts back inclusively, so three months in August starts in June", () => {
    expect(buildChart("chart the past 3 months", ledger, ASOF)?.total).toBe(258800);
  });

  it("leaves out what falls before the window", () => {
    const chart = buildChart("chart the past 3 months", ledger, ASOF);
    // The March Treat is PHP 999.00 and must not be in it.
    expect(chart?.total).not.toBe(258800 + 99900);
  });

  it("takes one month as this month", () => {
    const chart = buildChart("chart the past 1 month", ledger, ASOF);
    expect(chart?.title).toContain("August 2026");
  });

  it("reads weeks as well", () => {
    const recent = [...ledger, row({ item: "Food", date: "2026-08-25", amount: 4400, total: 4400 })];
    const chart = buildChart("chart the last 2 weeks", recent, ASOF);
    expect(chart?.title).toContain("the last 2 weeks");
    // Only the row inside the fortnight: everything else is older.
    expect(chart?.total).toBe(4400);
  });

  it("still reads a named month, a year and everything", () => {
    expect(buildChart("chart July", ledger, ASOF)?.title).toContain("July 2026");
    expect(buildChart("chart this year", ledger, ASOF)?.title).toContain("2026");
    expect(buildChart("chart everything", ledger, ASOF)?.title).toContain("the whole ledger");
  });
});

describe("the item filter on its own", () => {
  it("matches a plural, because people pluralise", () => {
    expect(buildChart("chart treats this year", ledger, ASOF)?.title).toContain("Treat");
  });

  it("leaves an unfiltered chart unfiltered", () => {
    const chart = buildChart("chart this year", ledger, ASOF);
    expect(chart?.total).toBe(totalsFor(ledger).total);
  });

  /** A name nobody uses filters nothing rather than emptying the chart. */
  it("ignores a word that is not one of the owner's items", () => {
    const chart = buildChart("chart my scuba lessons this year", ledger, ASOF);
    expect(chart?.total).toBe(totalsFor(ledger).total);
  });

  it("returns nothing when the item has no rows in the window", () => {
    expect(buildChart("chart treats in January", ledger, ASOF)).toBeNull();
  });
});
