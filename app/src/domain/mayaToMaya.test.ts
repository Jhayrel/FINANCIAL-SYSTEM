/**
 * 27 September 2026, 06:15: two Maya Credit borrowings of ₱2,000.00 saved as
 * "Maya -> Maya", each beside its fees row, both flagged "Record number 3813
 * is used by 2 transactions", and net worth down by the ₱4,000.00 borrowed
 * as well as the ₱302.06 of fees.
 */
import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { emptyDraft, draftToTransactions, type Draft } from "./entry";
import { checkIntegrity } from "./integrity";

const borrowing = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft("2026-09-20"),
  flow: "Debt",
  debtEffect: "draw",
  debtId: "maya-credit",
  item: "Maya Credit",
  toWallet: "Maya",
  amount: 200000,
  charges: 15103,
  status: "Received",
  ...over,
});

describe("a borrowing lands in its wallet, and only there", () => {
  it("saves without the stray 'from' wallet that cancelled it out", () => {
    const rows = draftToTransactions(borrowing({ fromWallet: "Maya" }), 3813, "b1");
    expect(rows[0]).toMatchObject({ debtEffect: "draw", fromWallet: "", toWallet: "Maya", amount: 200000 });
    expect(walletBalance(rows, "Maya")).toBe(200000);
  });

  it("a payment keeps only the wallet it was paid from", () => {
    const rows = draftToTransactions(borrowing({ debtEffect: "repay", fromWallet: "Maya", toWallet: "Maya", charges: null, status: "Paid" }), 1, "p1");
    expect(rows[0]).toMatchObject({ fromWallet: "Maya", toWallet: "" });
  });
});

describe("the checks on a borrowing and its fees", () => {
  const rows = draftToTransactions(borrowing(), 3813, "b1");

  it("do not call a borrowing and its own fees row a duplicate number", () => {
    expect(rows).toHaveLength(2);
    expect(checkIntegrity(rows).filter((i) => i.code === "duplicate-record-number")).toHaveLength(0);
  });

  it("still flag two separate entries sharing a number", () => {
    const other = draftToTransactions(borrowing({ date: "2026-09-18" }), 3813, "b2");
    expect(checkIntegrity([...rows, ...other]).filter((i) => i.code === "duplicate-record-number")).toHaveLength(1);
  });

  it("report a debt movement out of and into the same wallet, and change nothing", () => {
    const broken = [{ ...rows[0]!, fromWallet: "Maya", toWallet: "Maya" }, rows[1]!];
    const found = checkIntegrity(broken).filter((i) => i.code === "debt-same-wallet");
    expect(found).toHaveLength(1);
    expect(found[0]!.recordNumbers).toEqual([3813]);
    expect(broken[0]!.fromWallet).toBe("Maya");
  });
});

describe("money sent out with a fee", () => {
  it("is not flagged when it is filed as the Add form files it, Money Send", () => {
    const sent = draftToTransactions(
      { ...emptyDraft("2026-05-04"), flow: "Transfer", fromWallet: "Gcash", toWallet: "", amount: 400000, fee: 1500, status: "Transferred" },
      3610,
      "s1",
    );
    expect(sent[0]).toMatchObject({ category: "Spending", item: "Money Send" });
    expect(checkIntegrity(sent).filter((i) => i.code === "uncategorised-fee")).toHaveLength(0);
  });

  it("still flags a fee on a move between two of the owner's accounts with no fee label", () => {
    const moved = [{ ...draftToTransactions({ ...emptyDraft("2026-09-01"), flow: "Transfer", fromWallet: "Gcash", toWallet: "Maya", amount: 500472, fee: 1000 }, 3782, "m1")[0]!, category: "", item: "" }];
    expect(checkIntegrity(moved as never).filter((i) => i.code === "uncategorised-fee")).toHaveLength(1);
  });
});
