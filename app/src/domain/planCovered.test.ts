/**
 * A plan set aside, paid: not out of today's share, closed for less than
 * planned, and a bill's plan held once (owner, 14 and 15 November 2026).
 * Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { monthBrief } from "./monthPlan";
import { linkPayments, makePlan, plansCoveredToday, viewOf, type Plan } from "./planner";
import type { Budgets, ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-14";
let n = 0;
const row = (o: Partial<Transaction>): Transaction =>
  ({ id: `p${(n += 1)}`, recordNumber: 9000 + n, date: asOf, type: "Spending", category: "Spending", item: "Repairs", fromWallet: "Wallet A", toWallet: "", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Paid", ...o }) as Transaction;
const income = row({ id: "in", date: "2026-11-01", type: "Revenue", category: "Revenue", item: "Pay", fromWallet: "", toWallet: "Wallet A", amount: 500_000, total: 500_000 });
const plan = (o: Partial<Plan> = {}): Plan => ({ ...makePlan({ title: "Chain oil", amount: 32_000, due: asOf, dueKind: "day", item: "Repairs", wallet: "Wallet A", need: true, setAside: true, notes: "" }, "2026-11-13", "owner", "plan-oil"), ...o });
const wallets = new Set(["Wallet A"]);

describe("what a set-aside plan's payment covered today", () => {
  const paid = row({ id: "pay", amount: 27_500, total: 27_500 });
  it("is the payment, up to the plan's amount", () => {
    expect(plansCoveredToday([plan({ entryIds: ["pay"] })], [income, paid], asOf, wallets)).toBe(27_500);
    const over = row({ id: "over", amount: 35_000, total: 35_000 });
    expect(plansCoveredToday([plan({ entryIds: ["over"] })], [income, over], asOf, wallets)).toBe(32_000);
  });
  it("is nothing when it was not set aside, was paid another day, or an allocation covers the row", () => {
    expect(plansCoveredToday([plan({ entryIds: ["pay"], setAside: false })], [income, paid], asOf, wallets)).toBe(0);
    expect(plansCoveredToday([plan({ entryIds: ["pay"] })], [income, { ...paid, date: "2026-11-13" }], asOf, wallets)).toBe(0);
    expect(plansCoveredToday([plan({ entryIds: ["pay"] })], [income, paid], asOf, wallets, () => true)).toBe(0);
  });
  it("so the Dashboard's today is not over because of it", () => {
    const reference = { wallets: ["Wallet A"], savings: [], bills: [], subscriptions: [], revenueCategories: ["Pay"], spendingTypes: [{ name: "Repairs", remark: "" }], plans: [linkPayments(plan(), ["pay"], [income, paid], asOf, true)] } as unknown as ReferenceLists;
    const brief = monthBrief({ transactions: [income, paid], reference, budgets: {} as Budgets, debts: [], year: 2026, month: 11, asOf });
    expect(brief.safe?.spentToday).toBe(0);
    expect(brief.safe?.overToday).toBe(0);
    expect(brief.safe?.plansCoveredToday).toBe(27_500);
    // Nothing is still held for it: it was closed as paid, for less than planned.
    expect(brief.safe?.reservedPlans).toBe(0);
  });
});

describe("paid for less than planned", () => {
  const paid = row({ id: "less", amount: 27_500, total: 27_500 });
  it("stays open with the rest to pay, until it is said to be all", () => {
    const open = linkPayments(plan(), ["less"], [paid], asOf);
    expect(open.status).toBe("open");
    expect(viewOf(open, { transactions: [paid], accounts: [], asOf }).left).toBe(4_500);
    const done = linkPayments(open, [], [paid], asOf, true);
    expect(done).toMatchObject({ status: "done", settled: true });
    expect(viewOf(done, { transactions: [paid], accounts: [], asOf }).left).toBe(0);
  });
});

describe("a plan for a bill is held once", () => {
  const reference = (plans: Plan[]): ReferenceLists => ({ wallets: ["Wallet A"], savings: [], bills: ["Power"], subscriptions: [], revenueCategories: ["Pay"], spendingTypes: [], plans }) as unknown as ReferenceLists;
  const bill = plan({ id: "plan-power", title: "Power", item: "Power", amount: 100_000, due: "2026-11-30", dueKind: "month", wallet: "" });
  it("held as a plan when the bills still to pay do not hold it", () => {
    const brief = monthBrief({ transactions: [income], reference: reference([bill]), budgets: {} as Budgets, debts: [], year: 2026, month: 11, asOf });
    expect(brief.safe?.reservedPlans).toBe(100_000);
    expect(brief.safe?.safe).toBe(400_000);
    // Skipped, it is held no more, and safe to spend goes up by it.
    const skipped = monthBrief({ transactions: [income], reference: reference([{ ...bill, status: "skipped" }]), budgets: {} as Budgets, debts: [], year: 2026, month: 11, asOf });
    expect(skipped.safe?.safe).toBe(500_000);
  });
  it("only the part past what the bill already holds, when the bill is expected", () => {
    const lastMonth = row({ id: "oct", date: "2026-10-20", category: "Bills", item: "Power", amount: 90_000, total: 90_000 });
    const brief = monthBrief({ transactions: [income, lastMonth], reference: reference([bill]), budgets: {} as Budgets, debts: [], year: 2026, month: 11, asOf });
    expect(brief.safe?.reservedBills).toBe(90_000);
    expect(brief.safe?.reservedPlans).toBe(10_000);
  });
});
