/**
 * The Planner (docs/16-PLANNER.md), what-if by what-if. Rows and plans are
 * invented; 26 October 2026 is the day.
 */
import { describe, expect, it } from "vitest";

import type { Account } from "./accounts";
import { spreadCovered } from "./covers";
import { monthBrief, nextMonthStart } from "./monthPlan";
import {
  checkPlan,
  coverage,
  groupOpen,
  kindFromHistory,
  likelyPayments,
  editPlan,
  linkPayments,
  planPaidBy,
  makePlan,
  movePlan,
  byWhen,
  NO_DATE,
  plannedByDay,
  plannedForBudget,
  whenOf,
  movesWords,
  plannedIn,
  plansSetAside,
  removePlan,
  reopenPlan,
  skipPlan,
  tidy,
  unlinkPayment,
  viewOf,
  walletToPayFrom,
  type Plan,
  type PlanInput,
} from "./planner";
import { closedPlanWords, dayIn, plannedMonthWords, readPlannerAsk } from "./plannerAsk";
import { planAlerts } from "./alerts";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-10-26";
const reference: ReferenceLists = {
  wallets: ["Cash", "Maya"],
  savings: ["Phone fund"],
  bills: ["Globe"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "School", remark: "" }, { name: "Food", remark: "" }, { name: "Self Care", remark: "" }],
};
const goal: Account = { id: "g1", name: "Phone fund", kind: "goal", target: 2_500_000, deadline: "2027-03-31", archived: false };

let n = 0;
const tx = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 10_000;
  return { id: `t${n}`, recordNumber: n, date: "2026-10-01", type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", fee: 0, notes: "", status: "Paid", ...over, amount, total: amount + (over.fee ?? 0) };
};
const income = tx({ id: "in", type: "Revenue", fromWallet: "", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 1_000_000, status: "Received", date: "2026-10-01" });
const cashIn = tx({ id: "in2", type: "Revenue", fromWallet: "", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 300_000, status: "Received", date: "2026-10-01" });
const tuitionBefore = tx({ id: "old", item: "School", description: "Tuition first sem", amount: 900_000, fromWallet: "Maya", date: "2026-06-08" });
const ledger = [income, cashIn, tuitionBefore];

const input = (over: Partial<PlanInput>): PlanInput => ({ title: "Tuition", amount: 900_000, due: "2026-11-15", item: "School", wallet: "Maya", need: true, setAside: true, notes: "", ...over });
const ctx = { transactions: ledger, accounts: [goal], asOf };

describe("a plan and its states (P3)", () => {
  it("is later, soon, due today or overdue by its date", () => {
    expect(viewOf(makePlan(input({}), asOf, "owner"), ctx)).toMatchObject({ state: "later", left: 900_000, daysTo: 20, words: "Due in 20 days" });
    expect(viewOf(makePlan(input({ due: "2026-10-30" }), asOf, "owner"), ctx)).toMatchObject({ state: "soon", words: "Due in 4 days" });
    expect(viewOf(makePlan(input({ due: asOf }), asOf, "owner"), ctx)).toMatchObject({ state: "today", words: "Due today" });
    // P4.1: ignored when the day came. It stays, overdue; nothing skips it.
    expect(viewOf(makePlan(input({ due: "2026-10-20" }), "2026-10-01", "owner"), ctx)).toMatchObject({ state: "overdue", words: "6 days late" });
  });

  it("never stores a blank field, which the database refuses", () => {
    const p = editPlanClearingGoal();
    expect(Object.values(p).some((v) => v === undefined)).toBe(false);
    expect("goalId" in p).toBe(false);
  });
});

function editPlanClearingGoal(): Plan {
  const withGoal = makePlan(input({ goalId: "g1" }), asOf, "owner");
  return tidy({ ...withGoal, goalId: undefined });
}

