/**
 * Plans to save or move money (P11; owner, 2 November 2026: "what if I plan
 * to save like ... deposit 3000 to maya bank next week ... or goal", and
 * "what if I edited a plan to buy to plan to save"). Invented accounts and
 * rows shaped like the owner's.
 */
import { describe, expect, it } from "vitest";

import type { Account } from "./accounts";
import { closePlansNote } from "./goalMove";
import { readPlanIntent, readPlanLine } from "./planIntent";
import {
  checkPlan,
  countedWords,
  countsSentence,
  editPlan,
  isSave,
  likelyPayments,
  linkPayments,
  makePlan,
  paidSoFar,
  planLine,
  planPaidBy,
  plannedByDay,
  plannedForBudget,
  plannedIn,
  renamePlans,
  savesOutOfSpending,
  viewOf,
  type Plan,
  type PlanInput,
} from "./planner";
import { plannedMonthWords, readPlannerAsk } from "./plannerAsk";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-02";
const reference = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Extra Cash", "Maya Bank (Personal savings)"],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "School", remark: "" }, { name: "Food", remark: "" }],
  stopped: [],
} as unknown as ReferenceLists;
const account = (id: string, name: string, kind: Account["kind"], archived = false): Account => ({ id, name, kind, archived }) as Account;
const accounts: Account[] = [
  account("cash", "Cash", "spending"),
  account("gcash", "Gcash", "spending"),
  account("maya", "Maya", "spending"),
  account("extra", "Extra Cash", "reserve"),
  account("bank", "Maya Bank (Personal savings)", "savings"),
  account("fund", "Phone fund", "goal"),
  account("old", "Old bank", "savings", true),
];
const input = (over: Partial<PlanInput>): PlanInput => ({ title: "Deposit to Maya Bank", amount: 300_000, due: "2026-11-09", item: "", wallet: "", need: true, setAside: true, notes: "", into: "Maya Bank (Personal savings)", ...over });
let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return { id: `r${n}`, recordNumber: 4000 + n, date: "2026-11-09", type: "Transfer", fromWallet: "Maya", toWallet: "Maya Bank (Personal savings)", category: "", item: "", description: "", amount: 300_000, fee: 0, total: 300_000, notes: "", status: "Transferred", ...over } as Transaction;
};
const ctx = { reference, transactions: [] as Transaction[], asOf, debtNames: [], accounts };

describe("a plan to save is made as one", () => {
  it("has where it goes, no kind of spending and no goal it is paid from", () => {
    const p = makePlan(input({ item: "School", goalId: "fund", need: false }), asOf, "owner", "s1");
    expect(isSave(p)).toBe(true);
    expect(p).toMatchObject({ into: "Maya Bank (Personal savings)", item: "", need: true, setAside: true });
    expect(p.goalId).toBeUndefined();
  });

  it("a plan to spend has none of it", () => {
    const p = makePlan(input({ into: undefined, item: "School", title: "Tuition" }), asOf, "owner", "p1");
    expect(isSave(p)).toBe(false);
    expect("into" in p).toBe(false);
  });
});

describe("safe to spend holds it back only when the money leaves the spending wallets", () => {
  it("into savings or a goal, from a spending wallet or none said: held back", () => {
    expect(savesOutOfSpending({ into: "Maya Bank (Personal savings)", wallet: "" }, reference.wallets)).toBe(true);
    expect(savesOutOfSpending({ into: "Phone fund", wallet: "Gcash" }, reference.wallets)).toBe(true);
  });

  it("between spending wallets, or out of savings: nothing held back", () => {
    expect(savesOutOfSpending({ into: "Maya", wallet: "Gcash" }, reference.wallets)).toBe(false);
    expect(savesOutOfSpending({ into: "Phone fund", wallet: "Maya Bank (Personal savings)" }, reference.wallets)).toBe(false);
  });

  it("counts in this month's safe to spend as it should", () => {
    const view = (over: Partial<PlanInput>) => viewOf(makePlan(input(over), asOf, "owner", "x"), { transactions: [], accounts, asOf });
    expect(view({}).counts).toBe(true);
    expect(view({ into: "Maya", wallet: "Gcash" }).counts).toBe(false);
    expect(view({ due: "2026-12-31", dueKind: "month" }).counts).toBe(false);
  });
});

describe("it is done by money moved into its account", () => {
  const plan = makePlan(input({ wallet: "Maya" }), asOf, "owner", "s2");

  it("counts what was moved, not the transfer fee", () => {
    const t = row({ fee: 1500, total: 301_500 });
    expect(paidSoFar({ ...plan, entryIds: [t.id] }, [t]).amount).toBe(300_000);
    expect(linkPayments(plan, [t.id], [t], asOf).status).toBe("done");
  });

  it("a transfer into its account is a likely payment; spending is not", () => {
    const into = row({});
    const spent = row({ type: "Spending", toWallet: "", category: "Spending", item: "Food", description: "Deposit" });
    const elsewhere = row({ toWallet: "Extra Cash" });
    expect(likelyPayments(plan, [into, spent, elsewhere], [plan]).map((t) => t.id)).toEqual([into.id]);
  });

  it("the Add form offers a transfer for it, and spending for a plan to spend", () => {
    const tuition = makePlan(input({ into: undefined, title: "Tuition", item: "School", amount: 900_000 }), asOf, "owner", "t1");
    expect(planPaidBy(row({}), [plan, tuition], [])?.plan.id).toBe("s2");
    const fee = row({ type: "Spending", toWallet: "", category: "Spending", item: "School", amount: 900_000, total: 900_000, description: "Tuition" });
    expect(planPaidBy(fee, [plan, tuition], [])?.plan.id).toBe("t1");
  });
});

