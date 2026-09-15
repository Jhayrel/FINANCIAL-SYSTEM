import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { walletBalance } from "./balances";
import { binCounts, restoreImpact } from "./binView";
import type { Transaction } from "./types";

const fx = loadFixture();
const ledger = fx.transactions;

describe("what restoring would do", () => {
  // Rows of every kind, spread across the year.
  const picked = [7, 31, 56, 120, 189, 250, 312, 400]
    .map((i) => ledger[i])
    .filter((t): t is Transaction => Boolean(t));
  const without = ledger.filter((t) => !picked.includes(t));

  it("picked real rows to work with", () => {
    expect(picked.length).toBe(8);
  });

  it("moves each wallet by exactly the difference the rows make to its balance", () => {
    const impact = restoreImpact(picked);
    expect(impact.length).toBeGreaterThan(0);
    for (const move of impact) {
      expect(move.change).toBe(walletBalance(ledger, move.wallet) - walletBalance(without, move.wallet));
    }
  });

  it("leaves out wallets the rows do not move, and lists the biggest move first", () => {
    const impact = restoreImpact(picked);
    expect(impact.every((m) => m.change !== 0)).toBe(true);
    expect(
      impact.every((m, i) => i === 0 || Math.abs(impact[i - 1]?.change ?? 0) >= Math.abs(m.change)),
    ).toBe(true);
  });

  it("the binned rows of the fixture come back to the wallets they name", () => {
    for (const move of restoreImpact(fx.deleted)) {
      expect(fx.deleted.some((t) => t.fromWallet === move.wallet || t.toWallet === move.wallet)).toBe(true);
    }
  });

  it("moves nothing when nothing is picked", () => {
    expect(restoreImpact([])).toEqual([]);
  });
});

describe("counting the bin", () => {
  it("counts every row once, by type", () => {
    const counts = binCounts(ledger);
    const byType = counts.Revenue.count + counts.Spending.count + counts.Transfer.count + counts.Debt.count;
    expect(counts.all.count).toBe(ledger.length);
    expect(byType).toBe(ledger.length);
    expect(counts.Revenue.total).toBe(
      ledger.filter((t) => t.type === "Revenue").reduce((a, t) => a + t.total, 0),
    );
  });
});
