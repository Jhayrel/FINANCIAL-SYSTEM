/** A deposit told in words that the ledger already has (owner, 3 November 2026). Invented rows. */
import { describe, expect, it } from "vitest";

import { emptyDraft, type Draft } from "./entry";
import { placeSentMoney } from "./destination";
import type { Transaction } from "./types";

const deposit = { id: "t1", recordNumber: 4001, date: "2026-11-03", type: "Transfer", fromWallet: "Wallet A", toWallet: "Bank (Savings)", category: "", item: "", description: "Deposit", amount: 150_000, fee: 0, total: 150_000, notes: "", status: "Transferred" } as Transaction;
const told = (over: Partial<Draft>): Draft => ({ ...emptyDraft("2026-11-03"), flow: "Transfer", amount: 150_000, ...over });
const accounts = ["Wallet A", "Wallet B", "Bank (Savings)"];

describe("a transfer told in words that is already in the ledger", () => {
  it("with neither wallet: said as that entry, both wallets filled, never 'went to someone else'", () => {
    const placed = placeSentMoney(told({}), [deposit], accounts);
    expect(placed?.draft).toMatchObject({ fromWallet: "Wallet A", toWallet: "Bank (Savings)" });
    expect(placed?.note).toContain("#4001 already moved ₱1,500.00 from Wallet A into Bank (Savings)");
  });
  it("with only where it went: the wallet it came from is filled from it, not asked", () => {
    expect(placeSentMoney(told({ toWallet: "Bank (Savings)" }), [deposit], accounts)?.draft.fromWallet).toBe("Wallet A");
  });
  it("into another account, or another day: not that entry", () => {
    expect(placeSentMoney(told({ toWallet: "Wallet B" }), [deposit], accounts)).toBeNull();
    expect(placeSentMoney({ ...told({}), date: "2026-11-10" }, [deposit], accounts)?.note ?? "").not.toContain("#4001");
  });
});
