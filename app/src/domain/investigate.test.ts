/**
 * "My balance in my bank account is 30000, where's the rest? In my tracking
 * system it's 50000." The owner's question, 2026-09-17, with the answer they
 * described: "I found your 20k, it's scattered: 5k was the cinema, 15k was
 * travel."
 *
 * Every figure here is invented.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import {
  choicesForClue,
  clueWords,
  draftForClue,
  investigate,
  investigationWords,
  looksMistyped,
  movedOn,
  readHistory,
  rowsAddingTo,
  type StatementLine,
} from "./investigate";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `r${n}`,
    recordNumber: n,
    date: "2026-09-01",
    type: "Spending",
    fromWallet: "Maya",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 0,
    fee: 0,
    total: 0,
    notes: "",
    status: "Paid",
    ...over,
  };
};
const spend = (date: string, amount: number, item: string, description = "", wallet = "Maya") =>
  row({ date, amount, total: amount, item, description, fromWallet: wallet });
const income = (date: string, amount: number, item: string, wallet = "Maya") =>
  row({ date, type: "Revenue", category: "Revenue", fromWallet: "", toWallet: wallet, amount, total: amount, item, status: "Received" });

/** ₱60,000.00 in, ₱10,000.00 of spending recorded: the ledger says ₱50,000.00. */
const ledger: Transaction[] = [
  income("2026-08-25", 6_000_000, "Salary"),
  spend("2026-09-02", 400_000, "Food", "groceries"),
  spend("2026-09-04", 600_000, "Bills", "electricity"),
];

describe("the balance the ledger holds", () => {
  it("reads each row's effect on one account the way the wallet balance does", () => {
    for (const t of ledger) expect(typeof movedOn(t, "Maya")).toBe("number");
    const recorded = ledger.reduce((sum, t) => sum + movedOn(t, "Maya"), 0);
    expect(recorded).toBe(walletBalance(ledger, "Maya"));
    expect(recorded).toBe(5_000_000);
  });
});

describe("with the account's own history", () => {
  const statement: StatementLine[] = [
    { date: "2026-09-02", amount: -400_000, description: "Groceries store" },
    { date: "2026-09-03", amount: -500_000, description: "Cinema tickets" },
    { date: "2026-09-04", amount: -600_000, description: "Electric bill" },
    { date: "2026-09-06", amount: -1_500_000, description: "Travel booking" },
  ];

  it("finds the whole gap in the two movements the ledger is missing", () => {
    const result = investigate({ transactions: ledger, account: "Maya", actual: 3_000_000, asOf: "2026-09-10", statement });
    expect(result.recorded).toBe(5_000_000);
    expect(result.gap).toBe(2_000_000);
    expect(result.found.map((c) => c.kind)).toEqual(["missing", "missing"]);
    expect(result.explained).toBe(2_000_000);
    expect(result.unexplained).toBe(0);

    const { headline, lines } = investigationWords(result);
    expect(headline).toContain("₱50,000.00");
    expect(headline).toContain("₱30,000.00");
    expect(lines[0]).toContain("Found all ₱20,000.00, in 2 places");
    expect(lines.join(" ")).toContain("Cinema");
    expect(lines.join(" ")).toContain("Travel");
  });

  it("finds a figure typed with one zero too many", () => {
    const typed = [...ledger, spend("2026-09-05", 1_500_000, "Travel", "bus to Baguio")];
    const lines: StatementLine[] = [...statement.slice(0, 1), statement[2]!, { date: "2026-09-05", amount: -150_000, description: "Bus to Baguio" }];
    const actual = 5_000_000 - 150_000;
    const result = investigate({ transactions: typed, account: "Maya", actual, asOf: "2026-09-10", statement: lines });
    expect(result.gap).toBe(-1_350_000);
    expect(result.found).toHaveLength(1);
    expect(result.found[0]).toMatchObject({ kind: "amount-differs", explains: -1_350_000 });
    expect(result.unexplained).toBe(0);
  });

  it("finds an entry made twice", () => {
    const twice = [...ledger, spend("2026-09-02", 400_000, "Food", "groceries")];
    const result = investigate({
      transactions: twice,
      account: "Maya",
      actual: 5_000_000,
      asOf: "2026-09-10",
      statement: [statement[0]!, statement[2]!],
    });
    expect(result.found.map((c) => c.kind)).toEqual(["duplicate"]);
    expect(result.explained).toBe(result.gap);
  });

  it("finds a row that is not on the statement, as a place to look, not a verdict", () => {
    const elsewhere = [...ledger, spend("2026-09-03", 250_000, "Food", "lunch")];
    const result = investigate({
      transactions: elsewhere,
      account: "Maya",
      actual: 5_000_000,
      asOf: "2026-09-10",
      statement: [statement[0]!, statement[2]!],
    });
    expect(result.found.map((c) => c.kind)).toEqual(["not-on-statement"]);
    expect(result.explained).toBe(-250_000);
    expect(investigationWords(result).lines.join(" ")).toContain("another account");
  });

  it("matches a transfer and its fee listed as two lines", () => {
    const sent = [...ledger, row({ date: "2026-09-07", type: "Transfer", category: "", item: "", fromWallet: "Maya", toWallet: "Gcash", amount: 100_000, fee: 1_500, total: 101_500 })];
    const result = investigate({
      transactions: sent,
      account: "Maya",
      actual: 5_000_000 - 101_500,
      asOf: "2026-09-10",
      statement: [
        statement[0]!,
        statement[2]!,
        { date: "2026-09-07", amount: -100_000, description: "Send to Gcash" },
        { date: "2026-09-07", amount: -1_500, description: "Transfer fee" },
      ],
    });
    expect(result.gap).toBe(0);
    expect(result.found).toEqual([]);
  });

  it("says the rest is older than the statement when the history does not reach it", () => {
    const result = investigate({
      transactions: ledger,
      account: "Maya",
      actual: 4_000_000,
      asOf: "2026-09-10",
      statement: [statement[0]!, statement[2]!],
    });
    expect(result.unexplained).toBe(1_000_000);
    expect(investigationWords(result).lines.join(" ")).toMatch(/before|could be/);
  });
});

