/**
 * A plan, its entry in the Database, and the entry edited (owner, 3 November
 * 2026: "What happens if I added it and edit it in database ... what field in
 * entry would it populate ... make sure it works"; "Pay? Make sure the logic
 * aligns to all and more accurate wording"). Invented accounts and rows.
 */
import { describe, expect, it } from "vitest";

import type { Account } from "./accounts";
import { planAlerts } from "./alerts";
import { readPlanCardChange } from "./planCard";
import { editPlan, inputOf, isSave, linkPayments, makePlan, plannedForBudget, planPaidBy, plansSetAside, viewOf, type Plan, type PlanInput } from "./planner";
import { readBudgetTotal } from "./budgetAsk";
import { changeRow, readEditAsk } from "./chatChanges";
import { planStatusWords, readPlannerAsk } from "./plannerAsk";
import type { ReferenceLists, Transaction } from "./types";

const asOf = "2026-11-03";
const reference = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Extra Cash", "Maya Bank (Personal savings)"],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Online Buy", remark: "" }],
  stopped: [],
} as unknown as ReferenceLists;
const accounts = (
  [
    ["cash", "Cash", "spending"],
    ["gcash", "Gcash", "spending"],
    ["maya", "Maya", "spending"],
    ["extra", "Extra Cash", "reserve"],
    ["bank", "Maya Bank (Personal savings)", "savings"],
  ] as const
).map(([id, name, kind]) => ({ id, name, kind, archived: false }) as unknown as Account);
const BANK = "Maya Bank (Personal savings)";
const saveInput: PlanInput = { title: "Save into Maya Bank", amount: 150_000, due: "2026-11-30", dueKind: "month", item: "", wallet: "", into: BANK, need: true, setAside: true, notes: "From your salary when it comes in." };
const view = (p: Plan, rows: readonly Transaction[] = []) => viewOf(p, { transactions: rows, accounts, asOf });

/** The transfer Move it saves: From the wallet, To the account, the plan's title as its description. */
const moved = (over: Partial<Transaction> = {}): Transaction =>
  ({ id: "t-move", recordNumber: 3964, date: asOf, type: "Transfer", fromWallet: "Gcash", toWallet: BANK, category: "", item: "", description: "Save into Maya Bank", amount: 150_000, fee: 0, total: 150_000, notes: "Moved from the Planner: Save into Maya Bank.", status: "Transferred", ...over }) as Transaction;

describe("a plan to save stays one through every change", () => {
  it("inputOf carries every field, where the money goes included", () => {
    const p = makePlan(saveInput, asOf, "ai", "s1");
    expect(inputOf(p)).toMatchObject({ into: BANK, setAside: true, notes: saveInput.notes });
    expect(inputOf(p, { amount: 200_000 })).toMatchObject({ into: BANK, amount: 200_000 });
  });

  it("changed by words on its card (\"... this month\"): still into the account, Move it, not Pay", () => {
    const p = makePlan({ ...saveInput, due: "9999-12-31", dueKind: "none" }, asOf, "ai", "s1");
    const change = readPlanCardChange("I am planning to save 1500 from my salary this month", inputOf(p), { reference, asOf });
    expect(change?.input).toMatchObject({ into: BANK, due: "2026-11-30", dueKind: "month" });
    const again = makePlan(change!.input, asOf, "ai", "s1");
    expect(isSave(again)).toBe(true);
    const month = plannedForBudget([view(again)], 2026, 11, reference, asOf);
    expect(month.saving).toBe(150_000);
    expect(month.spending).toBe(0);
  });

  it("its amount changed from the chat keeps it a plan to save", () => {
    const p = makePlan(saveInput, asOf, "ai", "s1");
    expect(isSave(editPlan(p, inputOf(p, { amount: 200_000 }), asOf))).toBe(true);
  });
});

describe("one saved as spending by mistake is said, never changed by itself", () => {
  const wrong = makePlan({ ...saveInput, into: undefined }, asOf, "ai", "w1");

  it("the bell names it and how to put it right", () => {
    const found = planAlerts([wrong], [], accounts, asOf, null).find((a) => a.id === "plan-kind-w1");
    expect(found?.title).toBe("Save into Maya Bank is set as spending");
    expect(found?.detail).toMatch(/Edit it and pick To save or move, into Maya Bank \(Personal savings\)/);
  });

  it("one sentence in the chat makes it a plan to save", () => {
    expect(readPlannerAsk("make the save into maya bank plan a saving into maya bank", { plans: [wrong], reference, transactions: [], asOf })).toMatchObject({ kind: "edit", input: { into: BANK } });
  });

  it("a real purchase named the same way is left alone", () => {
    const shoes = makePlan({ ...saveInput, title: "Shoes", into: undefined, item: "Online Buy" }, asOf, "ai", "p1");
    expect(planAlerts([shoes], [], accounts, asOf, null).some((a) => a.id.startsWith("plan-kind-"))).toBe(false);
  });
});

describe("added as a plain entry, then counted", () => {
  const plan = makePlan(saveInput, asOf, "ai", "s1");

  it("a transfer into the account is offered as the plan's money, sure when it is the amount", () => {
    expect(planPaidBy(moved({ id: "t-plain", description: "" }), [plan], [])).toMatchObject({ plan: { id: "s1" }, left: 150_000, sure: true });
  });

  it("before it is counted, safe to spend still holds it back; after, it does not", () => {
    expect(plansSetAside([view(plan, [moved()])]).total).toBe(150_000);
    const linked = linkPayments(plan, ["t-move"], [moved()], asOf);
    expect(linked.status).toBe("done");
    expect(plansSetAside([view(linked, [moved()])]).total).toBe(0);
  });
});