describe("paying it (P4.2 to P4.8)", () => {
  const plan = makePlan(input({}), "2026-10-01", "owner");

  it("is paid early, part paid, or paid for more, from the linked entries", () => {
    const early = tx({ id: "p1", item: "School", description: "Tuition", amount: 900_000, fromWallet: "Maya", date: "2026-11-10" });
    const done = linkPayments(plan, ["p1"], [...ledger, early], asOf);
    expect(done.status).toBe("done");
    expect(viewOf(done, { ...ctx, transactions: [...ledger, early] }).words).toBe("Paid early, Nov 10");

    const part = tx({ id: "p2", item: "School", amount: 300_000, fromWallet: "Maya", date: "2026-11-01" });
    const partly = linkPayments(plan, ["p2"], [...ledger, part], asOf);
    expect(partly.status).toBe("open");
    expect(viewOf(partly, { ...ctx, transactions: [...ledger, part] })).toMatchObject({ state: "partly", paid: 300_000, left: 600_000 });

    // "That settles it": done for less, and said.
    const settled = linkPayments(plan, ["p2"], [...ledger, part], asOf, true);
    expect(viewOf(settled, { ...ctx, transactions: [...ledger, part] }).words).toBe("Paid early, Nov 1, ₱6,000.00 less than planned");

    const late = tx({ id: "p3", item: "School", amount: 950_000, fromWallet: "Maya", date: "2026-11-20" });
    expect(viewOf(linkPayments(plan, ["p3"], [...ledger, late], asOf), { ...ctx, transactions: [...ledger, late] }).words).toBe("Paid 5 days late, Nov 20, ₱500.00 more than planned");
  });

  it("goes back to open when its payment is moved to the bin, and says so (P4.8)", () => {
    const pay = tx({ id: "p4", item: "School", amount: 900_000, fromWallet: "Maya", date: "2026-10-20" });
    const done = linkPayments(plan, ["p4"], [...ledger, pay], asOf);
    const binned = viewOf(done, ctx);
    expect(binned.state).not.toBe("paid");
    expect(binned.left).toBe(900_000);
    expect(binned.goneNote).toMatch(/no longer in the ledger/);
    expect(unlinkPayment(done, "p4", ledger).status).toBe("open");
  });

  it("finds a payment added by hand, by kind or words and amount, never one linked elsewhere (P4.7, P4.9)", () => {
    const byHand = tx({ id: "h1", item: "School", description: "tuition 2nd sem", amount: 900_000, fromWallet: "Maya", date: "2026-11-14" });
    const other = tx({ id: "h2", item: "Food", amount: 900_000, date: "2026-11-14" });
    expect(likelyPayments(plan, [...ledger, byHand, other], [plan]).map((t) => t.id)).toEqual(["h1"]);
    const linkedElsewhere = { ...plan, id: "x", entryIds: ["h1"] };
    expect(likelyPayments(plan, [...ledger, byHand], [plan, linkedElsewhere])).toEqual([]);
  });
});

