/**
 * Notices that were wrong about the owner's own ledger, 27 September 2026,
 * and the assistant's net worth against the Dashboard's. Names and figures
 * are invented, in the same shape.
 */

import { describe, expect, it } from "vitest";

import type { Account } from "./accounts";
import { buildContext } from "./aiContext";
import { financeAlerts } from "./alerts";
import { totalSavingsBalance, totalWalletBalance } from "./balances";
import { netWorth, positionsOf, type Debt } from "./debt";
import { REFERENCE } from "./eval/corpus";
import { uncategorisedCount } from "./patterns";
import type { ReferenceLists, Transaction } from "./types";

const TODAY = "2026-09-27";
let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `r${n}`,
    recordNumber: n,
    date: "2026-09-20",
    type: "Spending",
    fromWallet: "",
    toWallet: "",
    category: "",
    item: "",
    description: "",
    amount: 0,
    fee: 0,
    total: 0,
    notes: "",
    status: "",
    ...over,
  };
};

const line: Debt = {
  id: "line",
  name: "Pay Later",
  kind: "payable",
  form: "credit-line",
  counterparty: "Lender",
  counterpartyType: "institution",
  openedDate: "2026-01-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};
const aunt: Debt = { ...line, id: "aunt", name: "Aunt's money", form: "pass-through", counterparty: "Aunt", counterpartyType: "person" };
const dad: Debt = { ...line, id: "dad", name: "Dad", kind: "receivable", form: "pass-through", counterparty: "Dad", counterpartyType: "person" };

const alertsFor = (transactions: readonly Transaction[], debts: readonly Debt[]) =>
  financeAlerts({ transactions, accounts: [], budgets: {}, debts, bills: [], lowBalanceThreshold: 0, asOf: TODAY });

describe("a borrowing and its fees share one record number", () => {
  it("is not reported as two devices saving at once", () => {
    const rows = [
      row({ id: "draw", recordNumber: 500, type: "Debt", toWallet: "Maya", amount: 200000, total: 200000, debtId: "line", debtEffect: "draw" }),
      row({ id: "draw-charge", recordNumber: 500, type: "Debt", amount: 15103, total: 15103, debtId: "line", debtEffect: "charge", partOf: "draw" }),
    ];
    expect(alertsFor(rows, [line]).some((a) => a.id === "shared-number-500")).toBe(false);
  });

  it("still is when two separate entries share it", () => {
    const rows = [
      row({ recordNumber: 501, category: "Spending", item: "Food", fromWallet: "Cash", amount: 5000, total: 5000 }),
      row({ recordNumber: 501, category: "Spending", item: "Gas", fromWallet: "Cash", amount: 8000, total: 8000 }),
    ];
    expect(alertsFor(rows, [line]).some((a) => a.id === "shared-number-501")).toBe(true);
  });
});

describe("rows with no category", () => {
  it("counts spending and income that are missing one, not transfers or debts", () => {
    const rows = [
      row({ date: "2026-09-25", type: "Transfer", fromWallet: "Gcash", toWallet: "Maya", amount: 998000, total: 999000 }),
      row({ date: "2026-09-25", type: "Debt", toWallet: "Maya", amount: 200000, total: 200000, debtId: "line", debtEffect: "draw" }),
      row({ date: "2026-09-25", type: "Debt", fromWallet: "Gcash", amount: 2500000, total: 2500000, debtId: "aunt", debtEffect: "repay" }),
      row({ date: "2026-09-25", type: "Spending", category: "", fromWallet: "Maya", amount: 21800, total: 21800 }),
      row({ date: "2026-09-25", type: "Revenue", category: "Revenue", item: "", toWallet: "Maya", amount: 174, total: 174 }),
      row({ date: "2026-09-25", type: "Revenue", category: "", item: "Allowance", toWallet: "Gcash", amount: 1500000, total: 1500000 }),
    ];
    expect(uncategorisedCount(rows, TODAY)).toBe(2);
  });
});

describe("money held for someone", () => {
  const history = [1, 2, 3, 4, 5].map((i) =>
    row({ date: `2026-08-0${i}`, type: "Debt", toWallet: "Maya", amount: 200000, total: 200000, debtId: "line", debtEffect: "draw" }),
  );

  it("is not measured against the owner's own borrowing", () => {
    const held = row({ date: "2026-09-27", type: "Debt", toWallet: "Gcash", amount: 2500000, total: 2500000, debtId: "aunt", debtEffect: "draw" });
    expect(alertsFor([...history, held], [line, aunt]).some((a) => a.id === `unusual-${held.id}`)).toBe(false);
  });

  it("while a borrowing of that size still is", () => {
    const big = row({ date: "2026-09-27", type: "Debt", toWallet: "Maya", amount: 2500000, total: 2500000, debtId: "line", debtEffect: "draw" });
    expect(alertsFor([...history, big], [line]).some((a) => a.id === `unusual-${big.id}`)).toBe(true);
  });
});

describe("the assistant's net worth", () => {
  it("is the Dashboard's, with what is owed to the owner added", () => {
    const reference: ReferenceLists = { ...REFERENCE, wallets: ["Cash", "Maya"], savings: ["Savings"] };
    const accounts: Account[] = [
      { id: "a", name: "Cash", kind: "spending", archived: false },
      { id: "b", name: "Maya", kind: "spending", archived: false },
      { id: "c", name: "Savings", kind: "savings", archived: false },
    ];
    const rows = [
      row({ type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Maya", amount: 1000000, total: 1000000 }),
      row({ type: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Savings", amount: 300000, total: 300000 }),
      // Paid ₱999.00 of the father's phone plan: he owes it back.
      row({ type: "Debt", fromWallet: "Maya", amount: 99900, total: 99900, debtId: "dad", debtEffect: "lend" }),
      row({ type: "Debt", toWallet: "Maya", amount: 200000, total: 200000, debtId: "line", debtEffect: "draw" }),
    ];
    const debts = [line, dad];
    const dashboard = netWorth(totalWalletBalance(rows, reference.wallets), totalSavingsBalance(rows, reference.savings), positionsOf(debts, rows, TODAY)).total;
    const ai = buildContext({ transactions: rows, accounts, budgets: {}, credits: debts, reference, lowBalanceThreshold: 0, asOf: TODAY });
    expect(Math.round(ai.netWorth * 100)).toBe(dashboard);
    expect(dashboard).toBe(1000000 + 300000 - 99900 + 200000 + 99900 - 200000);
  });
});
