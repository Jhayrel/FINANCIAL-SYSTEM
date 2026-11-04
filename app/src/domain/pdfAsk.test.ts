/**
 * The PDFs asked for in the chat, and the ones sent back to it (4 November
 * 2026: the owner had never tried the PDF feature). Invented rows.
 *
 * "Export my expenses last month as pdf" was the whole system as a
 * spreadsheet; "a pdf of my spending this month" was the year; "statement for
 * maya" was everything borrowed; "print my bills this year" and "gawa ka ng
 * pdf ng gastos ko last month" were not files at all; "pdf" after a breakdown
 * was the spreadsheet of everything; "pdf of my plans" held "0 entries".
 */
import { describe, expect, it } from "vitest";

import type { Debt } from "./debt";
import { fileOfAnswer, readExportAsk, withCut } from "./exportAsk";
import { ownFile, ownFileWords } from "./ownFile";
import { makePlan } from "./planner";
import { planSheetForAsk } from "./planSheet";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-04";

describe("a PDF asked for in words", () => {
  it("reads the period said: last month, this month, this year", () => {
    expect(readExportAsk("export my expenses last month as pdf", asOf)).toMatchObject({ kind: "statement", type: "expense", year: 2026, fromMonth: 10, toMonth: 10, format: "pdf" });
    expect(readExportAsk("can you make me a pdf of my spending this month", asOf)).toMatchObject({ kind: "statement", type: "expense", fromMonth: 11, toMonth: 11 });
    expect(readExportAsk("print my bills this year", asOf)).toMatchObject({ kind: "statement", type: "bills", fromMonth: 1, toMonth: 12 });
  });

  it("in Tagalog, and with no figure a spending word is not an entry", () => {
    expect(readExportAsk("gawa ka ng pdf ng gastos ko last month", asOf)).toMatchObject({ kind: "statement", type: "expense", fromMonth: 10, toMonth: 10 });
    expect(readExportAsk("save 500 gastos sa food as pdf", asOf)).toBeNull();
  });

  it("a PDF with nothing else said is the account statement; everything is every entry", () => {
    expect(readExportAsk("send me my transactions as pdf", asOf)).toMatchObject({ kind: "statement", type: "account", year: 2026, format: "pdf" });
    expect(readExportAsk("save everything as pdf", asOf)).toMatchObject({ kind: "statement", type: "account", year: 2000, toYear: 2026 });
    // Unchanged: the whole system as a spreadsheet, and the backup.
    expect(readExportAsk("export my data", asOf)?.kind).toBe("csv");
    expect(readExportAsk("backup", asOf)?.kind).toBe("backup");
  });

  it("the plans with no period said are left to the plans' own months; the Activity record is its own file", () => {
    const plans = readExportAsk("pdf of my plans", asOf);
    expect(plans).toMatchObject({ kind: "statement", type: "plans" });
    expect(plans?.fromMonth).toBeUndefined();
    expect(readExportAsk("export the activity log as pdf", asOf)).toMatchObject({ kind: "activity", format: "pdf" });
    expect(readExportAsk("activity this week as pdf", asOf)).toMatchObject({ kind: "activity", fromDate: "2026-11-02", toDate: "2026-11-04" });
  });
});

describe("'pdf' or 'export that' after an answer is a file of that answer", () => {
  it("takes the subject and the period from the question before", () => {
    expect(fileOfAnswer("pdf", "Can you give me a break down of expenses based on categories so I can do Budgeting last month", asOf)).toMatchObject({ type: "expense", fromMonth: 10, toMonth: 10, format: "pdf" });
    expect(fileOfAnswer("make it a pdf", "where did my money go last month", asOf)).toMatchObject({ type: "account", fromMonth: 10 });
    expect(fileOfAnswer("export that", "show me revenue last month", asOf)).toMatchObject({ type: "revenue", fromMonth: 10 });
    expect(fileOfAnswer("as csv please", "show me revenue last month", asOf)).toMatchObject({ type: "revenue", format: "csv" });
  });

  it("not for a request that names its own subject, nor with no question before", () => {
    expect(fileOfAnswer("pdf of my plans", "show me revenue last month", asOf)).toBeNull();
    expect(fileOfAnswer("pdf", undefined, asOf)).toBeNull();
    expect(fileOfAnswer("thanks", "show me revenue last month", asOf)).toBeNull();
  });
});