describe("it is saving, not spending, on every screen", () => {
  const save = makePlan(input({}), asOf, "owner", "s3");
  const buy = makePlan(input({ into: undefined, title: "Blazer", item: "Food", amount: 150_000, due: "2026-11-14" }), asOf, "owner", "b1");
  const views = [save, buy].map((p) => viewOf(p, { transactions: [], accounts, asOf }));

  it("the month's planned spending leaves it out, and says it apart", () => {
    const month = plannedForBudget(views, 2026, 11, reference, asOf);
    expect(month.spending).toBe(150_000);
    expect(month.total).toBe(150_000);
    expect(month.saving).toBe(300_000);
    expect(month.savingViews.map((v) => v.plan.id)).toEqual(["s3"]);
    expect(month.views.map((v) => v.plan.id)).toEqual(["b1"]);
  });

  it("what a month ahead needs, and the calendar's spending marks, leave it out", () => {
    expect(plannedIn(views, 2026, 11).map((x) => x.name)).toEqual(["Blazer"]);
    expect([...plannedByDay(views, asOf).keys()]).toEqual(["2026-11-14"]);
  });

  it("the chat says it beside the month's spending", () => {
    const words = plannedMonthWords(plannedForBudget(views, 2026, 11, reference, asOf), { name: "November 2026", asOf, spendingLeft: 1_000_000 });
    expect(words).toMatch(/\*\*₱3,000\.00 to save or move\*\* in November 2026, apart from spending:\n- Deposit to Maya Bank: ₱3,000\.00 into Maya Bank \(Personal savings\)/);
  });

  it("its words say held back and saving", () => {
    expect(countedWords(save)).toBe("Held back in its month");
    expect(countsSentence(save)).toMatch(/holds the money back in its month, so it is there to move\. It is saving, not spending: no budget counts it\./);
    expect(planLine(save)).toBe("Deposit to Maya Bank, ₱3,000.00 to save into Maya Bank (Personal savings), by November 9, 2026");
  });
});

describe("checked before it is saved", () => {
  const check = (i: PlanInput, extra: Partial<Parameters<typeof checkPlan>[1]> = {}) => checkPlan(i, { plans: [], reference, asOf, closedAccounts: ["Old bank"], ...extra });

  it("needs somewhere to go, not where it comes from, and not an account closed", () => {
    expect(check(input({ into: "", saving: true })).problems).toContain("Pick the account or goal the money goes into.");
    expect(check(input({ wallet: "Maya Bank (Personal savings)" })).problems[0]).toMatch(/comes from Maya Bank/);
    expect(check(input({ into: "Old bank" })).problems[0]).toMatch(/Old bank is closed in Settings/);
  });

  it("says what it does to safe to spend", () => {
    expect(check(input({})).notes.join(" ")).toMatch(/holds the money back in its month, so it is there to move/);
    expect(check(input({ into: "Maya", wallet: "Gcash" })).notes.join(" ")).toMatch(/Maya is a spending wallet too/);
  });
});

