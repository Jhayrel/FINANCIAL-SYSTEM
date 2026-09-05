/**
 * A comparison, and the word "credited", which pointed two ways at once.
 *
 * "how did august compare with july" drew "Spending by item, July 2026": one
 * month, the wrong one, broken down by item. The owner wrote "chart is bad"
 * and they were right.
 *
 * "i credited 5000 today and recieved it in maya" produced nothing at all,
 * while "bank interest credited to maya" was read as borrowing. One word,
 * two opposite meanings, and the difference is who did the crediting.
 */

import { describe, expect, it } from "vitest";

import { buildChart, comparesMonths } from "./charts";
import { readEntry } from "./readEntry";
import type { ReferenceLists, Transaction } from "./types";

let n = 0;
const row = (date: string, item: string, amount: number): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date,
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item,
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Paid",
  };
};

const ledger = [
  row("2026-07-04", "Food", 100000),
  row("2026-07-18", "Gas", 50000),
  row("2026-08-02", "Food", 200000),
  row("2026-08-20", "Gas", 30000),
  row("2026-09-01", "Food", 40000),
];

const chart = (q: string) => buildChart(q, ledger, "2026-09-06");

describe("comparing two months", () => {
  it("is recognised however it is phrased", () => {
    for (const q of [
      "how did august compare with july",
      "compare july and august",
      "august vs july",
      "was august worse than july",
    ]) {
      expect(comparesMonths(q), q).toBe(true);
    }
  });

  it("spans both months rather than picking one", () => {
    expect(chart("how did august compare with july")?.title).toContain(
      "July 2026 to August 2026",
    );
  });

  it("draws one bar per month, which is what a comparison is", () => {
    const c = chart("how did august compare with july");
    expect(c?.by).toBe("month");
    expect(c?.rows.map((r) => r.label)).toEqual(["July 2026", "August 2026"]);
  });

  it("gets both figures right", () => {
    const c = chart("compare july and august");
    expect(c?.rows.find((r) => r.label === "July 2026")?.value).toBe(150000);
    expect(c?.rows.find((r) => r.label === "August 2026")?.value).toBe(230000);
  });

  it("leaves September out, which neither month named", () => {
    expect(chart("august vs july")?.rows.map((r) => r.label)).not.toContain("September 2026");
  });

  it("is not a comparison when only one month is named", () => {
    expect(comparesMonths("how does august compare")).toBe(false);
    expect(comparesMonths("chart my food in august")).toBe(false);
  });

  it("is not a comparison without a comparing word", () => {
    expect(comparesMonths("chart july and august")).toBe(false);
  });
});

const reference: ReferenceLists = {
  wallets: ["Gcash", "Maya", "Cash"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance", "Bank interest"],
  spendingTypes: [{ name: "Food", remark: "Meals, snacks, drinks" }],
  credits: ["Maya Credit"],
};

const read = (t: string) => readEntry(t, [], reference, "2026-09-06");

describe("who did the crediting", () => {
  it("reads the owner drawing on credit as debt", () => {
    const r = read("i credited 5000 today and recieved it in maya");
    expect(r.readsAsDebt).toBe(true);
    expect(r.draft.amount).toBe(500000);
  });

  /**
   * Bank interest is one of the owner's own revenue categories, and their
   * ledger holds ten of those rows. It was read as borrowing on the strength
   * of the word "interest" alone.
   */
  it("reads money credited to an account as income", () => {
    const r = read("bank interest credited to maya 4.02");
    expect(r.readsAsDebt).toBe(false);
    expect(r.draft.flow).toBe("Revenue");
    expect(r.draft.toWallet).toBe("Maya");
    expect(r.draft.amount).toBe(402);
  });

  it("still reads interest on a credit line as debt", () => {
    expect(read("I paid the interest on maya credit").readsAsDebt).toBe(true);
  });

  it("leaves ordinary income alone", () => {
    const r = read("I received 5000 allowance in maya");
    expect(r.readsAsDebt).toBe(false);
    expect(r.draft.flow).toBe("Revenue");
  });
});
