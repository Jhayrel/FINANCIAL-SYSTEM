/**
 * A statement exported as the entries and the budget, the entries only, or
 * the budget only (owner, 10 November 2026: "allow in statement to export
 * budget only and statement only and combine"). Invented rows.
 */
import { describe, expect, it } from "vitest";

import { buildSheet } from "../domain/statementSheet";
import { budgetToCsv, buildStatementBetween, statementToCsv } from "../domain/statements";
import type { Budgets, ReferenceLists, Transaction } from "../domain/types";
import { INTER_BOLD, INTER_REGULAR } from "./fonts";
import { statementPdf } from "./statementPdf";
import { fromBase64, parseTtf } from "./writer";

const reference: ReferenceLists = { wallets: ["Cash"], savings: [], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [] };
let n = 0;
const row = (date: string, item: string, amount: number, description: string): Transaction =>
  ({ id: `p${(n += 1)}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item, description, amount, fee: 0, total: amount, notes: "", status: "Paid" }) as Transaction;
const rows = [row("2026-10-05", "Snacks", 40_000, "Corner shop"), row("2026-10-09", "Fare", 12_000, "Jeep to class")];
const budgets = { "2026": { spending: Array.from({ length: 12 }, (_, k) => (k === 9 ? 500_000 : 0)), billsSubs: Array(12).fill(0) } } as unknown as Budgets;
const sheet = buildSheet(rows, { type: "expense", year: 2026, fromMonth: 10, toMonth: 10, asOf: "2026-11-10" }, reference, [], budgets);

const latin1 = new TextDecoder("latin1");
const regular = parseTtf(fromBase64(INTER_REGULAR), "Inter-Regular");
const bold = parseTtf(fromBase64(INTER_BOLD), "Inter-Bold");
const hex = (text: string, f = regular): string => [...text].map((ch) => (f.cmap.get(ch.codePointAt(0)!) ?? 0).toString(16).padStart(4, "0")).join("");
const pdf = async (part?: "both" | "statement" | "budget"): Promise<string> =>
  latin1.decode(await statementPdf({ sheet, issuedTo: "", issuedBy: "", issuedAt: new Date(2026, 10, 10, 9, 0), compress: false, ...(part ? { part } : {}) }));

describe("what a statement download holds", () => {
  it("has a budget to give for this period", () => {
    expect(sheet.budget?.months.length).toBe(1);
  });
  it("both, by default: the entries and the budget", async () => {
    const text = await pdf();
    expect(text).toContain(hex("Corner shop"));
    expect(text).toContain(hex("Spent"));
  });
  it("the statement only: the entries, no budget", async () => {
    const text = await pdf("statement");
    expect(text).toContain(hex("Corner shop"));
    expect(text).not.toContain(hex("Spent"));
  });
  it("the budget only: headed Budget, no entries", async () => {
    const text = await pdf("budget");
    expect(text).not.toContain(hex("Corner shop"));
    expect(text).toContain(hex("Spent"));
    expect(text).toContain(hex("BUDGET", bold));
  });
  it("and the same three in the CSV", () => {
    const statement = buildStatementBetween(rows, "expense", sheet.from, sheet.to, reference);
    expect(statementToCsv(statement, sheet.budget)).toContain("Month,Part,Budget,Spent,Left");
    expect(statementToCsv(statement, null)).not.toContain("Month,Part,Budget,Spent,Left");
    const only = budgetToCsv(sheet.budget!);
    expect(only.startsWith("Month,Part,Budget,Spent,Left")).toBe(true);
    expect(only).not.toContain("Corner shop");
  });
});
