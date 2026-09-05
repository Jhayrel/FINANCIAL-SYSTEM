/**
 * Faults found by running the challenge scenarios through the pipeline.
 *
 * Not from the record this time: these came from putting sixty deliberately
 * awkward sentences through the reader, the finder and the chart builder and
 * reading what came out. Four were wrong in ways nobody would have reported,
 * because each produces something that looks entirely reasonable.
 */

import { describe, expect, it } from "vitest";

import { readEntry } from "./readEntry";
import { wantsDiscardAll } from "./recall";
import { buildChart } from "./charts";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: ["Globe at Home Wifi", "Dito Prepaid"],
  subscriptions: ["Spotify", "Google Drive", "Microsoft Office 365", "Netflix"],
  revenueCategories: ["Allowance", "Framelink"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Treat", remark: "Treating someone" },
  ],
};

const ASOF = "2026-09-05";
const read = (t: string) => readEntry(t, [], reference, ASOF);

describe("a figure inside a name is not an amount", () => {
  /**
   * "I paid my spotify and my google drive and my microsoft office 365 from
   * gcash" came back as PHP 365.00. The 365 is part of the subscription's
   * name, and reading it as the price looks entirely reasonable on the card.
   */
  it("does not price a subscription by the digits in its name", () => {
    expect(read("I paid my microsoft office 365 from gcash").draft.amount).toBeNull();
  });

  it("still reads a real amount beside a numbered name", () => {
    expect(read("I paid microsoft office 365 for 239 from gcash").draft.amount).toBe(23900);
  });

  it("leaves ordinary names alone", () => {
    expect(read("I paid spotify 85 from gcash").draft.amount).toBe(8500);
  });
});

describe("a bare year is a year, with or without a month beside it", () => {
  /** "How much did I spend on food in 2027?" read PHP 2,027.00. */
  it("does not read a year after a preposition as money", () => {
    for (const said of [
      "how much did I spend on food in 2027",
      "what did I spend during 2025",
      "my total for 2026",
    ]) {
      expect(read(said).draft.amount, said).toBeNull();
    }
  });

  it("still reads a figure that is money", () => {
    expect(read("I paid 2027 for food using cash").draft.amount).toBe(202700);
    expect(read("I spent php 2027 in 2026 on food using cash").draft.amount).toBe(202700);
  });
});

describe("discarding all the cards is a bare instruction", () => {
  /**
   * "Delete every entry I made on 2026-08-29" matched: it has "every" and
   * "delete" and it is short. It is not a request to clear the cards on
   * screen, it is a request to find rows, and answering it by throwing away
   * unrelated cards is the wrong action on the wrong things.
   */
  it("does not fire on a sentence that names a target", () => {
    for (const said of [
      "Delete every entry I made on 2026-08-29",
      "remove all rows about food",
      "delete every record from august",
      "discard all entries dated yesterday",
    ]) {
      expect(wantsDiscardAll(said), said).toBe(false);
    }
  });

  it("still fires on the bare instruction", () => {
    for (const said of ["discard all", "reject all", "throw them all away", "clear all"]) {
      expect(wantsDiscardAll(said), said).toBe(true);
    }
  });
});

describe("a range of months is a range", () => {
  let n = 0;
  const row = (over: Partial<Transaction> = {}): Transaction => {
    n += 1;
    return {
      id: `c-${n}`,
      recordNumber: n,
      date: "2026-06-10",
      type: "Spending",
      fromWallet: "Cash",
      toWallet: "",
      category: "Spending",
      item: "Treat",
      description: "",
      amount: 10000,
      fee: 0,
      total: 10000,
      notes: "",
      status: "Paid",
      ...over,
    };
  };

  const ledger = [
    row({ date: "2026-04-02", amount: 90000, total: 90000 }),
    row({ date: "2026-05-04" }),
    row({ date: "2026-06-04" }),
    row({ date: "2026-07-04" }),
    row({ date: "2026-08-04" }),
    row({ date: "2026-09-04", amount: 70000, total: 70000 }),
  ];

  /** "Chart my treats from may to august" drew May alone. */
  it("covers both endpoints and everything between", () => {
    const chart = buildChart("chart my treats from may to august", ledger, ASOF);
    expect(chart?.title).toContain("May 2026 to August 2026");
    expect(chart?.total).toBe(40000);
  });

  it("leaves out what falls either side of the range", () => {
    const chart = buildChart("chart my treats from may to august", ledger, ASOF);
    expect(chart?.rows.map((r) => r.label)).not.toContain("April 2026");
    expect(chart?.rows.map((r) => r.label)).not.toContain("September 2026");
  });

  it("reads a range written backwards as the same window", () => {
    expect(buildChart("chart treats from august to may", ledger, ASOF)?.total).toBe(40000);
  });

  it("still reads a single month as one month", () => {
    expect(buildChart("chart treats in july", ledger, ASOF)?.total).toBe(10000);
  });
});
