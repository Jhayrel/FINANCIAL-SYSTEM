import { describe, expect, it } from "vitest";

import { buildPlanSheet, planSheetCsv } from "./planSheet";
import { linkPayments, makePlan, NO_DATE, removePlan, skipPlan, type PlanInput } from "./planner";
import type { Transaction } from "./types";

const asOf = "2026-10-27";
const base: PlanInput = { title: "Tuition", amount: 900_000, due: "2026-11-15", item: "School", wallet: "Maya", need: true, setAside: true, notes: "" };
const paidRow: Transaction = { id: "t1", recordNumber: 3933, date: "2026-10-09", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Travel", description: "Trip", amount: 933_700, fee: 0, total: 933_700, notes: "", status: "Paid" };
const ctx = { transactions: [paidRow], accounts: [], asOf };

const tuition = makePlan(base, asOf, "owner", "p1");
const trip = linkPayments(makePlan({ ...base, title: "Trip", amount: 933_700, due: "2026-10-10", item: "Travel" }, asOf, "owner", "p2"), ["t1"], [paidRow], asOf);
const concert = skipPlan(makePlan({ ...base, title: "Concert", amount: 450_000, due: "2026-10-18", need: false }, "2026-10-01", "owner", "p3"), asOf, "Sold out");
const gone = removePlan(makePlan({ ...base, title: "Old", due: "2026-10-20" }, "2026-10-01", "owner", "p4"), asOf);
const laptop = makePlan({ ...base, title: "Laptop", amount: 3_500_000, due: NO_DATE, dueKind: "none" }, asOf, "owner", "p5");

describe("the Plans statement (owner, 27 October 2026: \"in statement add plans too\")", () => {
  const sheet = buildPlanSheet([tuition, trip, concert, gone, laptop], ctx, { from: "2026-10-01", to: "2026-11-30" }, "October to November 2026");

  it("lists the plans by their day, removed ones left out, no date last", () => {
    expect(sheet.lines.map((l) => l.description)).toEqual(["Trip", "Concert", "Tuition", "Laptop"]);
    expect(sheet.lines.map((l) => l.kind)).toEqual(["Paid", "Skipped", "Open", "Open"]);
    expect(sheet.lines[3]?.date).toBe("");
  });

  it("adds up planned, paid and what is still to pay, a skipped plan owing nothing", () => {
    expect(sheet.totalIn).toBe(933_700 + 450_000 + 900_000 + 3_500_000);
    expect(sheet.totalOut).toBe(933_700);
    expect(sheet.closing).toBe(900_000 + 3_500_000);
    expect(sheet.lines[0]?.detail).toMatch(/paid by #3933/);
    expect(sheet.notes.join(" ")).toMatch(/A plan is not an entry/);
  });

  it("leaves the plans with no date out of a period that ended before today", () => {
    const past = buildPlanSheet([tuition, laptop], ctx, { from: "2026-01-01", to: "2026-09-30" }, "January to September 2026");
    expect(past.lines).toEqual([]);
  });

  it("is a spreadsheet with a total line", () => {
    const csv = planSheetCsv(sheet).split("\r\n");
    expect(csv[0]).toBe("Due,Plan,State,Pay from,Planned,Paid,Still to pay,Details");
    expect(csv).toContain("No date yet,Laptop,Open,Maya,35000.00,0.00,35000.00,No date yet · School");
    expect(csv.at(-2)).toBe(",Total,,,57837.00,9337.00,44000.00,");
  });
});
