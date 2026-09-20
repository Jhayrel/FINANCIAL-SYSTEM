import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { actionableIssues, checkIntegrity, summarise, type IssueCode } from "./integrity";
import type { Transaction } from "./types";

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

  /**
   * SYSTEM-ANALYSIS defect 6: 64 rows have a blank category and 63 a blank
   * item. The data fact is still true and still asserted here. What changed
   * on 20 September 2026 is the verdict on it: every one of those rows is a
   * transfer or a debt row, where both fields are blank by design, and the
   * sentence attached to them ("excluded from category totals") was false,
   * because a transfer was never in those totals to be excluded from. The
   * checker reported 127 things that are not wrong against three that are.
   *
   * The count stays visible so the underlying data is not hidden by the fix.
   */
  it("still has the workbook's blank category and item rows, and calls none of them a fault", () => {
    const blankCategory = fx.transactions.filter((t) => !t.category);
    const blankItem = fx.transactions.filter((t) => !t.item);
    expect(blankCategory).toHaveLength(64);
    expect(blankItem).toHaveLength(63);

    // Every one of them is a row where the field is blank on purpose.
    for (const t of [...blankCategory, ...blankItem]) {
      expect(t.type === "Transfer" || t.type === "Debt", `#${t.recordNumber} ${t.type}`).toBe(true);
    }

    expect(issues.filter((i) => i.code === "missing-category")).toEqual([]);
    expect(issues.filter((i) => i.code === "missing-item")).toEqual([]);
  });

  it("keeps informational notices out of the actionable list", () => {
    const actionable = actionableIssues(issues);
    expect(actionable.every((i) => i.severity !== "info")).toBe(true);
    expect(actionable.length).toBeLessThanOrEqual(issues.length);
  });

  it("summarises the misreported total", () => {
    const s = summarise(issues);
    expect(s.total).toBe(issues.length);
    expect(s.errors).toBe(0);
    expect(s.misreported).toBeGreaterThanOrEqual(30_00);
  });
});

/**
 * Every check, from both sides.
 *
 * A checker is two promises: it fires when something is wrong, and it stays
 * quiet when nothing is. The second is the one that decays, and the owner has
 * been on the receiving end of it: a warning sat on every written-off advance
 * and every fee added to a credit line, because both move no wallet by
 * design. So each code gets a row that must raise it and the whole clean
 * ledger that must raise nothing.
 */
describe("each check fires on its own fault, and on nothing else", () => {
  const row = (over: Partial<Transaction>): Transaction => ({
    id: "i1",
    recordNumber: 900,
    date: "2026-09-20",
    type: "Spending",
    fromWallet: "Maya",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    notes: "",
    status: "Paid",
    ...over,
  });

  const FAULTS: [IssueCode, Transaction][] = [
    ["total-mismatch", row({ total: 9999 })],
    ["negative-amount", row({ amount: -100, total: -100 })],
    ["uncategorised-fee", row({ type: "Transfer", toWallet: "Gcash", category: "Transfer", item: "", fee: 1500, total: 11500 })],
    ["fee-row-with-amount", row({ item: "Transaction Fee" })],
    ["missing-category", row({ category: "" })],
    ["missing-item", row({ item: "" })],
    ["no-wallet", row({ fromWallet: "", toWallet: "" })],
    ["spending-without-source", row({ fromWallet: "" })],
    ["revenue-without-destination", row({ type: "Revenue", category: "Revenue", fromWallet: "", toWallet: "" })],
    ["transfer-same-wallet", row({ type: "Transfer", category: "Transfer", toWallet: "Maya" })],
  ];

  for (const [code, faulty] of FAULTS) {
    it(`raises ${code}`, () => {
      expect(checkIntegrity([faulty]).map((i) => i.code)).toContain(code);
    });
  }

  it("raises duplicate-record-number, which is about two rows rather than one", () => {
    const twice = [row({ id: "a" }), row({ id: "b" })];
    const found = checkIntegrity(twice).filter((i) => i.code === "duplicate-record-number");
    expect(found).toHaveLength(1);
    expect(found[0]!.ids).toEqual(["a", "b"]);
  });

  it("says nothing at all about a row that is right", () => {
    expect(checkIntegrity([row({})])).toEqual([]);
  });

  /*
   * The rows that move no wallet on purpose. A lender's charge and a write
   * off change what is owed and touch no balance, and an on-behalf write off
   * is spending without a wallet for the same reason.
   */
  it("stays quiet about a charge and a write off, which move no wallet by design", () => {
    const charge = row({ type: "Debt", category: "", item: "Maya Credit", fromWallet: "", toWallet: "", debtId: "maya-credit", debtEffect: "charge", status: "" });
    const writeoff = row({ type: "Debt", category: "Spending", item: "Treat", fromWallet: "", toWallet: "", debtId: "stephen", debtEffect: "writeoff", status: "" });

    expect(checkIntegrity([charge]).map((i) => i.code)).toEqual([]);
    expect(checkIntegrity([writeoff]).map((i) => i.code)).toEqual([]);
  });

  it("stays quiet about a transfer that carries its fee correctly", () => {
    const clean = row({ type: "Transfer", toWallet: "Gcash", category: "Spending", item: "Transaction Fee", fee: 1500, total: 11500 });
    expect(checkIntegrity([clean])).toEqual([]);
  });

  /*
   * The real ledger is the widest silence test there is: 440 rows the owner
   * typed over months, on which the only findings are the two the workbook
   * really does have.
   */
  it("finds nothing new in the ledger it was written against", () => {
    const codes = new Set(checkIntegrity(fx.transactions).map((i) => i.code));
    expect([...codes].sort()).toEqual(["fee-row-with-amount", "uncategorised-fee"]);
  });
});
