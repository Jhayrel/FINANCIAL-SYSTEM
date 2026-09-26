/**
 * What you owe, and what is owed to you, are not the same total.
 *
 * Caught on the owner's own screen, 26 September 2026: paying a friend's
 * PHP 4.00 meal, which they will pay back, changed the line under net worth
 * from "after PHP 5,000.00 owed" to "after PHP 5,004.00 owed". Money coming
 * back to you was being counted as a debt of yours.
 */

import { describe, expect, it } from "vitest";

import { netWorth, positionsOf, totalPayables, totalReceivables, type Debt } from "./debt";
import type { Transaction } from "./types";

const credits: Debt[] = [
  {
    id: "maya-credit",
    name: "Maya Credit",
    kind: "payable",
    counterparty: "Maya",
    wallet: "Maya",
    openedDate: "2026-08-30",
    interestRate: 0,
    interestType: "none",
    notes: "",
    archived: false,
  },
  {
    id: "a-friend",
    name: "A friend",
    kind: "receivable",
    counterparty: "A friend",
    wallet: "Gcash",
    openedDate: "2026-09-26",
    interestRate: 0,
    interestType: "none",
    notes: "",
    archived: false,
    form: "pass-through",
  } as Debt,
];

const movement = (debtId: string, debtEffect: string, amount: number): Transaction =>
  ({
    id: `t-${debtId}-${debtEffect}`,
    recordNumber: 1,
    date: "2026-09-26",
    type: "Debt",
    category: "",
    item: "",
    description: "",
    fromWallet: debtEffect === "lend" ? "Gcash" : "",
    toWallet: debtEffect === "draw" ? "Maya" : "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "",
    debtId,
    debtEffect,
  }) as unknown as Transaction;

describe("the two sides of a debt", () => {
  const transactions = [
    movement("maya-credit", "draw", 500_000),
    movement("a-friend", "lend", 400),
  ];
  const positions = positionsOf(credits, transactions, "2026-09-26");

  it("counts only the payable as owed", () => {
    expect(totalPayables(positions)).toBe(500_000);
  });

  it("counts only the receivable as owed to you", () => {
    expect(totalReceivables(positions)).toBe(400);
  });

  /*
   * The figure under net worth is `payables`, and this is the assertion the
   * screen was failing: PHP 5,000.00, never PHP 5,004.00.
   */
  it("never adds the two together", () => {
    const worth = netWorth(1_000_000, 0, positions);
    expect(worth.payables).toBe(500_000);
    expect(worth.payables).not.toBe(500_400);
  });

  /*
   * Net worth itself was always right, which is why this went unnoticed:
   * an advance moves money from a wallet into what someone owes you and
   * leaves the total where it was.
   */
  it("leaves net worth unmoved by an advance", () => {
    const before = netWorth(1_000_400, 0, positionsOf(credits, [transactions[0]!], "2026-09-26"));
    const after = netWorth(1_000_000, 0, positions);
    expect(after.total).toBe(before.total);
  });
});
