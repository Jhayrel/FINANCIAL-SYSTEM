/**
 * A month in brief, and safe to spend.
 *
 * Two things pinned: the brief uses the same figures the Budget and Debt
 * screens do, and the daily figure never promises money that is not there.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { assessMonthFor, budgetForYear } from "./budget";
import { monthBills } from "./budgetView";
import { getMonth, getYear } from "./dates";
import type { Debt } from "./debt";
import { isOpenBill, monthBrief } from "./monthPlan";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const fx = loadFixture();
const AS_OF = fx.expected.asOf;
const YEAR = getYear(AS_OF);
const MONTH = getMonth(AS_OF);

describe("a month in brief, on the real ledger", () => {
  const brief = monthBrief({
    transactions: fx.transactions,
    reference: fx.reference,
    budgets: fx.budgets,
    debts: [],
    year: YEAR,
    month: MONTH,
    asOf: AS_OF,
  });

  it("judges the two tracks exactly as rule 3.6 does", () => {
    expect(brief.tracks).toEqual(assessMonthFor(fx.transactions, fx.budgets, YEAR, MONTH));
  });

  it("sets aside exactly the bills the Budget screen still expects", () => {
    const open = monthBills(fx.transactions, fx.reference, YEAR, MONTH, AS_OF)
      .bills.filter(isOpenBill)
      .reduce((s, b) => s + b.amount, 0);
    expect(brief.safe?.reservedBills).toBe(open);
  });

  it("never promises more a day than there is", () => {
    const safe = brief.safe;
    if (!safe) throw new Error("the captured month has no allocation");
    expect(safe.free).toBe(safe.wallets - safe.reservedBills - safe.reservedDebt);
    expect(safe.perDay * safe.daysLeft).toBeLessThanOrEqual(safe.safe);
    expect(safe.safe).toBeGreaterThanOrEqual(0);
  });

  it("has nothing to allocate in a month that is over", () => {
    const earlier = monthBrief({
      transactions: fx.transactions,
      reference: fx.reference,
      budgets: fx.budgets,
      debts: [],
      year: YEAR,
      month: MONTH - 1,
      asOf: AS_OF,
    });
    expect(earlier.safe).toBeNull();
    expect(earlier.daysLeft).toBe(0);
    expect(earlier.kept).toBe(earlier.cameIn - earlier.wentOut);
  });

  it("writes its sentences without the long dash rule W1 bans", () => {
    const banned = String.fromCharCode(8212);
    for (const note of brief.notes) expect(note).not.toContain(banned);
  });
});

describe("safe to spend", () => {
  const reference: ReferenceLists = { ...fx.reference, wallets: ["Cash"], savings: [], bills: ["Rent"], subscriptions: [] };
  const credit: Debt = {
    id: "maya-credit",
    name: "Maya Credit",
    kind: "payable",
    counterparty: "Maya",
    openedDate: "2026-08-01",
    wallet: "Cash",
    interestType: "none",
    interestRate: 0,
    notes: "",
    archived: false,
  };

  let n = 0;
  const row = (over: Partial<Transaction>): Transaction => {
    n += 1;
    const amount = over.amount ?? 0;
    return {
      id: `s${n}`,
      recordNumber: n,
      date: "2026-09-01",
      type: "Spending",
      fromWallet: "",
      toWallet: "",
      category: "",
      item: "",
      description: "",
      fee: 0,
      notes: "",
      status: "",
      ...over,
      amount,
      total: amount + (over.fee ?? 0),
    };
  };

  const ledger = (rent: number): Transaction[] => [
    row({ date: "2026-08-10", type: "Debt", toWallet: "Cash", item: "Maya Credit", amount: 100000, debtId: "maya-credit", debtEffect: "draw" }),
    row({ date: "2026-08-20", fromWallet: "Cash", category: "Bills", item: "Rent", amount: rent }),
    row({ date: "2026-09-01", type: "Revenue", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 200000 }),
    row({ date: "2026-09-05", fromWallet: "Cash", category: "Spending", item: "Food", amount: 20000 }),
  ];

  const budgetsWith = (spending: number): Budgets => {
    const base = budgetForYear(fx.budgets, 2026);
    const s = [...base.spending] as [number, number, number, number, number, number, number, number, number, number, number, number];
    const b = [...base.billsSubs] as typeof s;
    s[8] = spending;
    b[8] = 600000;
    return { ...fx.budgets, "2026": { ...base, spending: s, billsSubs: b } };
  };

  const briefOf = (rent: number, spending: number) =>
    monthBrief({
      transactions: ledger(rent),
      reference,
      budgets: budgetsWith(spending),
      debts: [credit],
      year: 2026,
      month: 9,
      asOf: "2026-09-16",
    });

  it("sets aside the bill and the debt payment, and spreads the rest over the days left", () => {
    const brief = briefOf(30000, 700000);
    const safe = brief.safe;
    expect(safe?.wallets).toBe(250000);
    expect(safe?.reservedBills).toBe(30000);
    expect(safe?.reservedDebt).toBe(100000);
    expect(safe?.free).toBe(120000);
    expect(safe?.limitedBy).toBe("wallets");
    expect(safe?.daysLeft).toBe(15);
    expect(safe?.perDay).toBe(8000);
    expect(brief.debts[0]).toMatchObject({ name: "Maya Credit", dueOn: "2026-09-10", daysToDue: -6, basis: "borrowed" });
  });

  it("lets the budget set the figure when it is the smaller", () => {
    const safe = briefOf(30000, 50000).safe;
    expect(safe?.budgetLeft).toBe(30000);
    expect(safe?.limitedBy).toBe("budget");
    expect(safe?.safe).toBe(30000);
    expect(safe?.perDay).toBe(2000);
  });

  it("says plainly when the wallets cannot cover what is due, and offers nothing a day", () => {
    // Wallets of PHP 1,300.00 against PHP 1,500.00 of rent and PHP 1,000.00 of debt still due.
    const brief = briefOf(150000, 700000);
    expect(brief.safe?.wallets).toBe(130000);
    expect(brief.safe?.free).toBeLessThan(0);
    expect(brief.safe?.safe).toBe(0);
    expect(brief.safe?.perDay).toBe(0);
    expect(brief.notes.some((note) => note.includes("more than your wallets hold"))).toBe(true);
  });
});