describe("a plan to buy changed to a plan to save, and back", () => {
  const tuition = makePlan(input({ into: undefined, title: "Tuition", item: "School", amount: 900_000, goalId: "fund", setAside: false }), asOf, "owner", "t2");
  const spent = row({ type: "Spending", toWallet: "", category: "Spending", item: "School", amount: 200_000, total: 200_000 });

  it("with spending linked as its payment, it cannot change yet", () => {
    const r = checkPlan(input({ title: "Tuition", amount: 900_000 }), { plans: [], reference, asOf, editing: "t2", linked: [spent], wasSaving: false });
    expect(r.problems[0]).toMatch(/#\d{4} is linked as its payment, and it is spending\. A plan to save is paid by moving money into its account: unlink it on the plan's sheet first/);
  });

  it("with nothing linked it changes: no kind, no goal, where it goes", () => {
    expect(checkPlan(input({ title: "Tuition", amount: 900_000 }), { plans: [], reference, asOf, editing: "t2", linked: [], wasSaving: false }).problems).toEqual([]);
    const next = editPlan(tuition, input({ title: "Tuition", amount: 900_000, item: "School", goalId: "fund" }), asOf);
    expect(next).toMatchObject({ into: "Maya Bank (Personal savings)", item: "" });
    expect(next.goalId).toBeUndefined();
  });

  it("back to spending: where it went is taken off; a transfer linked stops it", () => {
    const saved = makePlan(input({}), asOf, "owner", "s4");
    const back = editPlan(saved, input({ into: undefined, item: "School" }), asOf);
    expect(isSave(back)).toBe(false);
    expect("into" in back).toBe(false);
    expect(checkPlan(input({ into: undefined, item: "School" }), { plans: [], reference, asOf, editing: "s4", linked: [row({})], wasSaving: true }).problems[0]).toMatch(/money moved between your accounts, not spending/);
  });

  it("an edit that keeps its kind is not stopped by what is linked", () => {
    const debtRow = row({ type: "Debt", toWallet: "" });
    expect(checkPlan(input({ into: undefined, item: "School" }), { plans: [], reference, asOf, editing: "x", linked: [debtRow], wasSaving: false }).problems).toEqual([]);
  });
});

describe("Settings keeps it in step", () => {
  it("an account renamed is renamed where a plan saves into it", () => {
    const p = makePlan(input({}), asOf, "owner", "s5");
    expect(renamePlans([p], "wallet", "Maya Bank (Personal savings)", "Maya Savings")[0]?.into).toBe("Maya Savings");
  });

  it("closing a goal names the plans that put money into it", () => {
    const p = makePlan(input({ into: "Phone fund", title: "Save for the phone" }), asOf, "owner", "s6");
    expect(closePlansNote(account("fund", "Phone fund", "goal"), [p])).toMatch(/"Save for the phone" puts money into it: after closing, edit it on the Planner to pick another account\./);
  });
});

describe("said in the chat", () => {
  const read = (t: string) => readPlanIntent(t, ctx as never);

  it("next week I want to deposit 3000 to maya bank", () => {
    expect(read("next week I want to deposit 3000 to maya bank")).toMatchObject({ kind: "later", plans: [{ title: "Deposit to Maya Bank", amount: 300_000, due: "2026-11-09", into: "Maya Bank (Personal savings)", setAside: true }] });
  });

  it("into a goal, from a wallet, and in Filipino", () => {
    expect(read("I will save 2000 into my phone fund in december")).toMatchObject({ plans: [{ into: "Phone fund", dueKind: "month", due: "2026-12-31" }] });
    expect(read("transfer 1000 from gcash to maya tomorrow")).toMatchObject({ plans: [{ title: "Move to Maya", into: "Maya", wallet: "Gcash", setAside: false }] });
    expect(read("magiipon ako 1000 sa maya bank bukas")).toMatchObject({ plans: [{ into: "Maya Bank (Personal savings)", due: "2026-11-03" }] });
  });

  it("nowhere said: the one savings account, said so on the card", () => {
    expect(read("I want to save 3000 next week")).toMatchObject({ plans: [{ into: "Maya Bank (Personal savings)", notes: expect.stringMatching(/change it if it goes elsewhere/) }] });
  });

  it("asked where, with two savings accounts", () => {
    const two = { ...ctx, accounts: [...accounts, account("bdo", "BDO", "savings")] };
    expect(readPlanIntent("I want to save 3000 next week", two as never)).toMatchObject({ kind: "saveWhere", amount: 300_000 });
  });

  it("not saving: a person, money already moved, saving on something, a purchase", () => {
    expect(read("send 500 to mama tomorrow")).toBeNull();
    expect(read("I deposited 3000 to maya bank")).toBeNull();
    expect(read("save on food next week")).toBeNull();
    expect(read("next month I'll buy shoes 2000")).toMatchObject({ plans: [{ title: "Shoes" }] });
    expect((read("next month I'll buy shoes 2000") as unknown as { plans: readonly PlanInput[] }).plans[0]?.into).toBeUndefined();
  });

  it("the model's Plan line with where it goes", () => {
    expect(readPlanLine("Plan: Deposit to Maya Bank, PHP 3,000.00, by 2026-11-09, into Maya Bank (Personal savings)".replace(/^Plan:\s*/, ""), ctx as never)).toMatchObject({ title: "Deposit to Maya Bank", amount: 300_000, into: "Maya Bank (Personal savings)", item: "" });
    expect(readPlanLine("Tuition, PHP 9,000.00, by 2026-11-15", ctx as never)?.into).toBeUndefined();
  });

  it("an edit by chat: to a deposit, and back to spending", () => {
    const tuition: Plan = makePlan(input({ into: undefined, title: "Tuition", item: "School", amount: 900_000 }), asOf, "owner", "t3");
    const goals = [{ id: "fund", name: "Phone fund" }];
    const toSave = readPlannerAsk("make the tuition plan a deposit to maya bank", { plans: [tuition], reference, transactions: [], asOf, goals });
    expect(toSave).toMatchObject({ kind: "edit", input: { into: "Maya Bank (Personal savings)", item: "" }, changes: [{ label: "Plan to", before: "Spend", after: "Save into Maya Bank (Personal savings)" }] });
    const saved = makePlan(input({ title: "Deposit to Maya Bank" }), asOf, "owner", "s7");
    expect(readPlannerAsk("the deposit to maya bank plan is spending, not a saving", { plans: [saved], reference, transactions: [], asOf, goals })).toMatchObject({ kind: "edit", changes: [{ label: "Plan to", after: "Spend" }] });
  });
});
