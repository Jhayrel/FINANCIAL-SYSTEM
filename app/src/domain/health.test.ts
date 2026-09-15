/**
 * The five figures that say how the money is doing, on a ledger small enough
 * to check by hand.
 *
 * Income PHP 20,000 across two payments, PHP 6,000 spent, PHP 4,000 moved to
 * savings, PHP 5,000 borrowed. Every expected figure below is worked out from
 * those, not from the code.
 */

import { describe, expect, it } from "vitest";

import type { Account } from "./accounts";
import type { Debt } from "./debt";
import { positionsOf } from "./debt";
import { healthWords, moneyHealth } from "./health";
import type { Transaction } from "./types";

const AS_OF = "2026-09-16";

const accounts: Account[] = [
  { id: "maya", name: "Maya", kind: "spending", archived: false },
  { id: "bank", name: "Maya Bank", kind: "savings", archived: false },
];

const debts: Debt[] = [
  {
    id: "d1",
    name: "Maya Credit",
    kind: "payable",
    counterparty: "Maya",
    openedDate: "2026-06-25",
    wallet: "Maya",
    interestType: "monthly_pct",
    interestRate: 755,
    notes: "",
    archived: false,
  },
];

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  return {
    id: `h${n}`,
    recordNumber: n,
    date: "2026-08-01",
    type: "Spending",
    fromWallet: "Maya",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const ledger: Transaction[] = [
  // Borrowed, which is never income.
  row({ date: "2026-06-25", type: "Debt", category: "", item: "", fromWallet: "", toWallet: "Maya", debtId: "d1", debtEffect: "draw", amount: 500000, total: 500000 }),
  // Two payments in, a month apart.
  row({ date: "2026-07-01", type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Maya", amount: 1000000, total: 1000000 }),
  row({ date: "2026-08-01", type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Maya", amount: 1000000, total: 1000000 }),
  // Spent the day the first payment arrived, and the day after.
  row({ date: "2026-07-01", item: "Food", amount: 300000, total: 300000 }),
  row({ date: "2026-07-02", item: "Treat", amount: 200000, total: 200000 }),
  // And once more, on a kind that has not been marked.
  row({ date: "2026-08-20", item: "Gas", amount: 100000, total: 100000 }),
  // Set aside, which is not spending.
  row({ date: "2026-08-05", type: "Transfer", category: "", item: "", fromWallet: "Maya", toWallet: "Maya Bank", amount: 400000, total: 400000 }),
];

const health = moneyHealth({
  transactions: ledger,
  accounts,
  debts,
  positions: positionsOf(debts, ledger, AS_OF),
  necessity: { Food: "essential", Treat: "discretionary" },
  asOf: AS_OF,
});

describe("how the money is doing", () => {
  it("keeps borrowing out of income, and says what was kept of the rest", () => {
    // PHP 20,000 earned, PHP 6,000 spent: 70% kept. The PHP 5,000 borrowed counts as neither.
    expect(health.savingsRate.from).toBe(2000000);
    expect(health.savingsRate.of).toBe(1400000);
    expect(health.savingsRate.value).toBeCloseTo(0.7, 5);
  });

  it("counts money moved into savings, and not as spending", () => {
    expect(health.putAside).toBe(400000);
  });

  it("says how long the spendable wallets would last at the recent rate", () => {
    // Maya holds 5,000 borrowed + 20,000 in - 6,000 spent - 4,000 moved = PHP 15,000.
    // PHP 6,000 over three months is PHP 2,000 a month, so 7.5 months.
    expect(health.runwayMonths).toBeCloseTo(7.5, 5);
  });

  it("measures what is owed against a year of income", () => {
    expect(health.debtToIncome.of).toBe(500000);
    expect(health.debtToIncome.from).toBe(2000000);
    expect(health.debtToIncome.value).toBeCloseTo(0.25, 5);
  });

  it("shares out only the spending that carries a mark, and counts what does not", () => {
    // PHP 2,000 discretionary of PHP 5,000 marked. Gas is unmarked and left out of both.
    expect(health.discretionary.of).toBe(200000);
    expect(health.discretionary.from).toBe(500000);
    expect(health.discretionary.value).toBeCloseTo(0.4, 5);
    expect(health.untagged).toBe(1);
  });

  it("measures how much of each payment leaves within two days", () => {
    // The first payment: PHP 5,000 of PHP 10,000 within two days. The second: nothing.
    expect(health.straightOut).toBeCloseTo(0.25, 5);
  });

  it("says all of it in plain sentences", () => {
    const words = healthWords(health).join(" ");
    expect(words).toContain("You kept 70% of what you earned");
    expect(words).toContain("went into reserve and savings");
    expect(words).toContain("would last about 7.5 months");
    expect(words).toContain("25% of a year of income");
    expect(words).toContain("40% of the spending you have marked was discretionary");
    expect(words).toContain("1 kinds not marked yet");
    expect(words).toContain("25% of each payment left again within two days");
  });
});

describe("when there is nothing to divide", () => {
  const empty = moneyHealth({
    transactions: [],
    accounts,
    debts: [],
    positions: [],
    necessity: {},
    asOf: AS_OF,
  });

  it("answers with nothing rather than with zero", () => {
    expect(empty.savingsRate.value).toBeNull();
    expect(empty.runwayMonths).toBeNull();
    expect(empty.debtToIncome.value).toBeNull();
    expect(empty.discretionary.value).toBeNull();
    expect(empty.straightOut).toBeNull();
  });

  it("says so, rather than claiming a rate of zero", () => {
    expect(healthWords(empty)[0]).toContain("no savings rate to give");
  });
});
