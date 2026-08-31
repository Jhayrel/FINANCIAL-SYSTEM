import { describe, expect, it } from "vitest";

import { buildChart, chartLabel, isChartFollowUp, wantsChart, wantsReport } from "./charts";
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
  row({ item: "Food", amount: 50000, total: 50000 }),
  row({ item: "Food", amount: 30000, total: 30000 }),
  row({ item: "Gas", amount: 20000, total: 20000, fromWallet: "Gcash" }),
  row({ item: "School", amount: 100000, total: 100000, category: "Bills" }),
  row({ date: "2026-05-04", item: "Food", amount: 70000, total: 70000 }),
];

describe("wantsChart and wantsReport", () => {
  it("knows when you asked to see something", () => {
    for (const q of ["show me a chart", "pie of this month", "graph my spending", "breakdown"]) {
      expect(wantsChart(q), q).toBe(true);
    }
  });

  it("knows when you asked to be told instead", () => {
    expect(wantsReport("give me a report")).toBe(true);
    expect(wantsReport("summarise the month")).toBe(true);
    // Asking to see it wins: a chart is what was asked for.
    expect(wantsReport("chart summary")).toBe(false);
  });

  it("leaves an ordinary question alone", () => {
    expect(wantsChart("how much did I spend on food")).toBe(false);
    expect(wantsReport("I spent 100 on food")).toBe(false);
  });
});

describe("buildChart", () => {
  it("groups this month by item, largest first, in centavos", () => {
    const chart = buildChart("show me a chart", ledger, ASOF);
    expect(chart?.by).toBe("item");
    expect(chart?.title).toContain("August 2026");
    expect(chart?.rows.map((r) => r.label)).toEqual(["School", "Food", "Gas"]);
    expect(chart?.rows[0]?.value).toBe(100000);
    // 500 + 300 food, 200 gas, 1000 school
    expect(chart?.total).toBe(200000);
  });

  it("counts how many rows made each bar", () => {
    const chart = buildChart("chart", ledger, ASOF);
    expect(chart?.rows.find((r) => r.label === "Food")?.count).toBe(2);
  });

  it("scales the bars against the largest, not the total", () => {
    const chart = buildChart("chart", ledger, ASOF);
    expect(chart?.rows[0]?.share).toBe(1);
    expect(chart?.rows[1]?.share).toBeCloseTo(0.8, 5);
  });

  it("reads months in order, not by size", () => {
    const chart = buildChart("chart my spending per month", ledger, ASOF);
    expect(chart?.by).toBe("month");
    expect(chart?.rows.map((r) => r.label)).toEqual(["May 2026", "August 2026"]);
  });

  it("groups by wallet when asked", () => {
    const chart = buildChart("chart by wallet", ledger, ASOF);
    expect(chart?.by).toBe("wallet");
    expect(chart?.rows.map((r) => r.label).sort()).toEqual(["Cash", "Gcash"]);
  });

  it("takes a month named in the question", () => {
    const chart = buildChart("show me May", ledger, ASOF);
    expect(chart?.title).toContain("May 2026");
    expect(chart?.total).toBe(70000);
  });

  it("takes the year when asked for it", () => {
    expect(buildChart("chart this year", ledger, ASOF)?.total).toBe(270000);
  });

  /** A picture of nothing says nothing while looking like it says something. */
  it("returns nothing when the window is empty", () => {
    expect(buildChart("chart January", ledger, ASOF)).toBeNull();
    expect(buildChart("chart", [], ASOF)).toBeNull();
  });

  it("keeps a chart short, and says how many it left out", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row({ item: `Thing ${i}`, amount: (i + 1) * 1000, total: (i + 1) * 1000 }),
    );
    const chart = buildChart("chart", many, ASOF);
    expect(chart?.rows.length).toBe(8);
    expect(chart?.othersCount).toBe(12);
  });

  /** A transfer between your own wallets is not spending; only its fee is. */
  it("counts a transfer to your own wallet as its fee only", () => {
    const moved = [
      row({
        type: "Transfer",
        category: "Transfer",
        item: "",
        fromWallet: "Cash",
        toWallet: "Gcash",
        amount: 100000,
        fee: 1500,
        total: 101500,
      }),
    ];
    expect(buildChart("chart", moved, ASOF)?.total).toBe(1500);
  });

  it("counts a transfer that left your accounts in full", () => {
    const sent = [
      row({
        type: "Transfer",
        category: "Transfer",
        item: "",
        fromWallet: "Cash",
        toWallet: "",
        amount: 100000,
        fee: 1500,
        total: 101500,
      }),
    ];
    expect(buildChart("chart", sent, ASOF)?.total).toBe(101500);
  });

  it("leaves income out of a spending chart", () => {
    const income = [
      row({ type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Maya" }),
    ];
    expect(buildChart("chart", income, ASOF)).toBeNull();
  });
});