describe("no date, or only a month (owner, 27 October 2026: \"LIKE NO DATE LIKE NO IDEA WHEN\")", () => {
  const someday = makePlan(input({ title: "Laptop", amount: 3_500_000, due: "", dueKind: "none", item: "Online Buy" }), asOf, "owner");
  const november = makePlan(input({ due: "2026-11-05", dueKind: "month" }), asOf, "owner");
  it("is kept with no date and counted nowhere", () => {
    expect(someday).toMatchObject({ due: NO_DATE, dueKind: "none" });
    expect(viewOf(someday, ctx)).toMatchObject({ state: "later", words: "No date yet", counts: false, perMonth: 0 });
    expect(whenOf(someday)).toBe("No date yet");
    expect(byWhen(someday)).toBe("with no date yet");
    const brief = monthBrief({ transactions: ledger, reference: { ...reference, plans: [someday] }, budgets: {}, debts: [], year: 2026, month: 10, asOf });
    expect(brief.safe?.reservedPlans).toBe(0);
    expect(plannedForBudget([viewOf(someday, ctx)], 2026, 10, reference, asOf).total).toBe(0);
    expect(groupOpen([viewOf(someday, ctx), viewOf(november, ctx)], asOf).map((g) => g.title)).toEqual(["November 2026", "No date yet"]);
    expect(checkPlan(input({ due: "", dueKind: "none" }), { plans: [], reference, asOf }).problems).toEqual([]);
  });
  it("a month is that month, said as one", () => {
    expect(november).toMatchObject({ due: "2026-11-30", dueKind: "month" });
    expect(viewOf(november, ctx).words).toBe("Sometime in November 2026");
    expect(byWhen(november)).toBe("sometime in November 2026");
    expect(plannedForBudget([viewOf(november, ctx)], 2026, 11, reference, asOf).total).toBe(900_000);
    // Not a day on the calendar.
    expect(plannedByDay([viewOf(november, ctx)], asOf).size).toBe(0);
  });
  it("moves to a day, a month or no date, and only a day changing is a move", () => {
    const dated = movePlan(someday, "2026-12-20", asOf);
    expect(dated).toMatchObject({ due: "2026-12-20", moves: [] });
    expect("dueKind" in dated).toBe(false);
    const again = movePlan(dated, "", asOf, "none");
    expect(again).toMatchObject({ due: NO_DATE, dueKind: "none", moves: [] });
    expect(movePlan(november, "2026-12-01", asOf, "month")).toMatchObject({ due: "2026-12-31", dueKind: "month", moves: [{ from: "2026-11-30", to: "2026-12-31" }] });
  });
  it("from the chat: no date added, moved, or taken away", () => {
    const c = { plans: [november], reference, transactions: ledger, asOf };
    expect(readPlannerAsk("plan laptop 35000", c)).toMatchObject({ kind: "add", input: { due: NO_DATE, dueKind: "none" } });
    expect(readPlannerAsk("plan laptop 35000 in december", c)).toMatchObject({ kind: "add", input: { due: "2026-12-31", dueKind: "month" } });
    expect(readPlannerAsk("move the tuition plan to december", c)).toMatchObject({ kind: "move", to: "2026-12-31", toKind: "month" });
    expect(readPlannerAsk("move the tuition plan to no date yet", c)).toMatchObject({ kind: "move", to: NO_DATE, toKind: "none" });
    expect(readPlannerAsk("the tuition plan has no date yet", c)).toMatchObject({ kind: "edit", input: { due: NO_DATE, dueKind: "none" } });
  });
  // 27 October 2026 sweep: each of these became an entry or the month's summary.
  it("from the chat: a new price, and a plan put back, however it is said", () => {
    const skipped = { ...makePlan(input({ title: "Concert ticket", amount: 450_000, due: "2026-10-18" }), "2026-10-01", "owner"), status: "skipped" as const };
    const c = { plans: [november, skipped], reference, transactions: ledger, asOf };
    expect(readPlannerAsk("make the tuition plan 9500", c)).toMatchObject({ kind: "amount", amount: 950_000 });
    expect(readPlannerAsk("the tuition is 9500 now", c)).toMatchObject({ kind: "amount", amount: 950_000 });
    expect(readPlannerAsk("tuition now costs 9500", c)).toMatchObject({ kind: "amount", amount: 950_000 });
    // Without "now" or "costs" it is an entry, as before.
    expect(readPlannerAsk("tuition 9500", c)).toBeNull();
    expect(readPlannerAsk("put the concert ticket plan back", c)).toMatchObject({ kind: "restore", plan: { title: "Concert ticket" } });
    expect(readPlannerAsk("bring back the concert plan", c)).toMatchObject({ kind: "restore" });
    // Skipped already: said, not "no plan by that name".
    const said = readPlannerAsk("skip the concert plan", c);
    expect(said).toMatchObject({ kind: "closed", plan: { title: "Concert ticket" } });
    if (said?.kind === "closed") expect(closedPlanWords(said.plan)).toMatch(/^"Concert ticket" is skipped already.*say "put the concert ticket plan back"\.$/);
    expect(readPlannerAsk("skip the gym plan", c)).toMatchObject({ kind: "none" });
  });
  it("from the chat: a question about paying is answered, never a Pay card (27 October 2026)", () => {
    const c = { plans: [november], reference, transactions: ledger, asOf };
    expect(readPlannerAsk("if i pay the tuition plan today will i be short", c)).toMatchObject({ kind: "payIf", plan: { title: "Tuition" } });
    expect(readPlannerAsk("can i pay the tuition plan from maya?", c)).toMatchObject({ kind: "payIf", wallet: "Maya" });
    expect(readPlannerAsk("i paid the tuition plan", c)).toMatchObject({ kind: "pay" });
  });

  it("an entry typed on the Add form that pays a plan is found (planPaidBy)", () => {
    const haircut = makePlan(input({ title: "Haircut", amount: 15_000, due: "2026-10-28", item: "Self Care" }), "2026-10-20", "owner");
    const row = tx({ id: "new", item: "Self Care", description: "haircut at the barber", amount: 15_000, date: asOf });
    expect(planPaidBy(row, [haircut], ledger)).toMatchObject({ plan: { title: "Haircut" }, left: 15_000, sure: true });
    // Its kind only, close to what is left: offered, not switched on.
    expect(planPaidBy({ ...row, description: "barber", total: 14_000, amount: 14_000 }, [haircut], ledger)).toMatchObject({ sure: false });
    // Something else entirely is no plan's payment.
    expect(planPaidBy({ ...row, item: "Food", description: "lunch" }, [haircut], ledger)).toBeNull();
    // A plan already paid is not offered.
    expect(planPaidBy(row, [{ ...haircut, status: "done" }], ledger)).toBeNull();
  });

  it("from the chat: one month's plans, against its budget and the money (27 October 2026)", () => {
    const c = { plans: [november], reference, transactions: ledger, asOf };
    expect(readPlannerAsk("how much is planned this month?", c)).toEqual({ kind: "month", year: 2026, month: 10 });
    expect(readPlannerAsk("what's planned for november?", c)).toEqual({ kind: "month", year: 2026, month: 11 });
    expect(readPlannerAsk("how much is planned next month", c)).toEqual({ kind: "month", year: 2026, month: 11 });
    expect(readPlannerAsk("what's planned for march?", c)).toEqual({ kind: "month", year: 2027, month: 3 });
    expect(readPlannerAsk("what plans do i have?", c)).toEqual({ kind: "list" });
    expect(readPlannerAsk("what do you think of my tuition plan?", c)).toMatchObject({ kind: "opinion", plan: { title: "Tuition" } });
    expect(readPlannerAsk("can i afford the tuition plan?", c)).toMatchObject({ kind: "opinion" });
    expect(readPlannerAsk("how much should i save for the tuition plan", c)).toMatchObject({ kind: "saveFor" });

    const haircut = makePlan(input({ title: "Haircut", amount: 15_000, due: "2026-10-28", item: "Self Care", setAside: false }), asOf, "owner");
    const fee = makePlan(input({ title: "Org fee", amount: 50_000, due: "2026-10-30", item: "School" }), asOf, "owner");
    const month = plannedForBudget([haircut, fee].map((p) => viewOf(p, ctx)), 2026, 10, reference, asOf);
    const words = plannedMonthWords(month, { name: "October 2026", asOf, spendingLeft: 40_000, room: 0 });
    expect(words).toMatch(/^\*\*₱650\.00 is planned in October 2026 and not paid yet\*\*, 2 plans:/);
    expect(words).toMatch(/- Haircut: ₱150\.00, October 28, 2026 \(not in safe to spend\)/);
    expect(words).toMatch(/Safe to spend holds back ₱500\.00 of it; the rest is not set aside\./);
    // The budget cannot hold them, and the money cannot raise it: no "raise it".
    expect(words).toMatch(/They need ₱250\.00 more than the spending budget has left, and your money does not let it rise: move a plan to a later month, or skip one\./);
    expect(plannedMonthWords(month, { name: "October 2026", asOf, spendingLeft: 40_000, room: 100_000 })).toMatch(/raise it on the Budget screen/);
    expect(plannedMonthWords(month, { name: "October 2026", asOf, spendingLeft: null })).toMatch(/has no spending budget yet/);
  });
});

