/**
 * One figure per question, on the owner's own ledger.
 *
 * The Insights panel drew the six largest kinds of spending under a "Went
 * out" that counted every kind, so September 1 to 15 showed ₱13,255.00 of
 * bars under ₱13,968.36, and nothing on screen said the two were different
 * sums. These run the calendar, its panel and the month in brief over every
 * month of the Excel ledger and require them to agree to the centavo.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { rangeReport } from "./dayRange";
import { firstOfMonth, lastOfMonth } from "./dates";
import { monthBrief } from "./monthPlan";
import { costOf } from "./totals";
import type { Budgets } from "./types";

const fx = loadFixture();
const AS_OF = "2026-08-29";
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8];

describe("the calendar, its panel and the month in brief agree", () => {
  for (const month of MONTHS) {
    const range = { start: firstOfMonth(2026, month), end: lastOfMonth(2026, month) };
    const report = rangeReport({ transactions: fx.transactions, reference: fx.reference, debts: [], range, asOf: AS_OF });

    it(`2026-${String(month).padStart(2, "0")}: every kind of spending adds up to what went out`, () => {
      expect(report.kinds.reduce((sum, k) => sum + k.amount, 0)).toBe(report.spent);
    });

    it(`2026-${String(month).padStart(2, "0")}: the calendar's days add up to the month`, () => {
      const days = fx.transactions
        .filter((t) => t.date >= range.start && t.date <= range.end)
        .reduce((sum, t) => sum + Math.max(0, costOf(t)), 0);
      expect(days).toBe(report.spent);
    });

    it(`2026-${String(month).padStart(2, "0")}: went out and came in match the month in brief`, () => {
      const brief = monthBrief({
        transactions: fx.transactions,
        reference: fx.reference,
        budgets: {} as Budgets,
        debts: [],
        year: 2026,
        month,
        asOf: AS_OF,
      });
      expect(report.spent).toBe(brief.wentOut);
      expect(report.cameIn).toBe(brief.cameIn);
    });
  }

  it("keeps the documented August figure", () => {
    const august = rangeReport({
      transactions: fx.transactions,
      reference: fx.reference,
      debts: [],
      range: { start: "2026-08-01", end: "2026-08-31" },
      asOf: AS_OF,
    });
    // CLAUDE.md, "Known figures": August 2026 total spend.
    expect(august.spent).toBe(1129137);
  });
});
