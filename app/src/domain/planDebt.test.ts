/**
 * Plans to pay a loan or credit line (P12; owner, 3 November 2026: "what
 * about if I want to pay a loan etc ... fix all logic and process all sync
 * properly"). Invented lines and rows.
 */
import { describe, expect, it } from "vitest";

import type { Debt } from "./debt";
import { inferFromHistory } from "./infer";
import { planDebtLines } from "./planDebt";
import { readPlanIntent } from "./planIntent";
import { checkPlan, editPlan, inputOf, linkPayments, makePlan, paidSoFar, paysDebt, paysPlan, plannedForBudget, plannedIn, planPaidBy, plansSetAside, viewOf, type PlanInput } from "./planner";
import { emptyDraft } from "./entry";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-03";
const reference = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Online Buy", remark: "" }],
  stopped: [],
} as unknown as ReferenceLists;
const line = (over: Partial<Debt>): Debt => ({ id: "mc", name: "Maya Credit", kind: "payable", form: "credit-line", counterparty: "Maya", counterpartyType: "lender", openedDate: "2026-01-01", wallet: "Maya", interestType: "none", interestRate: 0, notes: "", archived: false, ...over }) as Debt;
const credit = line({ dueDay: 5 } as unknown as Partial<Debt>);
const loan = line({ id: "renz", name: "Renz loan", form: "informal", counterparty: "Renz", counterpartyType: "person", wallet: "Cash" } as unknown as Partial<Debt>);
let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return { id: `r${n}`, recordNumber: 4000 + n, date: "2026-10-20", type: "Debt", fromWallet: "", toWallet: "Maya", category: "", item: "Maya Credit", description: "", amount: 100_000, fee: 0, total: 100_000, notes: "", status: "Received", debtId: "mc", debtEffect: "draw", ...over } as Transaction;
};
const ledger = [row({}), row({ id: "loan1", date: "2026-10-01", toWallet: "Cash", item: "Renz loan", amount: 500_000, total: 500_000, debtId: "renz" })];
const repay = (over: Partial<Transaction> = {}): Transaction => row({ id: "pay1", date: asOf, fromWallet: "Maya", toWallet: "", amount: 100_000, total: 100_000, status: "Paid", debtEffect: "repay", ...over });
const input: PlanInput = { title: "Pay Maya Credit", amount: 100_000, due: "2026-12-05", item: "", wallet: "Maya", debtId: "mc", need: true, setAside: false, notes: "" };

describe("the lines a plan can pay", () => {
  it("what is owed on each, and the payment safe to spend holds back already", () => {
    const lines = planDebtLines([credit, loan, line({ id: "dad", name: "Father", kind: "receivable", form: "pass-through" })], ledger, asOf);
    expect(lines.map((l) => l.name).sort()).toEqual(["Maya Credit", "Renz loan"]);
    expect(lines.find((l) => l.id === "renz")?.owed).toBe(500_000);
  });
});

describe("a plan to pay a debt is its own kind", () => {
  it("made, edited and copied, it keeps its line and has no kind of spending", () => {
    const p = makePlan({ ...input, item: "Food" }, asOf, "owner", "d1");
    expect(paysDebt(p)).toBe(true);
    expect(p).toMatchObject({ debtId: "mc", item: "", need: true });
    expect(inputOf(p).debtId).toBe("mc");
    expect(paysDebt(editPlan(p, inputOf(p, { amount: 150_000 }), asOf))).toBe(true);
  });

  it("is paid only by a repayment on its own line", () => {
    const p = makePlan(input, asOf, "owner", "d1");
    expect(paysPlan(p, repay())).toBe(true);
    expect(paysPlan(p, repay({ debtId: "renz" }))).toBe(false);
    expect(paysPlan(p, repay({ debtEffect: "charge" }))).toBe(false);
    expect(paysPlan(p, { type: "Spending", toWallet: "", debtId: undefined, debtEffect: undefined })).toBe(false);
    const linked = linkPayments(p, ["pay1"], [...ledger, repay()], asOf);
    expect(linked.status).toBe("done");
    expect(paidSoFar(linked, [...ledger, repay()]).amount).toBe(100_000);
  });

  it("a repayment added by hand is offered as its payment", () => {
    const p = makePlan(input, asOf, "owner", "d1");
    expect(planPaidBy(repay(), [p], ledger)).toMatchObject({ plan: { id: "d1" }, sure: true });
    expect(planPaidBy(repay({ debtId: "renz" }), [p], ledger)).toBeNull();
  });

  it("is not spending: apart in the month's figures, never in the budget or what a month needs", () => {
    const p = makePlan({ ...input, due: "2026-11-20" }, asOf, "owner", "d1");
    const v = viewOf(p, { transactions: ledger, accounts: [], asOf });
    const month = plannedForBudget([v], 2026, 11, reference, asOf);
    expect(month).toMatchObject({ spending: 0, total: 0, debt: 100_000 });
    expect(month.debtViews).toHaveLength(1);
    expect(month.views).toHaveLength(0);
    expect(plannedIn([v], 2026, 11)).toHaveLength(0);
  });

  it("held back only when its line has no payment held back already", () => {
    const off = viewOf(makePlan({ ...input, due: "2026-11-20", setAside: false }, asOf, "owner", "d1"), { transactions: ledger, accounts: [], asOf });
    const on = viewOf(makePlan({ ...input, title: "Pay Renz", debtId: "renz", due: "2026-11-20", setAside: true }, asOf, "owner", "d2"), { transactions: ledger, accounts: [], asOf });
    expect(plansSetAside([off, on]).total).toBe(100_000);
  });
});

