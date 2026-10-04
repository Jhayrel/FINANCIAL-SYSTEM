/**
 * Which chart, read from the words and from the model, and the charts the
 * assistant could talk about but not draw: budget, balance, what is owed.
 *
 * The owner, 4 October 2026: "Fix the ai and charting like make sure they
 * are align like if the result need to show charts or pie or tend etc show
 * them but be careful ai should know properly and show the right things."
 * Every figure here is invented.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { buildChart } from "./charts";
import {
  buildBalanceChart,
  buildBudgetChart,
  buildOwedChart,
  chartHelps,
  chartReading,
  hintFrom,
  inWords,
  localHint,
  measureOf,
  mergeHint,
} from "./chartAsk";
import { outstandingOf, type Debt } from "./debt";
import type { Budgets, Transaction } from "./types";

let n = 0;
const tx = (over: Partial<Transaction> & Pick<Transaction, "date" | "amount">): Transaction => {
  n += 1;
  const fee = over.fee ?? 0;
  return {
    id: `t-${n}`,
    recordNumber: n,
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    fee,
    total: over.amount + fee,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const ASOF = "2026-10-03";
const CREDITS = ["Maya Credit"];

const line: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  counterparty: "Maya Bank",
  openedDate: "2026-07-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
  form: "credit-line",
};

const ledger: Transaction[] = [
  tx({ date: "2026-07-01", type: "Revenue", fromWallet: "", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 1000000, status: "Received" }),
  tx({ date: "2026-07-05", amount: 200000, item: "Food" }),
  tx({ date: "2026-07-20", amount: 50000, item: "Treat", fromWallet: "Maya" }),
  tx({ date: "2026-08-02", amount: 300000, item: "School", fromWallet: "Maya" }),
  tx({ date: "2026-08-10", type: "Transfer", fromWallet: "Maya", toWallet: "Cash", category: "Transfer", item: "", amount: 100000, fee: 1500, status: "Withdrawn" }),
  tx({ date: "2026-08-15", type: "Debt", fromWallet: "", toWallet: "Maya", category: "", item: "Maya Credit", amount: 250000, debtId: "maya-credit", debtEffect: "draw" }),
  tx({ date: "2026-09-01", type: "Debt", fromWallet: "Maya", toWallet: "", category: "", item: "Maya Credit", amount: 250000, debtId: "maya-credit", debtEffect: "repay" }),
  tx({ date: "2026-09-01", type: "Debt", fromWallet: "Maya", toWallet: "", category: "", item: "Maya Credit", amount: 18879, debtId: "maya-credit", debtEffect: "interest" }),
  tx({ date: "2026-09-12", amount: 70000, item: "Food" }),
  tx({ date: "2026-10-02", amount: 15000, item: "Food", fromWallet: "Maya" }),
];

const budgets: Budgets = {
  "2026": {
    spending: [0, 0, 0, 0, 0, 0, 200000, 200000, 200000, 300000, 0, 0],
    billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};

describe("what the model says to draw", () => {
  it("keeps the words it knows and drops what it invented", () => {
    expect(hintFrom({ shape: "pie", by: "item", money: "spending" })).toEqual({ shape: "pie", by: "item", money: "spending" });
    expect(hintFrom({ shape: "Trend", by: "Monthly", money: "Revenue" })).toEqual({ shape: "line", by: "month", money: "income" });
    expect(hintFrom({ shape: "radar", by: "mood", money: "vibes" })).toBeNull();
    expect(hintFrom({ shape: "", by: "", money: "" })).toBeNull();
    expect(hintFrom("pie")).toBeNull();
  });
});

describe("what the words say to draw", () => {
  it("reads a split, a ranking and a change over time", () => {
    expect(localHint("where did my money go this month?")).toEqual({ by: "item", shape: "pie" });
    expect(localHint("what did I spend the most on this year")).toEqual({ by: "item", shape: "bars" });
    expect(localHint("is my food spending going up?")).toEqual({ by: "month", shape: "line" });
  });

  it("reads a budget, a balance and a debt to be drawn", () => {
    expect(measureOf(localHint("show me my budget vs actual this year"))).toBe("budget");
    expect(measureOf(localHint("how am I doing with my budget this month, show me"))).toBe("budget");
    expect(localHint("how much is in each of my accounts, show me")).toEqual({ money: "balance", by: "wallet" });
    expect(measureOf(localHint("chart my maya balance"))).toBe("balance");
    expect(measureOf(localHint("chart my maya credit", CREDITS))).toBe("owed");
  });

  it("leaves alone what is not a chart", () => {
    // A balance being told, a budget being set, a debt gone through row by row.
    expect(localHint("my balance is 1533.83")).toBeNull();
    expect(localHint("set my budget to 9000 for october")).toBeNull();
    expect(localHint("check my maya credit draw by draw", CREDITS)).toBeNull();
    expect(localHint("lunch 95 cash")).toBeNull();
    expect(localHint("is it going up?")).toBeNull();
  });

  it("lets the words overrule the model, and the model fill what they leave open", () => {
    expect(mergeHint({ shape: "pie", by: "item" }, { shape: "line", by: "month", money: "income" }, "where did my money go")).toEqual({
      shape: "pie",
      by: "item",
      money: "income",
    });
    // The model's balance stands only when the words are about one.
    expect(mergeHint(null, { money: "balance" }, "show my spending")).toBeNull();
    expect(mergeHint(null, { money: "balance" }, "how have my savings done")?.money).toBe("balance");
    // A line through items, which have no order, is no line.
    expect(mergeHint(null, { shape: "line", by: "item" }, "chart it")).toEqual({ by: "item" });
  });

  it("says the hint in words only where the message is silent", () => {
    expect(inWords("is my food spending going up?", { by: "month", shape: "line" })).toBe("is my food spending going up? by month as a line");
    expect(inWords("pie of this month by category", { by: "item", shape: "bars" })).toBe("pie of this month by category");
    expect(inWords("show me the money", { money: "income" })).toBe("show me the money income");
    expect(inWords("chart my spending", { money: "income" })).toBe("chart my spending");
  });

  it("draws the chart the hint asks for", () => {
    const q = "is my food spending going up?";
    const chart = buildChart(inWords(q, localHint(q)), ledger, ASOF)!;
    expect(chart.kind).toBe("line");
    expect(chart.by).toBe("month");
    expect(chart.title.startsWith("Food by month")).toBe(true);
  });

  it("puts a chart beside a question only when it shows more than one figure", () => {
    expect(chartHelps("where did my money go this month?", { by: "item", shape: "pie" }, false)).toBe(true);
    expect(chartHelps("how much did I spend today?", { by: "item" }, false)).toBe(false);
    expect(chartHelps("how much did I spend each month?", { by: "month" }, false)).toBe(true);
    expect(chartHelps("is it a trend??", { by: "month", shape: "line" }, true)).toBe(false);
    expect(chartHelps("anything", null, false)).toBe(false);
  });
});

describe("spending against the budget", () => {
  it("puts each month's spending beside its budget", () => {
    const chart = buildBudgetChart("budget vs actual this year", ledger, budgets, ASOF)!;
    expect(chart.measure).toBe("budget");
    expect(chart.rows.map((r) => [r.label, r.value, r.previous])).toEqual([
      ["July 2026", 250000, 200000],
      ["August 2026", 300000 + 1500, 200000],
      ["September 2026", 70000 + 18879, 200000],
      ["October 2026", 15000, 300000],
    ]);
    expect(chart.running).toBe(true);
    expect(chartReading(chart)).toBe(
      "Over the budget in 2 of 3 months with one; August 2026 by the most, PHP 1,015.00 over. October 2026 is still running: PHP 150.00 of PHP 3,000.00 so far.",
    );
  });

  it("draws one month day by day against a steady pace to its budget", () => {
    const chart = buildBudgetChart("how is my budget this month, show me", ledger, budgets, ASOF)!;
    expect(chart.kind).toBe("line");
    expect(chart.by).toBe("day");
    expect(chart.rows.map((r) => r.value)).toEqual([0, 15000, 15000]);
    // PHP 3,000.00 over 31 days, three days in.
    expect(chart.rows[2]?.previous).toBe(Math.round((300000 * 3) / 31));
  });
});

describe("balances", () => {
  it("ends at the balance every other screen shows, and reads each month's end", () => {
    const chart = buildBalanceChart("chart my maya balance since july", ledger, { wallets: ["Maya", "Cash"], savings: [] }, ASOF)!;
    expect(chart.measure).toBe("balance");
    expect(chart.total).toBe(walletBalance(ledger, "Maya"));
    const endOf = (d: string): number => walletBalance(ledger.filter((t) => t.date <= d), "Maya");
    expect(chart.rows.map((r) => r.value)).toEqual([endOf("2026-07-31"), endOf("2026-08-31"), endOf("2026-09-30"), endOf(ASOF)]);
  });

  it("counts an entry dated after today, as the sidebar does, and says so", () => {
    // The Add form takes a date ahead with a warning; the sidebar counts it, so the chart's "now" does too.
    const ahead = [...ledger, tx({ date: "2026-10-09", amount: 40000, item: "School", fromWallet: "Maya" })];
    const chart = buildBalanceChart("chart my maya balance", ahead, { wallets: ["Maya", "Cash"], savings: [] }, ASOF)!;
    expect(chart.total).toBe(walletBalance(ahead, "Maya"));
    expect(chart.ahead).toBe(1);
    expect(chartReading(chart)).toMatch(/ Counts 1 entry dated after today\.$/);
    const split = buildBalanceChart("how much is in each account", ahead, { wallets: ["Maya", "Cash"], savings: [] }, ASOF, true)!;
    expect(split.rows.find((r) => r.label === "Maya")?.value).toBe(walletBalance(ahead, "Maya"));
    // A window that ended before today is read as it stood then.
    expect(buildBalanceChart("chart my maya balance in august", ahead, { wallets: ["Maya", "Cash"], savings: [] }, ASOF)?.ahead).toBeUndefined();
  });

  it("splits by account, largest first", () => {
    const chart = buildBalanceChart("how much is in each account", ledger, { wallets: ["Maya", "Cash"], savings: [] }, ASOF, true)!;
    expect(chart.by).toBe("wallet");
    expect(chart.rows.map((r) => r.value)).toEqual(
      [walletBalance(ledger, "Maya"), walletBalance(ledger, "Cash")].filter((v) => v !== 0).sort((a, b) => b - a),
    );
  });
});

describe("what is owed", () => {
  it("is drawn, plus charges, less repaid, with interest paid left out (rule 5.6.2)", () => {
    const chart = buildOwedChart("chart my maya credit", ledger, [line], ASOF)!;
    expect(chart.measure).toBe("owed");
    expect(chart.rows.map((r) => [r.label, r.value])).toEqual([
      ["August 2026", 250000],
      ["September 2026", 0],
      ["October 2026", 0],
    ]);
    expect(chart.total).toBe(outstandingOf(ledger, "maya-credit"));
    expect(chartReading(chart)).toBe("Nothing owed now: it is paid off. The most owed was PHP 2,500.00, at the end of August 2026.");
  });

  it("counts a draw dated after today in what is owed now", () => {
    const ahead = [...ledger, tx({ date: "2026-10-20", type: "Debt", fromWallet: "", toWallet: "Maya", category: "", item: "Maya Credit", amount: 60000, debtId: "maya-credit", debtEffect: "draw" })];
    const chart = buildOwedChart("chart my maya credit", ahead, [line], ASOF)!;
    expect(chart.total).toBe(outstandingOf(ahead, "maya-credit"));
    expect(chartReading(chart)).toBe("PHP 600.00 owed now. The most owed was PHP 2,500.00, at the end of August 2026. Counts 1 entry dated after today.");
  });
});

describe("what a chart says", () => {
  it("names the largest part and its share", () => {
    const chart = buildChart("spending by item this year", ledger, ASOF)!;
    expect(chartReading(chart)).toMatch(/^School is the largest, PHP 3,000\.00, \d+% of the PHP [\d,.]+ total\. The top three make up \d+%\.$/);
  });

  it("never reads a month still running as a low one", () => {
    const chart = buildChart("spending by month this year", ledger, ASOF)!;
    const said = chartReading(chart);
    expect(said).toContain("October 2026 so far");
    expect(said).not.toContain("lowest in October");
  });

  it("puts two months side by side in one sentence", () => {
    const chart = buildChart("how did august compare with july", ledger, ASOF)!;
    expect(chart.kind).toBe("bars");
    expect(chartReading(chart)).toBe("August 2026 is PHP 515.00 more than July 2026 (PHP 3,015.00 against PHP 2,500.00).");
  });
});
