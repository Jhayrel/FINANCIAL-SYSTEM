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

describe("asking for income and being shown spending", () => {
  /**
   * "chart my income this year" drew "Spending by item", and so did "chart
   * my revenue per month" and "show me earnings by month". Every chart in
   * this file counted spending, because nothing ever asked which direction
   * was wanted. The answer was not imprecise, it was the other one.
   */
  const both: Transaction[] = [
    row({ item: "Food", date: "2026-07-02", amount: 30000, total: 30000 }),
    row({
      type: "Revenue",
      category: "Revenue",
      item: "Framelink",
      fromWallet: "",
      toWallet: "Maya",
      date: "2026-07-05",
      amount: 500000,
      total: 500000,
      status: "Received",
    }),
    row({
      type: "Revenue",
      category: "Revenue",
      item: "Allowance",
      fromWallet: "",
      toWallet: "Gcash",
      date: "2026-08-05",
      amount: 200000,
      total: 200000,
      status: "Received",
    }),
  ];

  it("counts money in when money in was asked for", () => {
    const chart = buildChart("chart my income this year", both, ASOF);
    expect(chart?.total).toBe(700000);
    expect(chart?.title).toContain("Income");
  });

  it("reads the other words for it", () => {
    for (const q of [
      "chart my revenue per month",
      "show me earnings by month",
      "graph what I received this year",
      "chart my salary this year",
    ]) {
      expect(buildChart(q, both, ASOF)?.title, q).toContain("Income");
    }
  });

  it("leaves spending as the default", () => {
    const chart = buildChart("chart this year", both, ASOF);
    expect(chart?.title).toContain("Spending");
    expect(chart?.total).toBe(30000);
  });

  /**
   * An opening balance is money you already had on the day you started
   * counting. `totalsFor` excludes it and so must this: the Excel had no
   * such category and booked PHP 953.89 of carried balance as 2026 earnings.
   */
  it("leaves an opening balance out of income, as the app does", () => {
    const withOpening: Transaction[] = [
      ...both,
      row({
        type: "Revenue",
        category: "Opening",
        item: "Opening balance",
        fromWallet: "",
        toWallet: "Cash",
        date: "2026-01-01",
        amount: 95389,
        total: 95389,
      }),
    ];
    expect(buildChart("chart my income this year", withOpening, ASOF)?.total).toBe(700000);
  });
});

describe("the short periods, which all drew the whole month", () => {
  const spread: Transaction[] = [
    row({ item: "Food", date: "2026-07-15", amount: 70000, total: 70000 }),
    row({ item: "Food", date: "2026-08-02", amount: 20000, total: 20000 }),
    row({ item: "Gas", date: "2026-08-28", amount: 30000, total: 30000 }),
  ];

  /** Off by a whole month, and the answer looked entirely reasonable. */
  it("reads last month as the month before this one", () => {
    const chart = buildChart("chart last month", spread, ASOF);
    expect(chart?.title).toContain("July 2026");
    expect(chart?.total).toBe(70000);
  });

  it("still reads this month as this month", () => {
    expect(buildChart("chart this month", spread, ASOF)?.total).toBe(50000);
  });

  it("reads yesterday as one day", () => {
    const chart = buildChart("chart yesterday", spread, ASOF);
    expect(chart?.title).toContain("yesterday");
    expect(chart?.total).toBe(30000);
  });

  it("reads a week as the last seven days", () => {
    const chart = buildChart("chart this week", spread, ASOF);
    expect(chart?.title).toContain("the last 7 days");
    expect(chart?.total).toBe(30000);
  });
});

describe("naming one account", () => {
  /**
   * "chart my maya spending this year" drew all three wallets, with the whole
   * year's total under them. A bare account name made `dimensionOf` group by
   * wallet, and grouping by the thing you just narrowed to is the same
   * mistake a single item had: one bar labelled with the word you typed.
   *
   * The account names were also hardcoded, so "chart my reserved fund"
   * matched nothing at all.
   */
  const spread: Transaction[] = [
    row({ item: "Food", fromWallet: "Maya", date: "2026-07-02", amount: 30000, total: 30000 }),
    row({ item: "Gas", fromWallet: "Gcash", date: "2026-07-09", amount: 20000, total: 20000 }),
    row({ item: "Food", fromWallet: "Cash", date: "2026-08-04", amount: 10000, total: 10000 }),
    row({
      type: "Transfer",
      category: "Transfer",
      item: "",
      fromWallet: "Maya",
      toWallet: "Cash",
      date: "2026-08-06",
      amount: 100000,
      fee: 1800,
      total: 101800,
    }),
  ];

  it("filters to the account instead of grouping by it", () => {
    const chart = buildChart("chart my maya spending this year", spread, ASOF);
    expect(chart?.title).toContain("from Maya");
    // Food 300 plus the transfer's PHP 18.00 fee. Nothing from Gcash or Cash.
    expect(chart?.total).toBe(31800);
  });

  it("does not group by the thing it just narrowed to", () => {
    expect(buildChart("chart my maya spending this year", spread, ASOF)?.by).toBe("item");
  });

  /**
   * The partition property, which is what makes these figures trustworthy.
   *
   * Matching either side was tried first and double-counted: a transfer fee
   * is borne by the account the money left, so charting two wallets
   * separately added the same fee to both. Attributed to one side, the
   * per-wallet charts add up to the whole.
   */
  it("splits the total between accounts without overlap", () => {
    const each = ["Maya", "Gcash", "Cash"].map(
      (w) => buildChart(`chart my ${w} spending this year`, spread, ASOF)?.total ?? 0,
    );
    expect(each.reduce((a, b) => a + b, 0)).toBe(
      buildChart("chart this year", spread, ASOF)?.total,
    );
  });

  it("still groups by wallet when that is what was asked", () => {
    expect(buildChart("chart by wallet this year", spread, ASOF)?.by).toBe("wallet");
  });

  /** Read from the ledger, so an account added later needs no code change. */
  it("recognises an account this file never heard of", () => {
    const odd = [...spread, row({ fromWallet: "Reserved Fund", date: "2026-08-08", amount: 5000, total: 5000 })];
    expect(buildChart("chart my reserved fund this year", odd, ASOF)?.total).toBe(5000);
  });

  /**
   * Income lands in `toWallet`, and grouping by wallet read the source, so
   * every income row fell under "(none)": a Revenue row has no source.
   */
  it("groups income by the account it landed in", () => {
    const earned: Transaction[] = [
      row({
        type: "Revenue",
        category: "Revenue",
        item: "Framelink",
        fromWallet: "",
        toWallet: "Maya",
        amount: 500000,
        total: 500000,
        status: "Received",
      }),
    ];
    const chart = buildChart("chart my income by wallet this year", earned, ASOF);
    expect(chart?.rows.map((r) => r.label)).toEqual(["Maya"]);
    expect(chart?.rows.map((r) => r.label)).not.toContain("(none)");
  });
});