describe("with the ledger alone", () => {
  it("offers the rows that add up to the gap exactly, as possibilities", () => {
    const result = investigate({ transactions: ledger, account: "Maya", actual: 6_000_000, asOf: "2026-09-10" });
    expect(result.gap).toBe(-1_000_000);
    expect(result.found).toEqual([]);
    const together = result.possible.find((c) => c.kind === "together");
    expect(together && together.kind === "together" ? together.rows.map((r) => r.item).sort() : []).toEqual(["Bills", "Food"]);
  });

  it("reads a cash gap as days of spending nobody wrote down", () => {
    const cash: Transaction[] = [
      income("2026-08-01", 2_000_000, "Allowance", "Cash"),
      ...Array.from({ length: 30 }, (_, i) =>
        spend(`2026-08-${String(i + 2).padStart(2, "0")}`, 20_000 + i, "Food", `meal ${i}`, "Cash"),
      ),
    ];
    const recorded = walletBalance(cash, "Cash");
    const result = investigate({ transactions: cash, account: "Cash", actual: recorded - 60_000, asOf: "2026-08-31" });
    const clue = result.possible.find((c) => c.kind === "cash");
    expect(clue && clue.kind === "cash" ? clue.days : 0).toBeGreaterThanOrEqual(2);
  });

  it("never treats an e-wallet called Gcash as cash", () => {
    const g = [income("2026-08-01", 500_000, "Allowance", "Gcash"), spend("2026-08-10", 30_000, "Food", "lunch", "Gcash")];
    const result = investigate({ transactions: g, account: "Gcash", actual: 400_000, asOf: "2026-08-31" });
    expect(result.possible.some((c) => c.kind === "cash")).toBe(false);
  });

  it("never offers rows that moved money the other way from the gap", () => {
    const mixed = [...ledger, income("2026-09-05", 1_000_000, "Refund")];
    // The ledger is ₱10,000.00 too high: only money recorded as coming in can explain that.
    const result = investigate({ transactions: mixed, account: "Maya", actual: 5_000_000, asOf: "2026-09-10" });
    for (const clue of result.possible) {
      if (clue.kind === "together") for (const r of clue.rows) expect(movedOn(r, "Maya")).toBeGreaterThan(0);
    }
    expect(result.possible.some((c) => c.kind === "together" && c.rows[0]?.item === "Refund")).toBe(true);
  });

  it("says when the ledger and the account agree", () => {
    const result = investigate({ transactions: ledger, account: "Maya", actual: 5_000_000, asOf: "2026-09-10" });
    expect(investigationWords(result).headline).toContain("matches");
  });

  it("never counts a row dated after the balance was read", () => {
    const later = [...ledger, spend("2026-09-20", 999_900, "Food")];
    expect(investigate({ transactions: later, account: "Maya", actual: 5_000_000, asOf: "2026-09-10" }).gap).toBe(0);
  });
});

