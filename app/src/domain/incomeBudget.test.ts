import { describe, expect, it } from "vitest";

import { checkSplit, incomeBudget, incomeBudgetWords } from "./incomeBudget";
import type { BudgetYear, Transaction } from "./types";

let n = 0;
const row = (o: Partial<Transaction>): Transaction => {
  n += 1;
  return { id: `i${n}`, recordNumber: n, date: "2026-11-01", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Paid", ...o } as Transaction;
};
const reference = { wallets: ["Cash", "Maya"], savings: ["Savings"], bills: [], subscriptions: [], revenueCategories: ["Salary"], spendingTypes: [] };
const zeros = (): number[] => Array(12).fill(0);
const novemberAt = (spending: number): BudgetYear =>
  ({
    spending: zeros().map((v, i) => (i === 10 ? spending : v)),
    billsSubs: zeros(),
    revisions: { "11": [{ at: "2026-11-01T04:00:00.000Z", what: "tracks", spending, billsSubs: 0, wasSpending: 0, wasBillsSubs: 0, when: "open" }] },
  }) as never;

// The owner's own example: November's budget set at PHP 5,000.00 on the 1st, then PHP 10,000.00 earned.
const before = [
  row({ date: "2026-10-31", type: "Revenue", category: "Revenue", item: "Salary", fromWallet: "", toWallet: "Cash", amount: 600000, total: 600000 }),
  row({ date: "2026-11-03", amount: 100000, total: 100000 }),
];
const salary = row({ date: "2026-11-05", type: "Revenue", category: "Revenue", item: "Salary", fromWallet: "", toWallet: "Maya", amount: 1000000, total: 1000000 });
const of = (rows: Transaction[], safe: number, budget = 500000) =>
  incomeBudget({ transactions: rows, reference: reference as never, plan: novemberAt(budget), year: 2026, month: 11, safe, spent: 100000 })!;

describe("the budget moved by the money that came in (owner, 12 October 2026)", () => {
  it("counts only income since the budget was set, and the most the money can keep", () => {
    const ib = of([...before, salary], 1500000);
    expect(ib.cameIn).toBe(1000000);
    expect(ib.sources[0]).toMatchObject({ name: "Salary", amount: 1000000 });
    // Spent PHP 1,000.00 and PHP 15,000.00 is safe: the spending budget can be PHP 16,000.00 at most.
    expect(ib.most).toBe(1600000);
    expect(ib.room).toBe(1100000);
    expect(ib.over).toBe(0);
  });

  it("splits it into spending and savings without counting a peso twice", () => {
    const ib = of([...before, salary], 1500000);
    const fine = checkSplit(ib, { toSpending: 600000, toBills: 0, keepAside: 400000 });
    expect(fine.ok).toBe(true);
    expect(fine.value.spending).toBe(1100000);
    expect(fine.notes.join(" ")).toContain("Move the ₱4,000.00 into a savings account");
    expect(fine.reason).toBe("From income: ₱10,000.00 came in, ₱6,000.00 to spending, ₱4,000.00 kept for savings");

    // The broken budget the owner feared: all of it to spending and some to savings as well.
    const twice = checkSplit(ib, { toSpending: 1000000, toBills: 0, keepAside: 400000 });
    expect(twice.ok).toBe(false);
    expect(twice.errors.join(" ")).toContain("but ₱10,000.00 came in");
    expect(twice.errors.join(" ")).toContain("count the ₱4,000.00 kept for savings twice");
  });

  it("knows savings already moved, and the budget follows the money", () => {
    const moved = row({ date: "2026-11-06", type: "Transfer", category: "Transfer", fromWallet: "Maya", toWallet: "Savings", amount: 400000, total: 400000 });
    // The wallets dropped by PHP 4,000.00, so safe to spend did too.
    const ib = of([...before, salary, moved], 1100000);
    expect(ib.toSavings).toBe(400000);
    expect(ib.most).toBe(1200000);
    expect(checkSplit(ib, { toSpending: 600000, toBills: 0, keepAside: 0 }).ok).toBe(true);
    expect(checkSplit(ib, { toSpending: 800000, toBills: 0, keepAside: 0 }).ok).toBe(false);
  });

  it("never splits more than came in, or nothing at all", () => {
    const ib = of([...before, salary], 1500000);
    expect(checkSplit(ib, { toSpending: 0, toBills: 0, keepAside: 0 }).ok).toBe(false);
    expect(checkSplit(ib, { toSpending: 500000, toBills: 600000, keepAside: 0 }).ok).toBe(false);
    expect(checkSplit(ib, { toSpending: -1, toBills: 0, keepAside: 0 }).ok).toBe(false);
    const bills = checkSplit(ib, { toSpending: 0, toBills: 200000, keepAside: 0 });
    expect(bills.ok).toBe(true);
    expect(bills.value.billsSubs).toBe(200000);
    expect(bills.notes.join(" ")).toContain("₱8,000.00 stays free");
  });

  it("says when a budget already promises more than the money, income or not", () => {
    const ib = of(before, 400000, 2000000);
    expect(ib.cameIn).toBe(0);
    expect(ib.over).toBe(2000000 - 500000);
    expect(incomeBudgetWords(ib, "November").join(" ")).toContain("Lower it to ₱5,000.00");
  });

  it("leaves out income from before the budget was set, borrowing, and moves between own accounts", () => {
    const earlier = row({ date: "2026-10-28", type: "Revenue", category: "Revenue", item: "Salary", fromWallet: "", toWallet: "Cash", amount: 50000, total: 50000 });
    const borrowed = row({ date: "2026-11-07", type: "Debt", debtId: "card", debtEffect: "draw", category: "", item: "", fromWallet: "", toWallet: "Maya", amount: 300000, total: 300000 } as never);
    const own = row({ date: "2026-11-08", type: "Transfer", category: "Transfer", fromWallet: "Savings", toWallet: "Cash", amount: 100000, total: 100000 });
    const opening = row({ date: "2026-11-01", type: "Revenue", category: "Opening", fromWallet: "", toWallet: "Cash", amount: 90000, total: 90000 });
    const ib = of([earlier, borrowed, own, opening, salary], 1500000);
    expect(ib.cameIn).toBe(1000000);
    expect(ib.toSavings).toBe(0);
  });

  it("counts the whole month when no budget was saved for it", () => {
    const ib = incomeBudget({ transactions: [...before, salary], reference: reference as never, plan: undefined, year: 2026, month: 11, safe: 1500000, spent: 100000 })!;
    expect(ib.setOn).toBeNull();
    expect(ib.cameIn).toBe(1000000);
    expect(ib.budget).toBe(0);
  });
});

describe("asked in chat", () => {
  it("knows a budget question about income from other budget talk", async () => {
    const { asksIncomeBudget } = await import("./incomeBudget");
    for (const q of ["I got 10k, adjust my budget", "split my income into my budget", "is my budget still right after this income?", "I earned 10000 how much should I add to my budget", "income based budget please"]) expect([q, asksIncomeBudget(q)]).toEqual([q, true]);
    for (const q of ["set my budget to 5000", "how many times did I change my budget", "I got 500 from Maya", "what is my income this month"]) expect([q, asksIncomeBudget(q)]).toEqual([q, false]);
  });
});
