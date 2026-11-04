/**
 * The chart and figure faults found by the 4 November 2026 sweep: a question
 * answered, then "pie", "bars" or "chart", with the AI off and on. Invented
 * rows; the shapes are the owner's.
 *
 * "Show me revenue", then "pie", drew 2026's income by month (owner: "wrong
 * chart it shows the revenue per month fix it"). "how much did i earn last
 * month", then "pie", drew spending. "what did i spend the most on in
 * september" was answered with November, and the AI was handed November's
 * figures to answer it with.
 */
import { describe, expect, it } from "vitest";

import { buildChart, groupOf, percentOf } from "./charts";
import type { MonthBrief } from "./monthPlan";
import { quickAnswer, readQuickAsk } from "./quickAsk";
import { readSpendAsk, spendAnswer } from "./spendAsk";
import type { Transaction } from "./types";
import { dateIn, readWithdrawal } from "./withdrawal";

const asOf = "2026-11-04";
let n = 0;
const row = (date: string, type: "Spending" | "Revenue", item: string, amount: number, over: Partial<Transaction> = {}): Transaction =>
  ({
    id: `t${(n += 1)}`,
    recordNumber: n,
    date,
    type,
    fromWallet: type === "Spending" ? "Gcash" : "",
    toWallet: type === "Revenue" ? "Gcash" : "",
    category: type === "Revenue" ? "Revenue" : "Spending",
    item,
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: type === "Revenue" ? "Received" : "Paid",
    ...over,
  }) as Transaction;

const ledger: Transaction[] = [
  row("2026-09-05", "Spending", "Snacks", 40_000),
  row("2026-09-12", "Spending", "Rides", 90_000),
  row("2026-09-20", "Spending", "Snacks", 15_000),
  row("2026-10-02", "Revenue", "Stipend", 800_000),
  row("2026-10-09", "Revenue", "Tips", 4_500),
  row("2026-10-07", "Spending", "Phone plan", 29_900, { category: "Bills" }),
  row("2026-10-12", "Spending", "Internet", 50_000, { category: "Bills" }),
  row("2026-10-15", "Spending", "Music app", 14_900, { category: "Subscriptions" }),
  row("2026-10-16", "Spending", "Video app", 24_900, { category: "Subscriptions" }),
  row("2026-10-20", "Spending", "Snacks", 52_000, { fromWallet: "Wallet B" }),
  // November: one source is nearly all of it, two are small.
  row("2026-11-02", "Revenue", "Stipend", 1_200_000),
  row("2026-11-03", "Revenue", "Tips", 2_100),
  row("2026-11-03", "Revenue", "Interest", 240),
  row("2026-11-03", "Spending", "Snacks", 33_000),
  row("2026-11-03", "Spending", "Music app", 14_900, { category: "Subscriptions", fromWallet: "Wallet B" }),
];

describe("percentOf: honest shares", () => {
  it("never 0% for money that is there, never 100% beside other parts", () => {
    expect(percentOf(3_100, 1_003_396)).toBe("under 1%");
    expect(percentOf(1_000_000, 1_003_396)).toBe("over 99%");
    expect(percentOf(1_000, 1_000)).toBe("100%");
    expect(percentOf(37, 100)).toBe("37%");
    expect(percentOf(0, 100)).toBe("0%");
  });
});

describe("a pie keeps what was asked about", () => {
  it("'Show me revenue' as a pie: November's three sources, not 2026 by month", () => {
    const c = buildChart("Show me revenue as a pie", ledger, asOf);
    expect(c?.title).toBe("Income by item, November 2026");
    expect(c?.kind).toBe("pie");
    expect(c?.rows.map((r) => r.label)).toEqual(["Stipend", "Tips", "Interest"]);
  });

  it("one slice only: the weeks of that same month, never the year", () => {
    const c = buildChart("how much did i spend on snacks last month as a pie", ledger, asOf);
    expect(c?.title).toBe("Snacks by week, October 2026");
  });

  it("'earn' and 'receive' are income", () => {
    expect(buildChart("how much did i earn last month as a pie", ledger, asOf)?.title).toBe("Income by item, October 2026");
    expect(buildChart("how much did i receive in october as a pie", ledger, asOf)?.title).toBe("Income by item, October 2026");
  });
});

