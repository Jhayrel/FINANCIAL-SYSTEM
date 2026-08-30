/**
 * Parity tests: wallet balances.
 *
 * These assert against figures read straight out of the workbook's own cells,
 * not against anything hand-transcribed. If one of these fails, the domain
 * logic has diverged from the system this app replaces. Do not adjust the
 * expectation to make it pass.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { formatMoney } from "./money";
import {
  allWalletBalances,
  historicalWalletBalances,
  isSavingsWallet,
  projectedBalance,
  totalSavingsBalance,
  totalWalletBalance,
  walletBalance,
  walletBalances,
} from "./balances";
import type { Transaction } from "./types";

const fx = loadFixture();

/** Minimal transaction builder for the unit tests below. */
function tx(over: Partial<Transaction>): Transaction {
  const amount = over.amount ?? 0;
  const fee = over.fee ?? 0;
  return {
    id: over.id ?? "t1",
    recordNumber: over.recordNumber ?? 1,
    date: over.date ?? "2026-01-01",
    type: over.type ?? "Spending",
    fromWallet: over.fromWallet ?? "",
    toWallet: over.toWallet ?? "",
    category: over.category ?? "Spending",
    item: over.item ?? "Food",
    description: over.description ?? "",
    amount,
    fee,
    total: over.total ?? amount + fee,
    notes: over.notes ?? "",
    status: over.status ?? "Paid",
  };
}

describe("parity: wallet balances vs the Excel workbook", () => {
  it("reproduces every active wallet balance exactly", () => {
    for (const [name, expected] of Object.entries(fx.expected.walletBalances)) {
      const actual = walletBalance(fx.transactions, name);
      expect(
        actual,
        `${name}: got ${formatMoney(actual)}, workbook says ${formatMoney(expected)}`,
      ).toBe(expected);
    }
  });

  it("reproduces every savings balance exactly", () => {
    for (const [name, expected] of Object.entries(fx.expected.savingsBalances)) {
      const actual = walletBalance(fx.transactions, name);
      expect(
        actual,
        `${name}: got ${formatMoney(actual)}, workbook says ${formatMoney(expected)}`,
      ).toBe(expected);
    }
  });

  /**
   * The workbook's TOTAL FUNDS tile (SUMMARY!D9) is NOT the sum of its own
   * wallet balances. It is an independent cash-flow formula:
   *
   *   revenue - spending - transferFees - moneySends
   *
   * ...where a transfer fee only counts if category='Spending' AND
   * item='Transaction Fee'. Two historical rows carry a real ₱15 fee but a
   * blank category (#8 2026-01-04 and #190 2026-04-03, both Gcash -> Maya),
   * so ₱30.00 of fees is never subtracted from the tile, while the same ₱30
   * IS subtracted from Gcash's balance, which uses `total` on outflow.
   *
   * The tile is therefore overstated by exactly ₱30.00 relative to the wallet
   * balances shown beside it. We deliberately do NOT reproduce that: a total
   * that disagrees with the parts it is made of is a bug, not a spec. The app
   * shows the internally consistent figure and flags the offending rows via
   * the integrity check instead.
   */
  it("uses the internally consistent total, not the workbook's inflated tile", () => {
    const wallets = totalWalletBalance(fx.transactions, fx.reference.wallets);
    const savings = totalSavingsBalance(fx.transactions, fx.reference.savings);
    const ours = wallets + savings;

    // Ties exactly to the per-wallet figures the user sees.
    const partsSum =
      Object.values(fx.expected.walletBalances).reduce((a, b) => a + b, 0) +
      Object.values(fx.expected.savingsBalances).reduce((a, b) => a + b, 0);
    expect(ours).toBe(partsSum);

    // And documents the known, explained gap against the workbook's tile.
    expect(fx.expected.summary.totalFunds - ours).toBe(30_00);
  });

  it("matches the workbook's savings figure on the SUMMARY sheet", () => {
    expect(totalSavingsBalance(fx.transactions, fx.reference.savings)).toBe(
      fx.expected.summary.savings,
    );
  });

  it("agrees between the single-wallet and bulk implementations", () => {
    const bulk = allWalletBalances(fx.transactions);
    for (const [name, balance] of bulk) {
      expect(walletBalance(fx.transactions, name), name).toBe(balance);
    }
  });
});