describe("checked before it is saved", () => {
  const lines = [
    { id: "mc", name: "Maya Credit", owed: 100_000, scheduled: { amount: 100_000, on: "2026-12-05" } },
    { id: "renz", name: "Renz loan", owed: 500_000, scheduled: null },
  ];
  const ctx = { plans: [], reference, asOf, debtLines: lines };

  it("needs its line", () => {
    expect(checkPlan({ ...input, debtId: undefined, paying: true }, ctx).problems).toContain("Pick the loan or credit line it pays.");
  });

  it("says a payment held back already, and more than is owed", () => {
    const notes = checkPlan({ ...input, amount: 150_000 }, ctx).notes.join(" ");
    expect(notes).toMatch(/₱500\.00 more than the ₱1,000\.00 owed on Maya Credit now/);
    expect(notes).toMatch(/is held back in safe to spend already, so this plan is not counted there/);
    expect(notes).toMatch(/A repayment is not spending/);
  });

  it("a loan with no due day is held back by the plan", () => {
    expect(checkPlan({ ...input, title: "Pay Renz", debtId: "renz", setAside: true, due: "2026-11-20" }, ctx).notes.join(" ")).toMatch(/Renz loan has no due day, so safe to spend holds this payment back/);
  });

  it("a spending payment linked stops it becoming a debt plan", () => {
    const spent = { ...repay(), type: "Spending", debtId: undefined, debtEffect: undefined, recordNumber: 4100 } as Transaction;
    expect(checkPlan(input, { ...ctx, linked: [spent], wasPaying: false, wasSaving: false }).problems.join(" ")).toMatch(/#4100 is linked as its payment, and it is not a repayment/);
  });
});

describe("said in the chat", () => {
  const ctx = { reference, transactions: ledger, asOf, debtNames: ["Maya Credit", "Renz loan"], debtLines: planDebtLines([credit, loan], ledger, asOf) };

  it("\"I plan to pay my maya credit 1000 on dec 5\" is a plan to pay that line", () => {
    const read = readPlanIntent("I plan to pay my maya credit 1000 on dec 5", ctx);
    expect(read).toMatchObject({ kind: "later", plans: [{ title: "Pay Maya Credit", amount: 100_000, due: "2026-12-05", debtId: "mc" }] });
  });

  it("\"pay off my renz loan next month\" is all that is owed, held back only when its line's payment is not already", () => {
    const read = readPlanIntent("I will pay off my renz loan next month", ctx);
    const renz = ctx.debtLines.find((l) => l.id === "renz");
    expect(read).toMatchObject({ kind: "later", plans: [{ debtId: "renz", amount: 500_000, dueKind: "month", setAside: !renz?.scheduled }] });
  });

  it("a payment made, or one today, stays the debt readers'", () => {
    expect(readPlanIntent("paid maya credit 1000 from maya", ctx)).toBeNull();
    expect(readPlanIntent("pay maya credit 1000", ctx)).toBeNull();
  });
});

describe("an entry named after an open plan takes the plan's kind", () => {
  it("\"bought blazer 1500 gcash\" is Online Buy, as the Buy blazer plan is", () => {
    const blazer = makePlan({ title: "Buy blazer", amount: 150_000, due: "2026-11-14", item: "Online Buy", wallet: "", need: true, setAside: true, notes: "" }, asOf, "owner", "b1");
    const draft = { ...emptyDraft(asOf), flow: "Spending" as const, fromWallet: "Gcash", amount: 150_000, category: "Spending" as const };
    const got = inferFromHistory(draft, [], { ...reference, plans: [blazer] } as ReferenceLists, "bought blazer 1500 gcash");
    expect(got.draft.item).toBe("Online Buy");
    expect(got.because).toContain('Booked as Online Buy, the kind of your "Buy blazer" plan.');
  });
});

describe("a repayment with its interest saved beside it", () => {
  it("counts as one payment for the plan", () => {
    const p = makePlan({ ...input, amount: 107_552 }, asOf, "owner", "d1");
    const pay = repay({ id: "pay2", amount: 100_000, total: 100_000 });
    const interest = row({ id: "pay2-interest", date: asOf, fromWallet: "Maya", toWallet: "", amount: 7_552, total: 7_552, status: "Paid", debtEffect: "interest", partOf: "pay2" } as Partial<Transaction>);
    const all = [...ledger, pay, interest];
    expect(planPaidBy(pay, [p], [...ledger, interest])).toMatchObject({ plan: { id: "d1" }, sure: true });
    const linked = linkPayments(p, ["pay2"], all, asOf);
    expect(linked.status).toBe("done");
    expect(paidSoFar(linked, all).amount).toBe(107_552);
  });

  it("'plan to pay maya credit 1000 on dec 6' with November's plan done: a new plan, not 'paid already' (3 November 2026 replay)", async () => {
    const { readPlannerAsk } = await import("./plannerAsk");
    const done = { ...linkPayments(makePlan({ ...input, due: asOf }, asOf, "owner", "nov"), ["pay1"], [...ledger, repay({ amount: 100_000 })], asOf) };
    expect(done.status).toBe("done");
    expect(readPlannerAsk("plan to pay maya credit 1000 on dec 6", { plans: [done], reference, transactions: [...ledger, repay()], asOf })).toBeNull();
    // Paying it, said of the done plan, is still said as paid already.
    expect(readPlannerAsk("pay the pay maya credit plan", { plans: [done], reference, transactions: [...ledger, repay()], asOf })?.kind).toBe("closed");
  });
});
