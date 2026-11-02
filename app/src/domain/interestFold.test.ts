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
import { foldInterest, foldInterestWith, lastInterestInto } from "./interestFold";
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

describe("a daily interest list beside what the ledger holds (owner, 1 November 2026)", () => {
  // Ten days of a boosted and a base credit, as the owner's savings list shows them; the figures are invented.
  const days = ["10-23", "10-24", "10-25", "10-26", "10-27", "10-28", "10-29", "10-30", "10-31", "11-01"];
  const list = days.flatMap((d) => [credit(`2026-${d}`, 27, "Net boosted interest"), credit(`2026-${d}`, 23, "Net base interest")]);
  // Interest recorded as lump sums worked out from the balance, the last on October 27.
  const ledger: Transaction[] = [
    { ...recorded("2026-10-01", 350000), id: "open", type: "Transfer", fromWallet: "Maya", item: "", category: "" },
    { ...recorded("2026-10-24", 200), id: "i24" },
    { ...recorded("2026-10-27", 150), id: "i27" },
  ];
  const held = 350000 + 200 + 150;
  const balance = (amount: number) => [{ account: SAVINGS, amount, date: "2026-11-01", sourceRef: "Image 2" }];

  it("without a balance, adds only the days after the last recorded one, and says the rate", () => {
    const { proposals, notes } = foldInterestWith(list, ledger, REFERENCE);
    expect(notes).toEqual([]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.draft).toMatchObject({ amount: 250, date: "2026-11-01" });
    const said = proposals[0]?.adjustments.join(" ") ?? "";
    expect(said).toContain("10 credits dated on or before October 27, 2026 left out");
    expect(said).toContain("₱0.50 a day (₱0.27 boosted, ₱0.23 base), it earns about ₱15.00 a month");
  });

  it("with the balance in the same pictures, adds what the balance is short of and says why it differs from the list", () => {
    const { proposals } = foldInterestWith(list, ledger, REFERENCE, balance(held + 273));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.draft.amount).toBe(273);
    const said = proposals[0]?.adjustments.join(" ") ?? "";
    expect(said).toContain("so ₱2.73 is missing, where the list after the last recorded day adds up to ₱2.50");
    expect(said).toContain("The ₱0.23 more is interest an earlier entry did not hold.");
  });

  it("offers nothing when the balance already matches: every credit is counted", () => {
    const { proposals, notes } = foldInterestWith(list, ledger, REFERENCE, balance(held));
    expect(proposals).toEqual([]);
    expect(notes[0]).toContain("the same, so the interest in the list is counted already and nothing is added.");
  });

  it("says a list is counted already when every day is on or before the last recorded one", () => {
    const { proposals, notes } = foldInterestWith(list.slice(0, 10), ledger, REFERENCE);
    expect(proposals).toEqual([]);
    expect(notes[0]).toContain("all 10 credits are dated on or before October 27, 2026");
  });

  it("keeps one day's two credits as cards, but not when the ledger has that day already", () => {
    expect(foldInterestWith(list.slice(18), ledger, REFERENCE).proposals).toHaveLength(2);
    const old = foldInterestWith(list.slice(8, 10), ledger, REFERENCE);
    expect(old.proposals).toEqual([]);
    expect(old.notes[0]).toContain("in the ledger already");
  });

  it("never takes a balance far above the ledger for interest", () => {
    const { proposals, notes } = foldInterestWith(list, ledger, REFERENCE, balance(held + 500000));
    expect(proposals[0]?.draft.amount).toBe(250);
    expect(notes[0]).toContain("too much to be interest alone");
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
