/**
 * The year changing (2 November 2026, owner: "Make sure too the system works
 * if the year changes"). Found by running every screen and the chat on 31
 * December 2026, 1 January and 15 January 2027 over invented December and
 * January rows; each case here failed before its fix.
 */
import { describe, expect, it } from "vitest";

import { comparedPeriods, windowOf } from "./charts";
import { earnAnswer, readEarnAsk } from "./earnAsk";
import { readPlanIntent } from "./planIntent";
import { groupOpen, makePlan, viewOf } from "./planner";
import { readQuickAsk } from "./quickAsk";
import { readSpendAsk, spendAnswer } from "./spendAsk";
import type { ReferenceLists, Transaction } from "./types";

const reference = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank"],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance", "Bank interest"],
  spendingTypes: [
    { name: "Food", remark: "" },
    { name: "Travel", remark: "" },
  ],
  stopped: [],
} as unknown as ReferenceLists;

let n = 0;
const row = (date: string, over: Partial<Transaction>): Transaction => {
  n += 1;
  return { id: `r${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", amount: 15000, fee: 0, total: 15000, notes: "", status: "Paid", ...over } as Transaction;
};
const ledger: Transaction[] = [
  row("2026-01-02", { type: "Revenue", fromWallet: "", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 1000000, total: 1000000, status: "Received" }),
  row("2026-06-30", { type: "Revenue", fromWallet: "", toWallet: "Maya Bank", category: "Revenue", item: "Bank interest", amount: 512, total: 512, status: "Received" }),
  row("2026-12-01", { type: "Revenue", fromWallet: "", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 1000000, total: 1000000, status: "Received" }),
  row("2026-12-20", {}),
  row("2026-12-31", { amount: 30000, total: 30000 }),
  row("2027-01-01", { amount: 20000, total: 20000 }),
];

describe("a month named with no year is the latest one begun", () => {
  it("in January, december is the December just gone", () => {
    expect(windowOf("how much did I spend in december?", "2027-01-15")).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(windowOf("how much did I spend in january?", "2027-01-15")).toMatchObject({ from: "2027-01-01", to: "2027-01-31" });
  });

  it("a year said is that year", () => {
    expect(windowOf("how much did I spend in december 2027?", "2027-01-15")).toMatchObject({ from: "2027-12-01" });
  });

  it("from december to january runs across New Year", () => {
    expect(windowOf("how much did I spend from december to january?", "2027-01-15")).toMatchObject({ from: "2026-12-01", to: "2027-01-31" });
  });

  it("the middle of the year is unchanged", () => {
    expect(windowOf("how much did I spend in october?", "2026-11-01")).toMatchObject({ from: "2026-10-01" });
    expect(windowOf("from may to august", "2026-11-01")).toMatchObject({ from: "2026-05-01", to: "2026-08-31" });
    expect(windowOf("from september to december", "2026-11-01")).toMatchObject({ from: "2026-09-01", to: "2026-12-31" });
  });

  it("two months compared: the later is now, across the year", () => {
    const c = comparedPeriods("compare january and december", "2027-01-15");
    expect(c?.now.from).toBe("2027-01-01");
    expect(c?.before.from).toBe("2026-12-01");
    expect(comparedPeriods("compare jan and dec", "2027-01-15")?.before.from).toBe("2026-12-01");
  });

  it("the spending answer reads December 2026", () => {
    const ask = readSpendAsk("how much did I spend in december?", ["Food", "Travel"], "2027-01-01");
    expect(ask).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(spendAnswer(ask!, ledger, "2027-01-01")).toMatch(/PHP 450\.00/);
  });

  it("a month before the entries begin says when they begin", () => {
    const ask = readSpendAsk("how much did I spend in december?", ["Food"], "2026-11-01");
    expect(ask?.from).toBe("2025-12-01");
    expect(spendAnswer(ask!, ledger, "2026-11-01")).toMatch(/Your entries start on January 2, 2026\./);
  });
});

describe("questions with the AI off", () => {
  it("summary of a year or a month is its spending", () => {
    expect(readSpendAsk("summary of 2026", ["Food"], "2027-01-01")).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
    expect(readSpendAsk("summary of october", ["Food"], "2026-11-01")).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(readSpendAsk("give me a summary of last month", ["Food"], "2027-01-01")).toMatchObject({ from: "2026-12-01" });
  });

  it("what is my budget this month", () => {
    expect(readQuickAsk("what is my budget this month?")).toEqual({ kind: "budget" });
    expect(readQuickAsk("what's my budget?")).toEqual({ kind: "budget" });
  });

  it("interest this year, by the word interest, with the year before when none yet", () => {
    const ask = readEarnAsk("how much interest did I earn this year?", reference.revenueCategories, "2027-01-15");
    expect(ask).toMatchObject({ from: "2027-01-01", only: "Bank interest" });
    expect(earnAnswer(ask!, ledger, [], "2027-01-15")).toBe("Nothing came in from Bank interest in 2027 so far. In 2026: PHP 5.12.");
  });

  it("income in a month named, and last year", () => {
    const dec = readEarnAsk("how much did I receive in december?", reference.revenueCategories, "2027-01-15");
    expect(dec).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(earnAnswer(dec!, ledger, [], "2027-01-15")).toMatch(/^You received \*\*PHP 10,000\.00\*\* in December 2026, over 1 entry\./);
    expect(readEarnAsk("how much did I earn last year?", reference.revenueCategories, "2027-01-15")).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("a plan said for tomorrow with its wallet", () => {
  it("lunch 150 cash tomorrow is a plan for tomorrow, from Cash, called Lunch", () => {
    const intent = readPlanIntent("lunch 150 cash tomorrow", { reference, transactions: ledger, asOf: "2026-12-31", debtNames: [] });
    expect(intent).toMatchObject({ kind: "later", plans: [{ title: "Lunch", amount: 15000, due: "2027-01-01", wallet: "Cash" }] });
  });
});

describe("a plan for sometime in a year", () => {
  it("is its own group, not under December", () => {
    const asOf = "2027-01-01";
    const plan = makePlan({ title: "Laptop", amount: 4000000, due: "2027-12-31", dueKind: "year", item: "", wallet: "", need: false, setAside: false, notes: "" }, asOf, "owner", "p1");
    const dec = makePlan({ title: "Gifts", amount: 300000, due: "2027-12-20", item: "", wallet: "", need: false, setAside: true, notes: "" }, asOf, "owner", "p2");
    const groups = groupOpen([plan, dec].map((p) => viewOf(p, { transactions: [], accounts: [], asOf })), asOf);
    expect(groups.map((g) => g.title)).toEqual(["December 2027", "Sometime in 2027"]);
  });
});
