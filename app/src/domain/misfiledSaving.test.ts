/**
 * A plan to save that was saved as spending, and the transfer made for it
 * (owner, 3 November 2026: "i allready transfer to my bank then it didnt
 * recognize it"; "the 1500 in the plan make so much mistake ... fix all").
 *
 * The shape of what happened, on invented rows: "Save into Maya Bank" lost
 * where its money goes when its chat card was changed, so it was a plan to
 * spend. Pay booked ₱1,500.00 of spending, which was binned; the real
 * transfer into the bank was then not seen. Three accounts share the name
 * "Maya Bank", and only the plan's notes say which.
 */
import { describe, expect, it } from "vitest";

import type { Account } from "./accounts";
import { planAlerts } from "./alerts";
import { asSaving, asSavingWords, isSave, makePlan, misfiledSaving, plannedForBudget, planPaidBy, plansAsNow, statusNow, viewOf, type Plan } from "./planner";
import { readPlannerAsk } from "./plannerAsk";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-03";
const SAVINGS = "Maya Bank (Personal savings)";
const NAMES = ["Cash", "Gcash", "Maya", "Maya Bank (Drone)", "Maya Bank (New Phone)", SAVINGS];
const accounts = NAMES.map((name, i) => ({ id: `a${i}`, name, kind: i < 3 ? "spending" : "savings", archived: false }) as unknown as Account);
const reference = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: NAMES.slice(3),
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Random necessities", remark: "" }],
  stopped: [],
} as unknown as ReferenceLists;

/** As the chat saved it: no `into`, no kind, its notes naming the account, done with a payment now in the bin. */
const misfiled = (over: Partial<Plan> = {}): Plan => ({
  ...makePlan(
    { title: "Save into Maya Bank", amount: 150_000, due: "2026-11-30", dueKind: "month", item: "", wallet: "", need: true, setAside: true, notes: `Into ${SAVINGS}, the savings account; change it if it goes elsewhere. From your salary when it comes in.` },
    asOf,
    "ai",
    "p-save",
  ),
  status: "done",
  closedOn: asOf,
  entryIds: ["t-binned"],
  ...over,
});
const transfer = (over: Partial<Transaction> = {}): Transaction =>
  ({ id: "t-deposit", recordNumber: 3974, date: asOf, type: "Transfer", fromWallet: "Maya", toWallet: SAVINGS, category: "", item: "", description: "Deposit to savings", amount: 150_000, fee: 0, total: 150_000, notes: "", status: "Transferred", ...over }) as Transaction;
const salary = { id: "t-salary", recordNumber: 3973, date: "2026-11-02", type: "Revenue", fromWallet: "", toWallet: "Maya", category: "Revenue", item: "Salary", description: "", amount: 1_000_000, fee: 0, total: 1_000_000, notes: "", status: "Received" } as Transaction;
const live = [salary, transfer()];

describe("a plan whose payment is in the bin is open, everywhere", () => {
  it("statusNow: done with its only payment binned is open; done for nothing on purpose stays done", () => {
    expect(statusNow(misfiled(), live)).toBe("open");
    expect(statusNow(misfiled({ entryIds: [] }), live)).toBe("done");
    expect(viewOf(misfiled(), { transactions: live, accounts, asOf }).state).not.toBe("paid");
  });

  it("the chat reads it open, as the Planner shows it, not 'paid already'", () => {
    const ask = readPlannerAsk("how is the save into maya bank plan", { plans: [misfiled()], reference, transactions: live, asOf });
    expect(ask?.kind).toBe("status");
    expect(ask && "plan" in ask ? ask.plan.status : null).toBe("open");
  });
});

describe("misfiledSaving: said, never changed by itself", () => {
  it("names Personal savings from the notes, not the first Maya Bank, and finds the transfer", () => {
    const m = misfiledSaving(misfiled(), NAMES, live, [misfiled()]);
    expect(m?.into).toBe(SAVINGS);
    expect(m?.options).toEqual(["Maya Bank (Drone)", "Maya Bank (New Phone)", SAVINGS]);
    expect(m?.fits?.recordNumber).toBe(3974);
  });

  it("without the notes, the transfer tells them apart; without either, it cannot tell and says so", () => {
    expect(misfiledSaving(misfiled({ notes: "" }), NAMES, live, [misfiled()])?.into).toBe(SAVINGS);
    const none = misfiledSaving(misfiled({ notes: "" }), NAMES, [salary], [misfiled()]);
    expect(none?.into).toBeNull();
    expect(none?.options).toHaveLength(3);
  });

  it("not for a plan to spend by its words, one with a kind, one already saving, or spending counted for it", () => {
    expect(misfiledSaving(misfiled({ title: "Buy blazer" }), NAMES, live, [])).toBeNull();
    expect(misfiledSaving(misfiled({ item: "Food" }), NAMES, live, [])).toBeNull();
    expect(misfiledSaving(misfiled({ into: SAVINGS }), NAMES, live, [])).toBeNull();
    const spent = { ...transfer({ id: "t-spent", recordNumber: 3976, type: "Spending", toWallet: "", item: "Random necessities" }) } as Transaction;
    expect(misfiledSaving(misfiled({ entryIds: ["t-spent"] }), NAMES, [...live, spent], [])).toBeNull();
  });

  it("the bell names the right account and the transfer, and changes nothing", () => {
    const plan = misfiled();
    const alert = planAlerts([plan], live, accounts, asOf, 500_000).find((a) => a.id === `plan-kind-${plan.id}`);
    expect(alert?.title).toContain("#3974");
    expect(alert?.detail).toContain(SAVINGS);
    expect(alert?.detail).not.toContain("Drone");
    expect(alert?.detail).toContain("Nothing changes until you do");
    expect(plan.into).toBeUndefined();
  });
});