describe("one answer on every screen", () => {
  it("is paid whether the ledger is read whole or a day at a time (27 October 2026: ₱11,200.00 on the Dashboard, ₱2,200.00 on the Planner)", () => {
    const trip = tx({ id: "abra", item: "Travel", description: "Travel to Abra", amount: 933_700, fromWallet: "Cash", date: "2026-10-09", coversTo: "2026-10-11" });
    const plan = linkPayments(makePlan(input({ title: "Trip to Abra", amount: 900_000, due: "2026-10-10", item: "Travel" }), "2026-10-01", "owner"), ["abra"], [...ledger, trip], asOf);
    const whole = viewOf(plan, { ...ctx, transactions: [...ledger, trip] });
    const daily = viewOf(plan, { ...ctx, transactions: spreadCovered([...ledger, trip]) });
    expect(spreadCovered([trip]).length).toBe(3);
    expect(daily).toMatchObject({ state: whole.state, paid: whole.paid, left: 0, counts: false });
    expect(daily.words).toBe(whole.words);
    const brief = monthBrief({ transactions: spreadCovered([...ledger, trip]), reference: { ...reference, plans: [plan] }, budgets: {}, debts: [], year: 2026, month: 10, asOf });
    expect(brief.safe?.reservedPlans).toBe(0);
    // And a day's share of it is never offered as some other plan's payment.
    const other = makePlan(input({ title: "Travel", amount: 933_700, due: "2026-10-30", item: "Travel" }), "2026-10-01", "owner");
    expect(likelyPayments(other, spreadCovered([...ledger, trip]), [plan, other])).toEqual([]);
  });
});

