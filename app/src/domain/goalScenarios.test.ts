/**
 * The owner's goal questions, 13 November 2026: interest while it runs,
 * finishing or cancelling into a wallet, cash or the bank, and goal money
 * spent on something else. Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import type { Account } from "./accounts";
import { walletBalance } from "./balances";
import { checkDraft, emptyDraft } from "./entry";
import { destinationWords, goalInterest, planGoalClose } from "./goalClose";
import type { ReferenceLists, Transaction } from "./types";

const TODAY = "2026-11-16";
const bank: Account = { id: "bank-c", name: "Bank C", kind: "savings", archived: false, channel: "bank" };
const wallet: Account = { id: "wallet-b", name: "Wallet B", kind: "spending", archived: false };
const cash: Account = { id: "cash", name: "Cash", kind: "spending", archived: false, channel: "cash" };
const goal: Account = { id: "g-phone", name: "Bank C (Phone)", kind: "goal", archived: false, parentId: "bank-c", target: 1_000_000, deadline: "2027-02-28" };
const accounts = [bank, wallet, cash, goal];
const fund = (from: string, amount: number, n: number): Transaction =>
  ({ id: `f${n}`, recordNumber: n, date: "2026-10-01", type: "Transfer", fromWallet: from, toWallet: goal.name, category: "", item: "", description: "Saving for the phone", amount, fee: 0, total: amount, notes: "", status: "Transferred" }) as Transaction;
// Started from a wallet and from cash, not only the bank it sits in.
const ledger = [fund(wallet.name, 300_000, 1), fund(cash.name, 200_000, 2), fund(bank.name, 100_000, 3)];

describe("interest while the goal runs", () => {
  it("the bank showing more is one interest row into the goal, and the goal stays open", () => {
    const read = goalInterest(goal, ledger, { actual: 601_250, today: TODAY, nextRecordNumber: 10 });
    expect(read.recorded).toBe(600_000);
    expect(read.adjustment).toBe(1_250);
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]).toMatchObject({ type: "Revenue", toWallet: goal.name, amount: 1_250, item: "Interest" });
    expect(walletBalance([...ledger, ...read.rows], goal.name)).toBe(601_250);
  });
  it("less is a bank charge, and the same is nothing", () => {
    expect(goalInterest(goal, ledger, { actual: 599_500, today: TODAY, nextRecordNumber: 10 }).rows[0]).toMatchObject({ type: "Spending", fromWallet: goal.name, amount: 500 });
    expect(goalInterest(goal, ledger, { actual: 600_000, today: TODAY, nextRecordNumber: 10 }).rows).toEqual([]);
  });
});

describe("finished or cancelled: the money goes where it is said to", () => {
  it("to a wallet, as one transfer, and it is safe-to-spend money from then", () => {
    const plan = planGoalClose(goal, accounts, ledger, { today: TODAY, nextRecordNumber: 10, to: wallet });
    expect(plan.blocked).toBeUndefined();
    expect(plan.rows).toEqual([expect.objectContaining({ type: "Transfer", fromWallet: goal.name, toWallet: wallet.name, amount: 600_000 })]);
    const after = [...ledger, ...plan.rows];
    expect(walletBalance(after, goal.name)).toBe(0);
    expect(walletBalance(after, wallet.name)).toBe(-300_000 + 600_000);
    expect(destinationWords(wallet)).toMatch(/counted in safe to spend/);
  });
  it("to cash, or back to the bank it sits in, with interest first when the bank shows more", () => {
    expect(planGoalClose(goal, accounts, ledger, { today: TODAY, nextRecordNumber: 10, to: cash }).rows[0]).toMatchObject({ toWallet: "Cash", amount: 600_000 });
    const home = planGoalClose(goal, accounts, ledger, { today: TODAY, nextRecordNumber: 10, reconcile: { actual: 600_900 } });
    expect(home.rows.map((r) => [r.type, r.amount])).toEqual([["Revenue", 900], ["Transfer", 600_900]]);
    expect(home.rows[1]!.toWallet).toBe(bank.name);
    expect(destinationWords(bank)).toMatch(/stays savings/);
  });
});

describe("goal money spent on something else", () => {
  it("is said with what the goal is left holding, and how to give it up", () => {
    const reference = { wallets: ["Wallet B", "Cash"], savings: ["Bank C", goal.name], accountKinds: { [goal.name]: "goal" }, spendingTypes: [{ name: "Food", remark: "" }], bills: [], subscriptions: [], revenueCategories: [], credits: [], onBehalf: [] } as unknown as ReferenceLists;
    const draft = { ...emptyDraft(TODAY), flow: "Spending" as const, category: "Spending" as const, item: "Food", fromWallet: goal.name, amount: 50_000, status: "Paid" as const };
    const words = checkDraft(draft, ledger, reference, [], TODAY).warnings.map((w) => w.message).join(" ");
    expect(words).toContain("Bank C (Phone) is a goal. Spending ₱500.00 from it leaves ₱5,500.00 saved toward it.");
    expect(words).toContain("close it in Settings, Accounts");
  });
});