describe("chartLabel", () => {
  it("writes centavos as pesos", () => {
    expect(chartLabel(100000)).toBe("PHP 1,000.00");
    expect(chartLabel(1)).toBe("PHP 0.01");
  });
});

describe("a chart never invents its own arithmetic", () => {
  /**
   * The bug these exist to stop.
   *
   * This file had its own definition of spending, and it over-counted 2026 by
   * PHP 13,128.00 by counting Spending rows whose category is blank and
   * ignoring debt interest. Every test above passed throughout, because they
   * all used rows the two definitions happened to agree on. A chart that
   * disagrees with the Insights screen about the year is worse than no chart.
   */
  const awkward: Transaction[] = [
    row({ item: "Food", category: "Spending", amount: 10000, total: 10000 }),
    // Counted by the old definition, ignored by the app's: no category.
    row({ item: "Mystery", category: "", amount: 99900, total: 99900 }),
    // Ignored by the old definition, counted by the app's: debt interest.
    row({
      type: "Debt",
      category: "",
      item: "",
      debtId: "d1",
      debtEffect: "interest",
      amount: 18879,
      total: 18879,
    }),
    // Between the owner's own wallets: the fee, not the thousand.
    row({
      type: "Transfer",
      category: "Transfer",
      item: "",
      fromWallet: "Cash",
      toWallet: "Gcash",
      amount: 100000,
      fee: 1500,
      total: 101500,
    }),
  ];

  it("agrees with totalsFor for the window it drew", () => {
    const chart = buildChart("chart", awkward, ASOF);
    expect(chart?.total).toBe(totalsFor(awkward).total);
  });

  it("leaves out a Spending row with no category, as the app does", () => {
    const chart = buildChart("chart", awkward, ASOF);
    expect(chart?.rows.map((r) => r.label)).not.toContain("Mystery");
  });

  it("counts debt interest, as the app does", () => {
    // 100.00 food + 188.79 interest + 15.00 fee
    expect(buildChart("chart", awkward, ASOF)?.total).toBe(10000 + 18879 + 1500);
  });

  it("agrees with totalsFor for every grouping of the same window", () => {
    for (const q of ["chart", "chart by wallet", "chart by category", "chart per month"]) {
      const chart = buildChart(q, awkward, ASOF);
      expect(chart?.total, q).toBe(totalsFor(awkward).total);
    }
  });
});

describe("isChartFollowUp", () => {
  /** "How about this month?" straight after a chart, answered in prose. */
  it("reads a bare period as another chart when one is on screen", () => {
    expect(isChartFollowUp("How about this month?", true)).toBe(true);
    expect(isChartFollowUp("May", true)).toBe(true);
    expect(isChartFollowUp("per month", true)).toBe(true);
    expect(isChartFollowUp("by wallet", true)).toBe(true);
  });

  it("is nothing without a chart to follow", () => {
    expect(isChartFollowUp("How about this month?", false)).toBe(false);
  });

  it("leaves a real question alone", () => {
    expect(isChartFollowUp("how much did I spend in May", true)).toBe(false);
    expect(isChartFollowUp("what happened in May", true)).toBe(false);
  });

  it("leaves a sentence alone, however it mentions a month", () => {
    expect(isChartFollowUp("I spent 500 in May on food and it was too much", true)).toBe(false);
  });

  it("does not match a month name inside a longer word", () => {
    expect(isChartFollowUp("maybe", true)).toBe(false);
  });

  it("is nothing for a message naming no period", () => {
    expect(isChartFollowUp("thanks", true)).toBe(false);
    expect(isChartFollowUp("", true)).toBe(false);
  });
});