describe("changing your mind (P4.10 to P4.13)", () => {
  const plan = makePlan(input({}), asOf, "owner");
  it("skips, removes and puts back, nothing deleted", () => {
    expect(viewOf(skipPlan(plan, asOf, "Found a scholarship"), ctx).words).toBe("Skipped Oct 26: Found a scholarship");
    expect(viewOf(removePlan(plan, asOf), ctx).state).toBe("removed");
    expect(reopenPlan(removePlan(plan, asOf)).status).toBe("open");
  });
  it("keeps every move", () => {
    const moved = movePlan(movePlan(plan, "2026-11-30", asOf), "2026-12-15", "2026-11-20");
    expect(moved.moves).toHaveLength(2);
    expect(movesWords(moved)).toBe("Moved twice, first planned for November 15, 2026");
  });
});

describe("what the form says (P4.14 to P4.17)", () => {
  const existing = makePlan(input({}), asOf, "owner");
  it("stops a plan with no name or amount", () => {
    expect(checkPlan(input({ title: " ", amount: null }), { plans: [], reference, asOf }).problems).toEqual(["Say what it is for.", "Put in how much it will cost."]);
  });
  it("notes a date passed, the same plan twice, a bill set aside twice, a goal", () => {
    expect(checkPlan(input({ due: "2026-10-01" }), { plans: [], reference, asOf }).notes[0]).toMatch(/already passed/);
    expect(checkPlan(input({}), { plans: [existing], reference, asOf }).notes[0]).toMatch(/already planned for November/);
    expect(checkPlan(input({ title: "Globe", item: "Globe" }), { plans: [], reference, asOf }).notes[0]).toMatch(/aside twice/);
    expect(makePlan(input({ goalId: "g1" }), asOf, "owner").setAside).toBe(false);
  });
});

describe("safe to spend (P5)", () => {
  const thisMonth = makePlan(input({ title: "Haircut", amount: 15_000, due: "2026-10-28", item: "Self Care", wallet: "Cash" }), asOf, "owner");
  const notCounted = makePlan(input({ title: "Treat", amount: 50_000, due: "2026-10-29", setAside: false }), asOf, "owner");
  const nextMonth = makePlan(input({}), asOf, "owner");
  const brief = (plans: readonly Plan[]) =>
    monthBrief({ transactions: ledger, reference: { ...reference, plans }, budgets: {}, debts: [], year: 2026, month: 10, asOf });

  it("sets aside what is left of a counted plan this month, and nothing with no plans", () => {
    const without = brief([]).safe!;
    const withPlans = brief([thisMonth, notCounted, nextMonth]).safe!;
    expect(without.reservedPlans).toBe(0);
    expect(withPlans.reservedPlans).toBe(15_000);
    expect(withPlans.safe).toBe(without.safe - 15_000);
    expect(withPlans.plansDue).toEqual([{ id: thisMonth.id, title: "Haircut", left: 15_000, due: "2026-10-28" }]);
  });

  it("counts next month's plans when next month starts", () => {
    const now = brief([nextMonth]).safe!;
    const next = nextMonthStart({ transactions: ledger, reference: { ...reference, plans: [nextMonth] }, budgets: {}, debts: [], asOf }, now);
    expect(next.reservedPlans).toBe(900_000);
  });

  it("says which plans the money does not cover, in due order (P4.4)", () => {
    const views = [thisMonth, makePlan(input({ title: "Shoes", amount: 200_000, due: "2026-10-30" }), asOf, "owner")].map((p) => viewOf(p, ctx));
    const short = coverage(views, 100_000);
    expect(short.get(thisMonth.id)).toBeUndefined();
    expect([...short.values()]).toEqual([115_000]);
  });

  it("feeds a month ahead's need with its plans", () => {
    expect(plannedIn([viewOf(nextMonth, ctx)], 2026, 11)).toEqual([{ name: "Tuition", amount: 900_000 }]);
  });

  it("groups open plans overdue first, then by month", () => {
    const overdue = makePlan(input({ title: "Late", due: "2026-10-20" }), "2026-10-01", "owner");
    expect(groupOpen([nextMonth, thisMonth, overdue].map((p) => viewOf(p, ctx)), asOf).map((g) => g.title)).toEqual(["Overdue", "This month", "November 2026"]);
    expect(plansSetAside([overdue, thisMonth].map((p) => viewOf(p, ctx))).total).toBe(915_000);
  });
});

describe("a goal (P4.17, P4.18)", () => {
  it("shows what the goal holds and what it takes a month", () => {
    const phone = makePlan(input({ title: "New phone", amount: 2_500_000, due: "2027-03-31", goalId: "g1", item: "" }), asOf, "owner");
    const saved = tx({ id: "save", type: "Transfer", fromWallet: "Maya", toWallet: "Phone fund", category: "Transfer", item: "", amount: 500_000, date: "2026-10-10" });
    const v = viewOf(phone, { ...ctx, transactions: [...ledger, saved] });
    expect(v.goal).toEqual({ name: "Phone fund", holds: 500_000, perMonth: 400_000, missing: false });
    expect(v.counts).toBe(false);
    expect(viewOf(phone, { ...ctx, accounts: [] }).goal?.missing).toBe(true);
  });
});

