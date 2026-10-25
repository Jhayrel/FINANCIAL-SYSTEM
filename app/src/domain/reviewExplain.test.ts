/**
 * Needs review, explained, and kept without moving money (26 October 2026:
 * "my balance is already correct ... I am confused what am I reviewing").
 * Rows are invented.
 */
import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { checkIntegrity, KEPT_NOTE } from "./integrity";
import { explainFlag, flagSummary } from "./reviewExplain";
import { costOf } from "./totals";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction>): Transaction => ({
  id: `t-${over.recordNumber ?? 1}`, recordNumber: over.recordNumber ?? 1, date: "2026-09-01", type: "Spending", fromWallet: "Maya", toWallet: "",
  category: "Spending", item: "Food", description: "", amount: 10000, fee: 0, total: 10000, notes: "", status: "Paid", ...over,
});

const wallets = ["Cash", "Maya"];
const ledger: Transaction[] = [
  row({ recordNumber: 1, type: "Revenue", fromWallet: "", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 500000, total: 500000, status: "Received" }),
  row({ recordNumber: 2, date: "2026-09-20", type: "Transfer", fromWallet: "Maya", toWallet: "Cash", category: "", item: "", description: "Withdrawal", amount: 101800, total: 101800, status: "Withdrawn" }),
];

const flagsOf = (rows: readonly Transaction[], id: string) => checkIntegrity(rows, { wallets }).filter((i) => i.severity !== "info" && i.ids.includes(id));

describe("a flagged row, explained", () => {
  it("says what was noticed, why it matters, and what each choice does", () => {
    const issues = flagsOf(ledger, "t-2");
    expect(issues.map((i) => i.code)).toContain("fee-inside-withdrawal");
    const e = explainFlag(ledger[1]!, issues, ledger, { wallets, asOf: "2026-10-26" });
    expect(e.problems[0]?.why).toContain("Cash counts the fee as cash you have");
    expect(e.keep).toContain("Nothing moves: no balance, no spending and no budget changes.");
    expect(e.fix).toMatch(/Cash goes down/);
    expect(flagSummary(issues)).toContain("Tap for what it means");
  });

  it("keeps it with a note and nothing else: every balance and every cost the same, and the flag gone", () => {
    const e = explainFlag(ledger[1]!, flagsOf(ledger, "t-2"), ledger, { wallets, asOf: "2026-10-26" });
    expect(e.kept).toHaveLength(1);
    const after = ledger.map((t) => e.kept.find((k) => k.id === t.id) ?? t);
    for (const w of wallets) expect(walletBalance(after, w)).toBe(walletBalance(ledger, w));
    expect(after.map(costOf)).toEqual(ledger.map(costOf));
    expect(e.kept[0]).toEqual({ ...ledger[1], notes: KEPT_NOTE });
    expect(flagsOf(after, "t-2")).toEqual([]);
  });

  it("keeps rows flagged together, together", () => {
    const thin: Transaction[] = [
      row({ recordNumber: 1, type: "Revenue", fromWallet: "", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 10000, total: 10000, status: "Received" }),
      row({ recordNumber: 2, date: "2026-09-26", amount: 8000, total: 8000 }),
      row({ recordNumber: 3, date: "2026-09-26", amount: 5000, total: 5000 }),
      row({ recordNumber: 4, date: "2026-09-27", type: "Revenue", fromWallet: "", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 10000, total: 10000, status: "Received" }),
    ];
    const issues = flagsOf(thin, "t-2");
    expect(issues.map((i) => i.code)).toContain("below-zero-day");
    const e = explainFlag(thin[1]!, issues, thin, { wallets, asOf: "2026-10-26" });
    expect(e.keepRows.map((t) => t.recordNumber).sort()).toEqual([2, 3]);
    expect(e.keep).toContain("flagged together with #0003");
    const after = thin.map((t) => e.kept.find((k) => k.id === t.id) ?? t);
    expect(checkIntegrity(after, { wallets }).filter((i) => i.code === "below-zero-day")).toEqual([]);
  });

  it("will not keep a row the database would refuse, and says why", () => {
    const off = row({ recordNumber: 5, amount: 10000, fee: 0, total: 12000 });
    const rows = [...ledger, off];
    const e = explainFlag(off, flagsOf(rows, "t-5"), rows, { wallets, asOf: "2026-10-26" });
    expect(e.kept).toEqual([]);
    expect(e.keep).toContain("the database refuses that");
  });
});
