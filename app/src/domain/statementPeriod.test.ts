/**
 * A statement says exactly the days it covers, and a question about one is
 * answered, never mistaken for a request for another.
 *
 * The owner, 4 October 2026, of "Give me account statement all 2022 to
 * today": the PDF said "January 2022 to October 2026" and brought a balance
 * forward on Jan 1, 2022, four months before the first entry. "Can you be
 * specific? Like look it say January like make sure its align." Then "What
 * do you think about that statement?" was offered a new statement for 2026:
 * "Fix the reasoning". Every figure here is invented.
 */

import { describe, expect, it } from "vitest";

import { asksAboutAFile, readExportAsk, sheetRequestOf, statementBrief, statementWords, withSheet } from "./exportAsk";
import { buildSheet, fitPeriod } from "./statementSheet";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};
const ASOF = "2026-10-04";

let n = 0;
const tx = (date: string, over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 10000;
  return { id: `t${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", amount, fee: 0, total: amount, notes: "", status: "Paid", ...over };
};
const income = (date: string, amount: number): Transaction =>
  tx(date, { type: "Revenue", fromWallet: "", toWallet: "Gcash", category: "Revenue", item: "Allowance", amount, total: amount, status: "Received", description: "Allowance" });

const ledger: Transaction[] = [
  income("2022-05-01", 500000),
  tx("2022-05-02", { amount: 9000, description: "Lunch" }),
  income("2023-03-01", 800000),
  tx("2024-06-10", { amount: 250000, fromWallet: "Gcash", description: "Laptop repair" }),
  income("2026-01-15", 600000),
  tx("2026-10-02", { amount: 12000, description: "Groceries" }),
];

describe("the days a statement covers", () => {
  it("starts at the month of the first entry and ends today", () => {
    expect(fitPeriod(ledger, "account", "2022-01-01", "2026-10-31", reference, ASOF)).toEqual({
      from: "2022-05-01",
      to: "2026-10-04",
      startsLater: true,
      endsToday: true,
    });
  });

  it("leaves a period inside the ledger as it was asked", () => {
    expect(fitPeriod(ledger, "account", "2023-01-01", "2023-12-31", reference, ASOF)).toEqual({ from: "2023-01-01", to: "2023-12-31", startsLater: false, endsToday: false });
  });

  it("starts at the first entry of the statement's own kind", () => {
    // The first spending is 2 May 2022, the first income 1 May: both in May.
    expect(fitPeriod(ledger, "expense", "2022-01-01", "2022-12-31", reference, ASOF).from).toBe("2022-05-01");
    // No income before March 2023 in a 2023 statement: it starts with the year as asked.
    expect(fitPeriod(ledger, "revenue", "2023-01-01", "2023-12-31", reference, ASOF).startsLater).toBe(false);
  });

  it("never moves the start past the end when nothing is in the period", () => {
    expect(fitPeriod(ledger, "account", "2021-01-01", "2021-12-31", reference, ASOF)).toMatchObject({ from: "2021-01-01", to: "2021-12-31", startsLater: false });
  });
});

describe("\"Give me account statement all 2022 to today\"", () => {
  const ask = readExportAsk("Give me account statement all 2022 to today", ASOF)!;
  const sheet = buildSheet(ledger, sheetRequestOf(ask, ASOF), reference);

  it("says the exact days on the statement, and brings forward on the first one", () => {
    expect(sheet.period).toBe("May 1, 2022 to October 4, 2026");
    expect(sheet.from).toBe("2022-05-01");
    expect(sheet.to).toBe("2026-10-04");
    expect(sheet.broughtForward).toBe(0);
    expect(sheet.lines[0]?.date).toBe("2022-05-01");
  });

  it("tells the owner which statement, the days, and what is in it", () => {
    expect(statementWords(sheet)).toBe(
      "Account statement, May 1, 2022 to October 4, 2026 (today), as a PDF. 6 entries: money in ₱19,000.00, money out ₱2,710.00, balance ₱16,290.00 at the end. Nothing is recorded before May 1, 2022, so it starts there.",
    );
  });

  it("keeps the days on the card, so the file saved later is the one described", () => {
    const offered = withSheet(ask, sheet);
    expect(offered).toMatchObject({ fromDate: "2022-05-01", toDate: "2026-10-04", summary: "May 1, 2022 to October 4, 2026 (today) · 6 entries" });
    expect(buildSheet(ledger, sheetRequestOf(offered, ASOF), reference).period).toBe("May 1, 2022 to October 4, 2026");
  });

  it("says this year's revenue to the day too", () => {
    const revenue = readExportAsk("I need revenue statement for this year", ASOF)!;
    const sheetOf = buildSheet(ledger, sheetRequestOf(revenue, ASOF), reference);
    expect(sheetOf.period).toBe("January 1 to October 4, 2026");
    expect(statementWords(sheetOf)).toBe("Revenue sheet, January 1 to October 4, 2026 (today), as a PDF. 1 entry: income ₱6,000.00.");
  });

  it("keeps whole months as months when nothing was cut", () => {
    const past = buildSheet(ledger, sheetRequestOf(readExportAsk("account statement for 2023", ASOF)!, ASOF), reference);
    expect(past.period).toBe("January to December 2023");
  });
});

describe("a question about the statement just made", () => {
  it("is a question, never a new statement", () => {
    for (const said of [
      "What do you think about that statement?",
      "what do you think about the statement",
      "Is that statement right?",
      "explain my statement",
      "anything wrong with this statement?",
      "can you check that pdf",
    ]) {
      expect(asksAboutAFile(said), said).toBe(true);
      expect(readExportAsk(said, ASOF), said).toBeNull();
    }
  });

  it("still makes a file when one is asked for again", () => {
    for (const said of ["Give me account statement all 2022 to today", "send me that statement again", "I need revenue statement for this year", "export my september spending as csv"]) {
      expect(asksAboutAFile(said), said).toBe(false);
      expect(readExportAsk(said, ASOF), said).not.toBeNull();
    }
  });

  it("says what was brought forward when the statement starts with money held", () => {
    const later = buildSheet(ledger, sheetRequestOf(readExportAsk("account statement for 2024 to today", ASOF)!, ASOF), reference);
    expect(statementWords(later)).toContain("brought forward ₱12,910.00, money in");
  });

  it("gives the model the statement's own figures to answer from", () => {
    const sheet = buildSheet(ledger, sheetRequestOf(readExportAsk("Give me account statement all 2022 to today", ASOF)!, ASOF), reference);
    const brief = statementBrief(sheet);
    expect(brief).toContain("The statement they mean: Account statement, May 1, 2022 to October 4, 2026 (today).");
    expect(brief).toContain("6 entries: money in ₱19,000.00, money out ₱2,710.00, balance ₱16,290.00 at the end.");
    expect(brief).toContain("By year: 2022, 2 entries, ₱5,000.00 money in, ₱90.00 money out;");
    // Said to the owner when no model answers, in their words rather than the model's.
    expect(statementBrief(sheet, true)).toMatch(/^Your account statement, May 1, 2022 to October 4, 2026 \(today\)\./);
    expect(brief).toContain("Largest money out: ₱2,500.00 on June 10, 2024, Laptop repair (#0004)");
  });
});
