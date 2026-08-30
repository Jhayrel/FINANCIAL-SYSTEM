import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { actionableIssues, checkIntegrity, summarise } from "./integrity";

const fx = loadFixture();
const issues = checkIntegrity(fx.transactions);

describe("integrity check against the real ledger", () => {
  it("finds exactly the two uncategorised transfer fees behind the ₱30 gap", () => {
    const fees = issues.filter((i) => i.code === "uncategorised-fee");

    expect(fees).toHaveLength(2);
    expect(fees.flatMap((i) => i.recordNumbers).sort((a, b) => a - b)).toEqual([8, 190]);

    // Their combined impact is precisely the TOTAL FUNDS discrepancy.
    const impact = fees.reduce((acc, i) => acc + (i.impact ?? 0), 0);
    expect(impact).toBe(30_00);
    expect(impact).toBe(fx.expected.summary.totalFunds - 764003);
  });

  it("flags only the genuinely mis-filed fee row, not ordinary transfers", () => {
    const misfiled = issues.filter((i) => i.code === "fee-row-with-amount");

    // Record #280 alone: a Spending row labelled "Transaction Fee" carrying
    // ₱4,000 in the amount column. The 26 Transfer rows that also carry an
    // amount are correct: there the item labels what the fee was for.
    expect(misfiled).toHaveLength(1);
    expect(misfiled[0]!.recordNumbers).toEqual([280]);
  });

  it("keeps the actionable list to the three real defects", () => {
    // The whole point of this module: 440 records, three things worth fixing.
    expect(actionableIssues(issues)).toHaveLength(3);
  });

  it("confirms the total = amount + fee invariant holds for every row", () => {
    expect(issues.filter((i) => i.code === "total-mismatch")).toHaveLength(0);
  });

  it("finds no negative amounts", () => {
    expect(issues.filter((i) => i.code === "negative-amount")).toHaveLength(0);
  });

  it("finds no duplicate record numbers", () => {
    expect(issues.filter((i) => i.code === "duplicate-record-number")).toHaveLength(0);
  });

  it("reports the known blank-category and blank-item rows as informational", () => {
    // 64 rows have no category and 63 no item: see SYSTEM-ANALYSIS defect 6.
    expect(issues.filter((i) => i.code === "missing-category")).toHaveLength(64);
    expect(issues.filter((i) => i.code === "missing-item")).toHaveLength(63);
  });

  it("keeps informational noise out of the actionable list", () => {
    const actionable = actionableIssues(issues);
    expect(actionable.every((i) => i.severity !== "info")).toBe(true);
    expect(actionable.length).toBeLessThan(issues.length);
  });

  it("summarises the misreported total", () => {
    const s = summarise(issues);
    expect(s.total).toBe(issues.length);
    expect(s.errors).toBe(0);
    expect(s.misreported).toBeGreaterThanOrEqual(30_00);
  });
});