describe("a wallet named is that wallet's statement, before a debt that shares its first word", () => {
  const reference = { wallets: ["Cash", "Maya"], savings: ["Maya Bank (Personal savings)"], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [], stopped: [] } as unknown as ReferenceLists;
  const debts = [{ id: "maya-credit", name: "Maya Credit" }] as unknown as Debt[];
  const rows = [{ id: "t1", recordNumber: 1, date: "2026-10-02", type: "Spending", fromWallet: "Maya", toWallet: "", category: "Spending", item: "Transaction Fee", description: "", amount: 1500, fee: 0, total: 1500, notes: "", status: "Paid" }] as unknown as Transaction[];
  const cut = (said: string) => {
    const read = readExportAsk(said, asOf);
    return read ? withCut(read, rows, reference, debts) : null;
  };

  it("'statement for maya' is the Maya wallet; 'Maya Bank' the savings account", () => {
    expect(cut("statement for maya this year pdf")).toMatchObject({ type: "wallet", wallet: "Maya" });
    expect(cut("Maya Bank statement 2026")).toMatchObject({ type: "wallet", wallet: "Maya Bank (Personal savings)" });
    expect(cut("statement of what i owe maya credit")?.wallet).toBeUndefined();
  });

  it("'my transactions' is never cut to the Transaction Fee kind", () => {
    expect(cut("send me my transactions as pdf")).toMatchObject({ type: "account" });
    expect(cut("send me my transactions as pdf")?.only).toBeUndefined();
  });
});

describe("the plans statement the chat offers is the Planner's", () => {
  it("with no period said: from this month to the last month planned", () => {
    const plans = [
      makePlan({ title: "Gift", amount: 100_000, due: "2026-11-07", dueKind: "day", item: "", wallet: "", need: true, setAside: true, notes: "" }, asOf, "owner", "p1"),
      makePlan({ title: "Trip", amount: 300_000, due: "2026-12-20", dueKind: "day", item: "", wallet: "", need: false, setAside: true, notes: "" }, asOf, "owner", "p2"),
    ];
    const sheet = planSheetForAsk(plans, { transactions: [], accounts: [], asOf }, { year: 2026 });
    expect(sheet.from).toBe("2026-11-01");
    expect(sheet.to).toBe("2026-12-31");
    expect(sheet.lines).toHaveLength(2);
  });
});

describe("a file this app made, sent back, is said for what it is", () => {
  const made = "TRANSFERS Period October 2026 Date issued November 4, 2026, 3:31 AM Entries 3 Moved ₱1,500.00 Fees ₱15.00 Date Details Oct 2 Moved 500.00 Totals Amounts are in pesos (₱). **Nothing Follows** Financial Management System Transfers · October 2026 Page 1 of 1";

  it("reads the title, the period and the count", () => {
    expect(ownFile(made)).toEqual({ title: "Transfers", period: "October 2026", rows: 3 });
    expect(ownFileWords("transfers.pdf", ownFile(made)!)).toBe(
      "transfers.pdf is a statement this app made (Transfers, October 2026). It lists 3 rows. Everything in it is already in your ledger, so nothing in it is added. To see it again, ask for the same statement or open Statements.",
    );
  });

  it("the Activity record too; a bank's own statement is not this app's", () => {
    const trail = "ACTIVITY TRAIL everything kept Period November 4, 2026 Date issued November 4, 2026, 3:44 AM Changes 2 ... **Nothing Follows** Financial Management System";
    expect(ownFile(trail)).toMatchObject({ title: "Activity trail", rows: 2 });
    expect(ownFile("SAMPLE BANK STATEMENT OF ACCOUNT Period October 2026 Opening balance 1,000.00 Closing balance 900.00")).toBeNull();
  });
});