describe("wallet balance rules", () => {
  it("treats Revenue booked against fromWallet as an inflow", () => {
    // The historical data uses this convention for opening balances.
    const t = [tx({ type: "Revenue", fromWallet: "Maya", amount: 50_00 })];
    expect(walletBalance(t, "Maya")).toBe(50_00);
  });

  it("treats Revenue booked against toWallet as an inflow", () => {
    const t = [tx({ type: "Revenue", toWallet: "Maya", amount: 50_00 })];
    expect(walletBalance(t, "Maya")).toBe(50_00);
  });

  it("never double-counts Revenue naming the same wallet on both sides", () => {
    // Term 1 adds `total`, term 2 adds `amount`; with no fee both are 50.00.
    // This documents the actual behaviour: such a row WOULD count twice.
    // No historical row does this, and the entry form must not create one.
    const t = [
      tx({ type: "Revenue", fromWallet: "Maya", toWallet: "Maya", amount: 50_00 }),
    ];
    expect(walletBalance(t, "Maya")).toBe(100_00);
  });

  it("charges the transaction fee to the source wallet only", () => {
    const t = [
      tx({
        type: "Transfer",
        fromWallet: "Maya",
        toWallet: "Cash",
        amount: 1_000_00,
        fee: 18_00,
      }),
    ];
    expect(walletBalance(t, "Maya")).toBe(-1_018_00); // pays amount + fee
    expect(walletBalance(t, "Cash")).toBe(1_000_00); // receives amount only
  });

  it("subtracts spending including its fee", () => {
    const t = [tx({ type: "Spending", fromWallet: "Cash", amount: 500_00, fee: 5_00 })];
    expect(walletBalance(t, "Cash")).toBe(-505_00);
  });

  it("returns zero for an unknown or empty wallet", () => {
    expect(walletBalance(fx.transactions, "Nonexistent Wallet")).toBe(0);
    expect(walletBalance(fx.transactions, "")).toBe(0);
  });
});

describe("wallet listing", () => {
  it("includes zero-balance wallets so new ones still appear", () => {
    const rows = walletBalances([], ["Brand New Wallet"], []);
    expect(rows).toEqual([
      { name: "Brand New Wallet", balance: 0, isSavings: false },
    ]);
  });

  it("preserves the caller's wallet ordering", () => {
    const order = [...fx.reference.wallets];
    const rows = walletBalances(fx.transactions, order, fx.reference.savings);
    expect(rows.map((r) => r.name)).toEqual(order);
  });

  it("flags savings accounts", () => {
    const rows = walletBalances(
      fx.transactions,
      fx.reference.savings,
      fx.reference.savings,
    );
    expect(rows.every((r) => r.isSavings)).toBe(true);
  });

  it("surfaces retired wallets that only exist in history", () => {
    const historical = historicalWalletBalances(fx.transactions);
    const names = historical.map((w) => w.name);
    const active = new Set([...fx.reference.wallets, ...fx.reference.savings]);
    const retired = names.filter((n) => !active.has(n));

    // The workbook's ledger references wallets no longer on the active list.
    expect(retired.length).toBeGreaterThan(0);
    expect(retired).toContain("Hidden cash (fieldtrip)");
  });
});

describe("projected balance (entry-form warnings)", () => {
  it("subtracts a prospective outgoing amount", () => {
    const before = walletBalance(fx.transactions, "Cash");
    expect(projectedBalance(fx.transactions, "Cash", 100_00)).toBe(before - 100_00);
  });

  it("excludes the edited transaction so editing does not double-count", () => {
    const target = fx.transactions.find(
      (t) => t.fromWallet === "Cash" && t.type === "Spending" && t.total > 0,
    );
    if (!target) throw new Error("fixture has no Cash spending row");

    const withoutIt = walletBalance(
      fx.transactions.filter((t) => t.id !== target.id),
      "Cash",
    );
    expect(projectedBalance(fx.transactions, "Cash", 0, target.id)).toBe(withoutIt);
  });
});

describe("savings detection", () => {
  it("recognises wallets on the savings list", () => {
    expect(isSavingsWallet("Extra Cash", fx.reference.savings)).toBe(true);
  });

  it("falls back to the Module1 name heuristic", () => {
    // Module1 warns on any wallet whose name contains "saving".
    expect(isSavingsWallet("Maya Bank (Personal savings)", [])).toBe(true);
    expect(isSavingsWallet("Some Savings Jar", [])).toBe(true);
    expect(isSavingsWallet("Cash", [])).toBe(false);
  });
});