describe("the arithmetic under it", () => {
  it("finds the fewest rows adding to a figure, and nothing for a figure no rows make", () => {
    const values = [300, 700, 1_000, 2_000].map((value, i) => ({ row: row({ id: `v${i}` }), value }));
    expect(rowsAddingTo(values, 1_000)[0]?.map((r) => r.id)).toEqual(["v2"]);
    expect(rowsAddingTo(values, 2_300)[0]).toHaveLength(2);
    expect(rowsAddingTo(values, 4_000)[0]).toHaveLength(4);
    expect(rowsAddingTo(values, 4_000, 3, 2)).toEqual([]);
    expect(rowsAddingTo(values, 5)).toEqual([]);
  });

  it("recognises a figure mistyped by a digit", () => {
    expect(looksMistyped(150_000, 1_500_000)).toBe(true);
    expect(looksMistyped(54_000, 45_000)).toBe(true);
    expect(looksMistyped(54_000, 46_000)).toBe(false);
  });
});

describe("history pasted as text", () => {
  it("reads dates, figures and which way the money went", () => {
    const lines = readHistory(
      ["2026-09-03  Cinema  -5,000.00", "Sep 6 Travel booking 15000", "09/07/2026 Received from client +12,500", "Dinner in Makati 900", "no date here 500"].join("\n"),
      2026,
    );
    expect(lines).toEqual([
      { date: "2026-09-03", amount: -500_000, description: "Cinema" },
      { date: "2026-09-06", amount: -1_500_000, description: "Travel booking" },
      { date: "2026-09-07", amount: 1_250_000, description: "Received from client" },
    ]);
  });
});

describe("when it last matched, and money nobody wrote down", () => {
  /** Two hundred rows, all right, and one wrong one after the day it matched. */
  const busy: Transaction[] = [
    income("2026-06-01", 10_000_000, "Salary"),
    ...Array.from({ length: 200 }, (_, i) =>
      spend(`2026-0${6 + Math.floor(i / 70)}-${String(1 + (i % 28)).padStart(2, "0")}`, 5_000, "Food"),
    ),
  ];

  it("searches only what came after the day it matched", () => {
    const ledger = [...busy, spend("2026-09-15", 5_000, "Food", "lunch")];
    const matched = walletBalance(ledger.filter((t) => t.date <= "2026-09-14"), "Maya");
    const result = investigate({ transactions: ledger, account: "Maya", actual: matched, asOf: "2026-09-16", matchedOn: "2026-09-14" });
    expect(result.gap).toBe(-5_000);
    expect(result.movedSince).toEqual({ count: 1, into: 0, outOf: 5_000 });
    const together = result.possible.filter((c) => c.kind === "together");
    expect(together).toHaveLength(1);
    expect(together[0]?.kind === "together" && together[0].rows.map((r) => r.date)).toEqual(["2026-09-15"]);
    expect(investigationWords(result).lines[0]).toContain("Only those were searched");
  });

  it("offers interest, income or a loan coming back when the account holds more", () => {
    const recorded = walletBalance(ledger, "Maya");
    const result = investigate({ transactions: ledger, account: "Maya", actual: recorded + 22, asOf: "2026-09-16", matchedOn: "2026-09-15" });
    const extra = result.possible.find((c) => c.kind === "unrecorded");
    expect(extra).toMatchObject({ direction: "in", explains: -22 });
    const choices = extra ? choicesForClue(extra, "Maya", "2026-09-16", "Bank interest") : [];
    expect(choices.map((c) => c.label)).toEqual(["Add as interest", "Add as income", "Someone paid me back"]);
    expect(choices[0]?.draft).toMatchObject({ flow: "Revenue", toWallet: "Maya", item: "Bank interest", amount: 22 });
    expect(choices[2]?.draft).toMatchObject({ flow: "Debt", debtEffect: "collect", toWallet: "Maya", amount: 22 });
    // A few centavos arriving on their own are nearly always interest.
    expect(extra && draftForClue(extra, "Maya", "2026-09-16", "Bank interest")?.item).toBe("Bank interest");
  });

  it("finds an entry filed on the wrong account", () => {
    const filed = [...ledger, spend("2026-09-10", 250_000, "Travel", "bus ticket", "Gcash")];
    const recorded = walletBalance(filed, "Maya");
    const result = investigate({ transactions: filed, account: "Maya", actual: recorded - 250_000, asOf: "2026-09-16" });
    const wrong = result.possible.find((c) => c.kind === "wrong-account");
    expect(wrong).toMatchObject({ other: "Gcash", explains: 250_000 });
    expect(wrong && clueWords(wrong)).toContain("filed on Gcash");
  });
});