describe("filling it in for you", () => {
  it("takes the kind from the entries and the wallet from habit or what holds enough", () => {
    expect(kindFromHistory("Tuition", ledger, ["School", "Food"])).toBe("School");
    expect(kindFromHistory("Something new", ledger, ["School", "Food"])).toBeNull();
    expect(walletToPayFrom({ wallet: "", item: "School" }, 500_000, ledger, ["Cash", "Maya"])).toBe("Maya");
    expect(walletToPayFrom({ wallet: "", item: "" }, 200_000, ledger, ["Cash", "Maya"])).toBe("Cash");
  });
});

describe("from the chat (P4.23)", () => {
  const plans = [makePlan(input({}), asOf, "owner")];
  const c = { plans, reference, transactions: ledger, asOf };
  it("adds, from words", () => {
    const add = readPlannerAsk("plan tuition 9000 by nov 15", c);
    expect(add?.kind).toBe("add");
    if (add?.kind === "add") expect(add.input).toMatchObject({ title: "Tuition", amount: 900_000, due: "2026-11-15", item: "School" });
    const phone = readPlannerAsk("add a new phone 25k for march 2027 to my planner", c);
    if (phone?.kind === "add") expect(phone.input).toMatchObject({ title: "New phone", amount: 2_500_000, due: "2027-03-31" });
    else throw new Error("not read");
  });
  it("lists, moves, changes, pays, skips, removes and puts back the plan named", () => {
    expect(readPlannerAsk("what is planned?", c)).toEqual({ kind: "list" });
    expect(readPlannerAsk("move the tuition plan to nov 30", c)).toMatchObject({ kind: "move", to: "2026-11-30" });
    expect(readPlannerAsk("the tuition plan is now 9500", c)).toMatchObject({ kind: "amount", amount: 950_000 });
    expect(readPlannerAsk("I paid the tuition plan from maya", c)).toMatchObject({ kind: "pay", wallet: "Maya", amount: null });
    expect(readPlannerAsk("skip the tuition plan", c)).toMatchObject({ kind: "skip" });
    expect(readPlannerAsk("remove the tuition plan", c)).toMatchObject({ kind: "remove" });
    expect(readPlannerAsk("skip the gym plan", c)).toEqual({ kind: "none", said: "skip the gym plan" });
    const removed = { ...c, plans: [removePlan(plans[0]!, asOf)] };
    expect(readPlannerAsk("put back the tuition plan", removed)).toMatchObject({ kind: "restore" });
  });
  it("edits every other field: name, need or want, safe to spend, kind, wallet, goal, note", () => {
    const edit = (text: string) => {
      const r = readPlannerAsk(text, { ...c, goals: [{ id: "g1", name: "Phone fund" }] });
      return r?.kind === "edit" ? { changes: r.changes.map((x) => `${x.label}: ${x.after}`), input: r.input } : r;
    };
    expect(edit("rename the tuition plan to Second sem tuition")).toMatchObject({ changes: ["Name: Second sem tuition"] });
    expect(edit("the tuition plan is a want")).toMatchObject({ changes: ["Need or want: A want"] });
    expect(edit("don't count the tuition plan in safe to spend")).toMatchObject({ changes: ["Safe to spend: Not counted"] });
    expect(edit("the tuition plan is Food")).toMatchObject({ changes: ["Kind: Food"] });
    expect(edit("change the tuition plan to cash")).toMatchObject({ changes: ["Pay from: Cash"] });
    expect(edit("save for the tuition plan in Phone fund")).toMatchObject({ changes: ["Goal: Phone fund"], input: { goalId: "g1", wallet: "Phone fund", setAside: false } });
    expect(edit("note on the tuition plan: pay at the cashier")).toMatchObject({ changes: ["Notes: pay at the cashier"] });
    // Paying and moving stay what they are.
    expect(readPlannerAsk("I paid the tuition plan from cash", c)).toMatchObject({ kind: "pay", wallet: "Cash" });
    expect(readPlannerAsk("move the tuition plan to nov 30", c)).toMatchObject({ kind: "move" });
  });
  it("leaves plans to spend, said as questions, to the money readers", () => {
    expect(readPlannerAsk("I plan to spend 1000 cash on dinner tonight", c)).toBeNull();
    expect(readPlannerAsk("I plan to spend 3000 on a trip next month, what budget should I set?", c)).toBeNull();
    expect(readPlannerAsk("food 150 cash", c)).toBeNull();
  });
  it("reads a day said", () => {
    expect(dayIn("by december", asOf)).toBe("2026-12-31");
    expect(dayIn("on the 30th", asOf)).toBe("2026-10-30");
    expect(dayIn("next month", asOf)).toBe("2026-11-30");
    expect(dayIn("in 2 weeks", asOf)).toBe("2026-11-09");
  });
});

