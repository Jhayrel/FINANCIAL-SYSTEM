import { describe, expect, it } from "vitest";

import { buildChart, chartLabel, wantsChart, wantsReport } from "./charts";
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