describe("asSaving: the one press", () => {
  it("makes it a plan to save, lets the binned payment go, counts the transfer, and it is done", () => {
    const before = misfiled();
    const after = asSaving(before, SAVINGS, reference.wallets, live, asOf, "t-deposit");
    expect(isSave(after)).toBe(true);
    expect(after.into).toBe(SAVINGS);
    expect(after.item).toBe("");
    expect(after.entryIds).toEqual(["t-deposit"]);
    expect(after.status).toBe("done");
    const words = asSavingWords(before, after, live, transfer());
    expect(words).toBe(`Made "Save into Maya Bank" a plan to save into ${SAVINGS}, and counted #3974 (₱1,500.00) as the money moved. The payment linked to it from the bin is no longer linked.`);
  });

  it("without a transfer: open, held back from safe to spend, and out of the month's planned spending", () => {
    const after = asSaving(misfiled(), SAVINGS, reference.wallets, [salary], asOf);
    expect(after.status).toBe("open");
    expect(after.entryIds).toEqual([]);
    const v = viewOf(after, { transactions: [salary], accounts, asOf });
    expect(v.counts).toBe(true);
    const month = plannedForBudget([v], 2026, 11, reference, asOf);
    expect(month.spending).toBe(0);
    expect(month.saving).toBe(150_000);
    // As it was: counted as ₱1,500.00 of November's planned spending.
    const was = plannedForBudget([viewOf(misfiled(), { transactions: [salary], accounts, asOf })], 2026, 11, reference, asOf);
    expect(was.spending).toBe(150_000);
  });
});

describe("the Add form and the chat offer it when the transfer is added", () => {
  it("planPaidBy finds the misfiled plan for a transfer into the account, as making it a saving", () => {
    const m = planPaidBy(transfer(), [misfiled()], [salary], NAMES);
    expect(m?.plan.id).toBe("p-save");
    expect(m?.makesSaving).toBe(SAVINGS);
    expect(m?.sure).toBe(true);
    expect(m?.left).toBe(150_000);
    // Without the account names, as before: not offered.
    expect(planPaidBy(transfer(), [misfiled()], [salary])).toBeNull();
    // Into another account: not this plan's.
    expect(planPaidBy(transfer({ toWallet: "Maya Bank (Drone)" }), [misfiled()], [salary], NAMES)).toBeNull();
  });

  it("a plan to save shown open again because its money was binned is offered too", () => {
    const save = misfiled({ into: SAVINGS, entryIds: ["t-gone"] });
    expect(planPaidBy(transfer(), [save], [salary], NAMES)?.plan.id).toBe("p-save");
  });

  it("'make the save into maya bank plan a saving into maya bank': Personal savings from the notes; asked when nothing tells", () => {
    const withNotes = readPlannerAsk("make the save into maya bank plan a saving into maya bank", { plans: [misfiled()], reference, transactions: live, asOf });
    expect(withNotes?.kind).toBe("edit");
    expect(withNotes && withNotes.kind === "edit" ? withNotes.input.into : null).toBe(SAVINGS);
    const bare = readPlannerAsk("make the save into maya bank plan a saving into maya bank", { plans: [misfiled({ notes: "" })], reference, transactions: live, asOf });
    expect(bare && bare.kind === "edit" ? bare.ask : "").toContain("Which one");
    const whole = readPlannerAsk("make the save into maya bank plan a saving into maya bank (personal savings)", { plans: [misfiled({ notes: "" })], reference, transactions: live, asOf });
    expect(whole && whole.kind === "edit" ? whole.input.into : null).toBe(SAVINGS);
  });
});

describe("plansAsNow: the plans as the Planner shows them", () => {
  it("a done plan whose payment was binned is open; one done for nothing on purpose stays done", () => {
    const [lost, settled] = plansAsNow([misfiled(), misfiled({ id: "p2", entryIds: [] })], live);
    expect(lost?.status).toBe("open");
    expect(lost?.closedOn).toBeUndefined();
    expect(settled?.status).toBe("done");
  });
});

