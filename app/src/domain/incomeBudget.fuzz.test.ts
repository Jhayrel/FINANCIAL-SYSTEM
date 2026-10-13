import { describe, expect, it } from "vitest";

import { spreadCovered, wholeRows } from "./covers";
import { budgetFromIncome, checkSplit, incomeBudget } from "./incomeBudget";
import type { Transaction } from "./types";

/** A small seeded generator, so a failure is the same failure every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const reference = { wallets: ["Cash", "Maya"], savings: ["Savings"] };
const day = (r: () => number): string => `2026-11-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;

function ledger(r: () => number): Transaction[] {
  const rows: Transaction[] = [];
  const n = 5 + Math.floor(r() * 40);
  for (let i = 0; i < n; i += 1) {
    const amount = 100 * (1 + Math.floor(r() * 5000));
    const date = day(r);
    const pick = r();
    const base = { id: `f${i}`, recordNumber: i + 1, date, fee: 0, total: amount, amount, notes: "", status: "", description: "", item: "" };
    if (pick < 0.3) rows.push({ ...base, type: "Revenue", category: "Revenue", item: "Salary", fromWallet: "", toWallet: r() < 0.5 ? "Cash" : "Maya" } as Transaction);
    else if (pick < 0.75) {
      const covers = r() < 0.2 ? `2026-11-${String(Math.min(28, Number(date.slice(8)) + 1 + Math.floor(r() * 3))).padStart(2, "0")}` : undefined;
      rows.push({ ...base, type: "Spending", category: "Spending", item: "Food", fromWallet: r() < 0.5 ? "Cash" : "Maya", toWallet: "", ...(covers && covers > date ? { coversTo: covers } : {}) } as Transaction);
    } else if (pick < 0.9) rows.push({ ...base, type: "Transfer", category: "Transfer", fromWallet: "Maya", toWallet: r() < 0.5 ? "Savings" : "Cash" } as Transaction);
    else rows.push({ ...base, type: "Debt", debtId: "card", debtEffect: "draw", category: "", fromWallet: "", toWallet: "Maya" } as Transaction);
  }
  return rows;
}

describe("the income budget holds its rules on any ledger (seeded, 2,000 cases)", () => {
  it("never splits more than came in, and never promises more than the money", () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const r = rng(seed);
      const rows = ledger(r);
      const budget = 100 * Math.floor(r() * 30000);
      const plan = {
        spending: Array.from({ length: 12 }, (_, i) => (i === 10 ? budget : 0)),
        billsSubs: Array.from({ length: 12 }, () => 0),
        revisions: { "11": [{ at: "2026-11-03T04:00:00.000Z", what: "tracks", spending: budget, billsSubs: 0, wasSpending: 0, wasBillsSubs: 0, when: "open" }] },
      } as never;
      const safe = 100 * Math.floor(r() * 40000) - (r() < 0.1 ? 50000 : 0);
      const spent = 100 * Math.floor(r() * 20000);
      const ib = incomeBudget({ transactions: spreadCovered(rows), reference, plan, year: 2026, month: 11, safe, spent })!;
      expect(ib.cameIn).toBeGreaterThanOrEqual(0);
      expect(ib.most).toBe(spent + Math.max(0, safe));
      expect(ib.over * ib.room).toBe(0);
      const split = {
        toSpending: 100 * Math.floor(r() * 20000),
        toBills: r() < 0.5 ? 0 : 100 * Math.floor(r() * 5000),
        keepAside: r() < 0.5 ? 0 : 100 * Math.floor(r() * 10000),
      };
      const check = checkSplit(ib, split);
      if (check.ok) {
        expect(split.toSpending + split.toBills + split.keepAside).toBeLessThanOrEqual(ib.cameIn);
        if (split.toSpending > 0) expect(check.value.spending).toBeLessThanOrEqual(ib.most - split.keepAside);
        expect(check.value.spending).toBe(ib.budget + split.toSpending);
      } else {
        expect(check.errors.length).toBeGreaterThan(0);
      }
      const income = 100 * Math.floor(r() * 50000);
      const keep = 100 * Math.floor(r() * 10000);
      const bills = 100 * Math.floor(r() * 5000);
      const most = r() < 0.5 ? null : ib.most;
      const from = budgetFromIncome({ income, keep, bills, most });
      expect(from.spending).toBeGreaterThanOrEqual(0);
      if (from.ok) {
        expect(from.uncapped).toBe(income - keep - bills);
        if (most !== null) expect(from.spending).toBeLessThanOrEqual(most);
        else expect(from.spending).toBe(from.uncapped);
      }
    }
  });

  it("puts every spread range back exactly as saved", () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const rows = ledger(rng(seed));
      const back = wholeRows(spreadCovered(rows));
      expect(back.map((t) => [t.id, t.date, t.coversTo ?? "", t.amount, t.fee, t.total])).toEqual(
        rows.map((t) => [t.id, t.date, t.coversTo && t.coversTo > t.date ? t.coversTo : "", t.amount, t.fee, t.total]),
      );
    }
  });
});