describe("in the bell (P4.1, P4.4, P4.9)", () => {
  it("says overdue, due soon with the money, and a payment to link", () => {
    const overdue = makePlan(input({ title: "Rent", item: "", due: "2026-10-20" }), "2026-10-01", "owner");
    const soon = makePlan(input({ title: "Haircut", amount: 15_000, due: "2026-10-28", item: "Self Care" }), asOf, "owner");
    const tuition = makePlan(input({ due: "2026-11-30" }), "2026-10-01", "owner");
    const byHand = tx({ id: "hand", item: "School", description: "tuition", amount: 900_000, fromWallet: "Maya", date: "2026-10-25" });
    const found = planAlerts([overdue, soon, tuition], [...ledger, byHand], [goal], asOf, 50_000);
    expect(found.map((a) => a.id)).toEqual([`plan-overdue-${overdue.id}`, `plan-due-${soon.id}-2026-10-28`, `plan-link-${tuition.id}-hand`]);
    expect(found[1]?.detail).toMatch(/Set aside already|short/);
  });
});

describe("a plan for a day already gone (owner, 27 October 2026: \"what happen if I plan in the past?\")", () => {
  const input: PlanInput = { title: "Haircut", amount: 15_000, due: "2026-10-20", item: "Self Care", wallet: "Cash", need: true, setAside: true, notes: "" };
  const paidBefore = tx({ id: "cut", item: "Self Care", description: "Barber", amount: 15_000, date: "2026-10-19" });

  it("is allowed, says it shows as overdue and how not to pay it twice", () => {
    const check = checkPlan(input, { plans: [], reference, asOf });
    expect(check.problems).toEqual([]);
    expect(check.notes.join(" ")).toMatch(/has already passed\. When you add it, you are asked whether it is still to pay \(it shows as overdue\) or paid already/);
    const v = viewOf(makePlan(input, asOf, "owner"), { transactions: [], accounts: [], asOf });
    expect(v.state).toBe("overdue");
  });

  it("finds the entry made before the plan was, by its kind and amount", () => {
    const plan = makePlan(input, asOf, "owner");
    expect(plan.createdOn).toBe(asOf);
    expect(likelyPayments(plan, [paidBefore], [plan]).map((t) => t.id)).toEqual(["cut"]);
    // A plan made before its own day still wants its payment after it was made.
    const ahead = makePlan({ ...input, due: "2026-11-20" }, "2026-10-21", "owner");
    expect(likelyPayments(ahead, [paidBefore], [ahead])).toEqual([]);
  });

  it("can be edited after it is paid, and stays paid", () => {
    const plan = linkPayments(makePlan(input, asOf, "owner"), ["cut"], [paidBefore], asOf);
    expect(plan.status).toBe("done");
    const check = checkPlan({ ...input, title: "Haircut, barber" }, { plans: [plan], reference, asOf, editing: plan.id, closed: true });
    expect(check.problems).toEqual([]);
    expect(check.notes.join(" ")).not.toMatch(/already passed/);
  });

  /*
   * The owner, 27 October 2026: "what if I edit a plan that allready in
   * deadline or the deadline is passed". Each case says what happens to it.
   */
  it("editing an overdue plan, left on its day, says how late it is and how to move it", () => {
    const plan = makePlan(input, "2026-10-01", "owner");
    const check = checkPlan({ ...input, title: "Haircut, barber" }, { plans: [plan], reference, asOf, editing: plan.id, was: { due: plan.due } });
    expect(check.problems).toEqual([]);
    expect(check.notes.join(" ")).toMatch(/^It was due October 20, 2026, 6 days ago, and shows as overdue\. Change the day to move it/);
  });

  it("moved to another day gone, it stays overdue; to a later day, it no longer is", () => {
    const plan = makePlan(input, "2026-10-01", "owner");
    const ctx2 = { plans: [plan], reference, asOf, editing: plan.id, was: { due: plan.due } };
    expect(checkPlan({ ...input, due: "2026-10-22" }, ctx2).notes.join(" ")).toMatch(/has passed too, so it would stay overdue\. Pick today or a later day/);
    expect(checkPlan({ ...input, due: "2026-11-05" }, ctx2).notes.join(" ")).toMatch(/^Moved from October 20, 2026 to November 5, 2026; the move is kept in its history, and it is no longer overdue\./);
    // Today is not gone.
    expect(checkPlan({ ...input, due: asOf }, ctx2).notes.join(" ")).toMatch(/no longer overdue/);
    const moved = editPlan(plan, { ...input, due: "2026-11-05" }, asOf);
    expect(moved.moves).toEqual([{ from: "2026-10-20", to: "2026-11-05", on: asOf }]);
    expect(viewOf(moved, { transactions: [], accounts: [], asOf }).state).not.toBe("overdue");
  });

  it("cannot cost less than is paid on it; at exactly that, it is paid in full", () => {
    const part = tx({ id: "part", item: "Self Care", description: "Barber", amount: 10_000, date: "2026-10-21" });
    const plan = linkPayments(makePlan(input, "2026-10-01", "owner"), ["part"], [part], asOf);
    expect(plan.status).toBe("open");
    const ctx2 = { plans: [plan], reference, asOf, editing: plan.id, paid: 10_000, was: { due: plan.due } };
    expect(checkPlan({ ...input, amount: 8_000 }, ctx2).problems).toEqual(["₱100.00 is paid on it already. Make the amount ₱100.00 or more, or unlink a payment first."]);
    expect(checkPlan({ ...input, amount: 10_000 }, ctx2).notes.join(" ")).toMatch(/at this amount it is paid in full and is marked paid/);
    const settled = editPlan(plan, { ...input, amount: 10_000 }, asOf, [part]);
    expect(settled.status).toBe("done");
    expect(settled.closedOn).toBe("2026-10-21");
    expect(viewOf(settled, { transactions: [part], accounts: [], asOf }).state).toBe("paid");
    // More than is paid: still open, the rest left.
    const more = editPlan(plan, { ...input, amount: 12_000 }, asOf, [part]);
    expect(more.status).toBe("open");
    expect(viewOf(more, { transactions: [part], accounts: [], asOf }).left).toBe(2_000);
    // Without the entries, an edit never closes it.
    expect(editPlan(plan, { ...input, amount: 10_000 }, asOf).status).toBe("open");
  });

  it("paid, then made to cost more, stays closed and says how to open it again", () => {
    const plan = linkPayments(makePlan(input, asOf, "owner"), ["cut"], [paidBefore], asOf);
    const check = checkPlan({ ...input, amount: 20_000 }, { plans: [plan], reference, asOf, editing: plan.id, closed: true, paid: 15_000, was: { due: plan.due } });
    expect(check.problems).toEqual([]);
    expect(check.notes.join(" ")).toMatch(/₱150\.00 is paid on it\. Saved at ₱200\.00, it stays closed; if ₱50\.00 more is still to pay, open it again from its sheet\./);
    expect(editPlan(plan, { ...input, amount: 20_000 }, asOf, [paidBefore]).status).toBe("done");
  });

  it("a month already over is gone; this month is not", () => {
    const month = { ...input, due: "2026-09-30", dueKind: "month" as const };
    expect(checkPlan(month, { plans: [], reference, asOf }).notes.join(" ")).toMatch(/^Sometime in September 2026 has already passed/);
    expect(checkPlan({ ...month, due: "2026-10-31" }, { plans: [], reference, asOf }).notes.join(" ")).not.toMatch(/passed/);
  });

  it("put back after its day is open again, overdue, with its payments as they were", () => {
    const removed = removePlan(makePlan(input, "2026-10-10", "owner"), asOf);
    const back = reopenPlan(removed);
    expect(back.status).toBe("open");
    expect(viewOf(back, { transactions: [], accounts: [], asOf }).state).toBe("overdue");
  });

  it("a binned payment leaves it unpaid, and restoring the entry pays it again", () => {
    const plan = linkPayments(makePlan(input, asOf, "owner"), ["cut"], [paidBefore], asOf);
    const binned = viewOf(plan, { transactions: [], accounts: [], asOf });
    expect(binned.paid).toBe(0);
    expect(binned.goneNote).toBeTruthy();
    const restored = viewOf(plan, { transactions: [paidBefore], accounts: [], asOf });
    expect(restored.paid).toBe(15_000);
    expect(restored.state).toBe("paid");
  });
});
