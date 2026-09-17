/**
 * A savings app that pays interest twice a day, read off a screenshot.
 *
 * The owner's screen lists "Net base interest ₱0.10" and "Net boosted
 * interest ₱0.12" for every day. The figures here are in that shape and
 * invented.
 */

import { describe, expect, it } from "vitest";

import { buildChart, chartDirection } from "./charts";
import { emptyDraft } from "./entry";
import { REFERENCE } from "./eval/corpus";
import { foldInterest, lastInterestInto } from "./interestFold";
import type { Proposal } from "./proposal";
import type { Transaction } from "./types";

const SAVINGS = "Maya Bank (Personal savings)";

const credit = (date: string, centavos: number, description: string): Proposal => ({
  draft: { ...emptyDraft(date), flow: "Revenue", category: "Revenue", toWallet: SAVINGS, item: "Bank interest", description, amount: centavos, status: "Received" },
  confidence: "high",
  sourceRef: "Image 1",
  adjustments: [],
});

const week = [14, 15, 16].flatMap((day) => [
  credit(`2026-09-${day}`, 10, "Net base interest"),
  credit(`2026-09-${day}`, 12, "Net boosted interest"),
]);

const recorded = (date: string, amount: number): Transaction => ({
  id: `r-${date}`,
  recordNumber: 1,
  date,
  type: "Revenue",
  fromWallet: "",
  toWallet: SAVINGS,
  category: "Revenue",
  item: "Bank interest",
  description: "",
  amount,
  fee: 0,
  total: amount,
  notes: "",
  status: "Received",
});

describe("interest credits from a savings screen", () => {
  it("adds six credits into one entry for their exact total, dated the last day", () => {
    const folded = foldInterest(week, [], REFERENCE);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.draft).toMatchObject({ amount: 66, date: "2026-09-16", toWallet: SAVINGS, item: "Bank interest" });
    expect(folded[0]?.draft.notes).toContain("6 credits");
    expect(folded[0]?.adjustments[0]).toContain("same as adding each");
  });

  it("leaves out the days the ledger already has", () => {
    const ledger = [recorded("2026-09-14", 22)];
    expect(lastInterestInto(ledger, SAVINGS)).toBe("2026-09-14");
    const folded = foldInterest(week, ledger, REFERENCE);
    expect(folded[0]?.draft.amount).toBe(44);
    expect(folded[0]?.adjustments.join(" ")).toContain("2 credits dated on or before");
  });

  it("leaves one or two credits as they are, and everything else untouched", () => {
    const other: Proposal = { ...credit("2026-09-16", 50000, "Salary"), draft: { ...credit("2026-09-16", 50000, "Salary").draft, item: "Allowance", description: "Allowance" } };
    const folded = foldInterest([week[0] as Proposal, week[1] as Proposal, other], [], REFERENCE);
    expect(folded).toHaveLength(3);
  });
});

describe("a chart's colour follows its money", () => {
  const rows: Transaction[] = [recorded("2026-09-10", 100000), { ...recorded("2026-09-11", 20000), id: "s", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food" }];

  it("draws income for a misspelt follow-up carried with the chart before it", () => {
    const chart = buildChart("revenu Spending by month, 2026", rows, "2026-09-17");
    expect(chart && chartDirection(chart)).toBe("revenue");
    expect(chart?.total).toBe(100000);
  });

  it("reads the direction of a chart stored before it was recorded", () => {
    const spending = buildChart("chart my spending this month", rows, "2026-09-17");
    expect(spending && chartDirection(spending)).toBe("spending");
    expect(chartDirection({ title: "Income by item, September 2026", by: "item", kind: "bars", rows: [], total: 0, othersCount: 0 })).toBe("revenue");
  });
});