describe("Bills or Subscriptions named alone is a filter, by item", () => {
  it("reads which one", () => {
    expect(groupOf("my subscriptions this year")).toBe("Subscriptions");
    expect(groupOf("how much did i pay in bills last month")).toBe("Bills");
    expect(groupOf("bills and subscriptions this year")).toBe("");
    expect(groupOf("spending by category")).toBe("");
  });

  it("draws the subscriptions themselves, and the bills; both together stay the three groups", () => {
    const subs = buildChart("my subscriptions this year as a pie", ledger, asOf);
    expect(subs?.title).toBe("Subscriptions by item, 2026");
    expect(subs?.rows.map((r) => r.label).sort()).toEqual(["Music app", "Video app"]);
    expect(subs?.total).toBe(54_700);
    // "pay" is how it was paid, never the topic.
    const bills = buildChart("how much did i pay in bills last month as a pie", ledger, asOf);
    expect(bills?.title).toBe("Bills by item, October 2026");
    expect(bills?.total).toBe(79_900);
    expect(buildChart("bills and subscriptions this year", ledger, asOf)?.by).toBe("category");
  });
});

describe("the breakdown reads the period it was asked about", () => {
  const facts = { brief: { tracks: {} } as unknown as MonthBrief, name: "November 2026", transactions: ledger, debts: [], asOf, savings: [], movedToSavings: 0 };
  const php = (c: number): string => `PHP ${(c / 100).toFixed(2)}`;

  it("'in september' is September, and 'this year' is the year", () => {
    const sept = readQuickAsk("what did i spend the most on in september");
    expect(sept?.kind).toBe("biggest");
    const words = sept ? quickAnswer(sept, facts, php) : "";
    expect(words).toContain("Rides is the biggest, PHP 900.00");
    expect(words).toContain("spent in September 2026");
    const year = readQuickAsk("top spending this year");
    expect(year ? quickAnswer(year, facts, php) : "").toContain("in 2026 so far");
  });

  it("this month and last month as before; by wallet is the chart table's", () => {
    expect(readQuickAsk("where did my money go last month")).toEqual({ kind: "biggest", month: "last" });
    expect(readQuickAsk("breakdown of my spending by wallet this month")).toBeNull();
  });
});

describe("a spending question that names a wallet, or bills", () => {
  it("'in maya' is what left that wallet; a credit line is not a wallet", () => {
    const ask = readSpendAsk("how much did i spend in wallet b this month", [], asOf, ["Gcash", "Wallet B"]);
    expect(ask?.wallet).toBe("Wallet B");
    expect(spendAnswer(ask!, ledger, asOf)).toContain("You spent **PHP 149.00** from Wallet B in November 2026");
    expect(readSpendAsk("how much did i spend this month", [], asOf, ["Gcash", "Wallet B"])?.wallet).toBeUndefined();
  });

  it("'how much did i pay in bills last month' counts the bills", () => {
    const ask = readSpendAsk("how much did i pay in bills last month", ["Snacks"], asOf, ["Gcash"]);
    expect(ask?.group).toBe("Bills");
    expect(spendAnswer(ask!, ledger, asOf)).toContain("You spent **PHP 799.00** on bills in October 2026");
  });
});

describe("an ATM slip read twice, the fee a line apart", () => {
  const slip = (feeLine: string): string =>
    `SAMPLE BANK\nTRANSACTION RECORD\nDATE TIME\nO7NOV2026 10:05\nLOCATION\nMAIN ST 1\nTRANSACTION AMOUNT\nCASH WITHDRAWAL 2,016.00\nAVAILABLE BALANCE\n812.40\nTRACE NUMBER 1234\n${feeLine}`;

  it("the reading that found the fee wins: the machine gave whole hundreds", () => {
    const w = readWithdrawal([slip("AN ATM FEE of\nIS ALRE\n"), slip("AN ATM FEE OF 16.00 IS ALREADY INCLUDED")]);
    expect(w?.cash).toBe(200_000);
    expect(w?.fee).toBe(1_600);
    expect(w?.debit).toBe(201_600);
  });

  it("a fee lines below 'ATM FEE OF', taken only when it makes the cash whole hundreds", () => {
    expect(readWithdrawal([slip("AN ATM FEE of\nIS ALRE\n16.00\nINCLUDED")])?.fee).toBe(1_600);
    // A balance printed under it is never a fee.
    expect(readWithdrawal([slip("AN ATM FEE of\nBALANCE\n7.40")])?.fee).toBe(0);
  });

  it("a zero read as the letter O is still the day", () => {
    expect(dateIn("O7NOV2026 10:05")).toBe("2026-11-07");
    expect(dateIn("29SEP2026")).toBe("2026-09-29");
  });
});
