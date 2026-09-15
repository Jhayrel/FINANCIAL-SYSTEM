/**
 * A day, or a run of days: in the past, ahead, both, and across a year.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import type { Debt } from "./debt";
import { describeRange, rangeOf, rangeReport } from "./dayRange";
import type { ReferenceLists, Transaction } from "./types";

const fx = loadFixture();
const AS_OF = "2026-09-15";
const reference: ReferenceLists = { ...fx.reference, wallets: ["Cash"], savings: [], bills: ["Wifi"], subscriptions: ["Spotify"] };

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  return {
    id: `r${n}`,
    recordNumber: n,
    date: "2026-09-01",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    fee: 0,
    notes: "",
    status: "",
    ...over,
    amount,
    total: amount + (over.fee ?? 0),
  };
};

const ledger: Transaction[] = [
  row({ date: "2026-09-01", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 500000 }),
  row({ date: "2026-09-05", item: "Food", amount: 15000 }),
  row({ date: "2026-09-05", item: "Travel", amount: 40000 }),
  row({ date: "2026-09-07", item: "Food", amount: 20000 }),
  row({ date: "2026-08-10", category: "Bills", item: "Wifi", amount: 99900 }),
  row({ date: "2026-08-20", category: "Subscriptions", item: "Spotify", amount: 8500 }),
];

const report = (start: string, end: string, debts: Debt[] = [], rows = ledger) =>
  rangeReport({ transactions: rows, reference, debts, range: rangeOf(start, end), asOf: AS_OF });

describe("a day, or a run of days", () => {
  it("reads out one past day: what went out, where, and every entry", () => {
    const day = report("2026-09-05", "2026-09-05");
    expect(day.days).toBe(1);
    expect(day.pastDays).toBe(1);
    expect(day.spent).toBe(55000);
    expect(day.kinds.map((k) => k.name)).toEqual(["Travel", "Food"]);
    expect(day.rows).toHaveLength(2);
    expect(day.expected).toHaveLength(0);
  });

  it("puts a range picked backwards the right way round, and averages over the days that happened", () => {
    const week = report("2026-09-07", "2026-09-01");
    expect(week.range).toEqual({ start: "2026-09-01", end: "2026-09-07" });
    expect(week.cameIn).toBe(500000);
    expect(week.spent).toBe(75000);
    expect(week.perDay).toBe(Math.floor(75000 / 7));
    expect(week.biggest).toEqual({ date: "2026-09-05", amount: 55000 });
  });

  it("splits a range that runs past today into days so far and days ahead", () => {
    const month = report("2026-09-10", "2026-09-25");
    expect(month.pastDays).toBe(6);
    expect(month.futureDays).toBe(10);
    // Spotify is next due on the 20th; Wifi's date has passed, so it is late, not ahead.
    expect(month.expected.map((e) => [e.name, e.on])).toEqual([["Spotify", "2026-09-20"]]);
  });

  it("counts a bill every month it falls due in a range further ahead", () => {
    const ahead = report("2026-09-16", "2026-11-30");
    const spotify = ahead.expected.find((e) => e.name === "Spotify");
    expect(spotify?.times).toBe(3);
    expect(spotify?.amount).toBe(25500);
    expect(ahead.pastDays).toBe(0);
    expect(ahead.rows).toHaveLength(0);
  });

  it("includes a debt payment due in the range", () => {
    const credit: Debt = {
      id: "maya-credit",
      name: "Maya Credit",
      kind: "payable",
      counterparty: "Maya",
      openedDate: "2026-08-01",
      wallet: "Cash",
      interestType: "none",
      interestRate: 0,
      notes: "",
      archived: false,
      dueDay: 20,
    };
    const rows = [
      ...ledger,
      row({ date: "2026-08-25", type: "Debt", fromWallet: "", toWallet: "Cash", category: "", item: "", amount: 100000, debtId: "maya-credit", debtEffect: "draw" }),
    ];
    const ahead = report("2026-09-16", "2026-09-30", [credit], rows);
    expect(ahead.expected.some((e) => e.kind === "debt" && e.name === "Maya Credit" && e.on === "2026-09-20")).toBe(true);
  });

  it("crosses a year", () => {
    const rows = [row({ date: "2026-12-31", amount: 10000 }), row({ date: "2027-01-01", amount: 20000 })];
    const span = rangeReport({ transactions: rows, reference, debts: [], range: rangeOf("2026-12-30", "2027-01-02"), asOf: "2027-01-05" });
    expect(span.days).toBe(4);
    expect(span.spent).toBe(30000);
    expect(describeRange(span.range)).toBe("December 30, 2026 to January 2, 2027");
  });

  it("names a range the way a person says it", () => {
    expect(describeRange({ start: "2026-09-05", end: "2026-09-05" })).toBe("September 5, 2026");
    expect(describeRange({ start: "2026-09-01", end: "2026-09-15" })).toBe("September 1 to 15, 2026");
    expect(describeRange({ start: "2026-08-28", end: "2026-09-03" })).toBe("August 28 to September 3, 2026");
  });
});