describe("its entry edited in the Database", () => {
  const plan = linkPayments(makePlan(saveInput, asOf, "ai", "s1"), ["t-move"], [moved()], asOf);

  it("the amount edited down: open again with what is left, and said", () => {
    const v = view(plan, [moved({ amount: 100_000, total: 100_000 })]);
    expect(v.state).not.toBe("paid");
    expect(v.left).toBe(50_000);
    expect(v.goneNote).toMatch(/now comes to ₱1,000\.00 of ₱1,500\.00 \(an entry was edited\), so ₱500\.00 is left again/);
    expect(plansSetAside([v]).total).toBe(50_000);
  });

  it("done for less on purpose stays done", () => {
    const settled = linkPayments(makePlan(saveInput, asOf, "ai", "s2"), ["t-move"], [moved({ amount: 100_000, total: 100_000 })], asOf, true);
    expect(settled.settled).toBe(true);
    expect(view(settled, [moved({ amount: 100_000, total: 100_000 })]).state).toBe("paid");
  });

  it("the amount edited up: still done, the difference said", () => {
    expect(view(plan, [moved({ amount: 200_000, total: 200_000 })]).words).toMatch(/₱500\.00 more than planned/);
  });

  it("sent into another account instead: no longer this plan's money, and said", () => {
    const v = view(plan, [moved({ toWallet: "Extra Cash" })]);
    expect(v.state).not.toBe("paid");
    expect(v.left).toBe(150_000);
    expect(v.goneNote).toMatch(/#3964 is linked to it but no longer goes into Maya Bank \(Personal savings\)/);
  });

  it("a fee added to the transfer is spending, not saving: the plan is still done", () => {
    expect(view(plan, [moved({ fee: 1_500, total: 151_500 })]).state).toBe("paid");
  });

  it("moved to the bin: open again", () => {
    const v = view(plan, []);
    expect(v.state).not.toBe("paid");
    expect(v.goneNote).toMatch(/no longer in the ledger/);
  });
});

describe("asked in the chat", () => {
  const plan = linkPayments(makePlan(saveInput, asOf, "ai", "s1"), ["t-move"], [moved()], asOf);

  it("where a plan stands, from its live entries, said as moved", () => {
    expect(readPlannerAsk("how is the save into maya bank plan?", { plans: [plan], reference, transactions: [], asOf })).toMatchObject({ kind: "status", plan: { id: "s1" } });
    const rows = [moved({ amount: 100_000, total: 100_000 })];
    const words = planStatusWords(view(plan, rows), rows, asOf);
    expect(words).toMatch(/Moved ₱1,000\.00 of ₱1,500\.00/);
    expect(words).toMatch(/Moved so far: ₱1,000\.00, by #3964 on November 3, 2026\./);
    expect(words).toMatch(/₱500\.00 left to move\. Safe to spend holds it back this month\./);
    expect(words).not.toMatch(/Paid/);
  });

  it("an entry sent elsewhere is not listed as moving it", () => {
    const rows = [moved({ toWallet: "Extra Cash" })];
    const words = planStatusWords(view(plan, rows), rows, asOf);
    expect(words).toMatch(/Nothing moved yet\./);
    expect(words).toMatch(/#3964 is linked to it but no longer goes into Maya Bank/);
  });

  it("\"change #3964 to extra cash\" is that entry's destination, never a budget", () => {
    expect(readBudgetTotal("change #3964 to extra cash")).toBeNull();
    const ask = readEditAsk("change #3964 to extra cash", reference, asOf);
    expect(ask).toMatchObject({ target: "#3964", change: { wallet: { to: "Extra Cash", where: true } } });
    const after = changeRow(moved(), ask!.change, [], reference, []);
    expect(after).toMatchObject({ fromWallet: "Gcash", toWallet: "Extra Cash" });
  });

  it("an amount or a kind after \"to\" is still that", () => {
    expect(readEditAsk("change #3964 to 1000", reference, asOf)?.change).toEqual({ amount: 100_000 });
    expect(readEditAsk("change #0412 to food", reference, asOf)?.change).toEqual({ item: "Food" });
  });
});

describe("the Plans statement", () => {
  it("a plan to save reads as moved, into its account, with what changed under it", async () => {
    const { buildPlanSheet, planSheetCsv } = await import("./planSheet");
    const plan = linkPayments(makePlan(saveInput, asOf, "ai", "s1"), ["t-move"], [moved()], asOf);
    const rows = [moved({ amount: 100_000, total: 100_000 })];
    const sheet = buildPlanSheet([plan], { transactions: rows, accounts, asOf }, { from: "2026-11-01", to: "2026-11-30" }, "November 2026");
    expect(sheet.lines[0]).toMatchObject({ kind: "Part moved", toWallet: BANK, moneyIn: 150_000, moneyOut: 100_000, balance: 50_000 });
    expect(sheet.lines[0]?.detail).toMatch(/moved by #3964 · It was done, but what is linked to it now comes to ₱1,000\.00/);
    expect(sheet.headings).toEqual({ moneyIn: "Planned", moneyOut: "Paid or moved", balance: "Still to do" });
    expect(sheet.notes.join(" ")).toMatch(/₱500\.00 of what is still to do is money to move into savings or a goal/);
    expect(planSheetCsv(sheet).split("\r\n")[0]).toBe("Due,Plan,State,From,Into,Planned,Paid or moved,Still to do,Details");
  });
});
