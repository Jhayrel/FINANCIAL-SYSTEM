/**
 * The owner's phone and the process test, 3 November 2026. Each case here
 * failed before its fix. Invented rows only.
 */
import { describe, expect, it } from "vitest";

import type { Account } from "./accounts";
import { chartTopic } from "./charts";
import { effectMeaning } from "./debtWords";
import { readGoalAsk } from "./goalAsk";
import { makePlan, viewOf, type PlanInput } from "./planner";
import { closedPlansWords, readPlannerAsk } from "./plannerAsk";
import { readPlanIntent } from "./planIntent";
import { asksToUseAi, readQuickAsk } from "./quickAsk";
import { readAffordAsk, recurringLaterAnswer, recurringNamed } from "./affordAsk";
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
    ["bank", "Maya Bank (Personal savings)", "savings"],
  ] as const
).map(([id, name, kind]) => ({ id, name, kind, archived: false }) as unknown as Account);

let n = 0;
const row = (description: string, amount: number): Transaction => {
  n += 1;
  return { id: `r${n}`, recordNumber: n, date: "2026-10-10", type: "Spending", fromWallet: "Gcash", toWallet: "", category: "Spending", item: "Online Buy", description, amount, fee: 0, total: amount, notes: "", status: "Paid" } as Transaction;
};

describe("a breakdown asked for with care", () => {
  const asked = "Can you give me a break down of expenses based on categories so I can do Budgeting. Make sure its accurate";

  it("is the month's spending by kind, however long the asking", () => {
    expect(readQuickAsk(asked)).toMatchObject({ kind: "biggest", all: true });
    expect(readQuickAsk("Can you give me a break down of expenses based on categories so I can do Budgeting")).toMatchObject({ kind: "biggest", all: true });
  });

  it("never takes \"down\" from \"break down\" as what it is about", () => {
    const rows = [row("phone down payment", 300000), row("down jacket", 52600), row("lunch", 15000)];
    expect(chartTopic(asked, rows)).toBe("");
    expect(chartTopic("show my spending, broken down by kind", rows)).toBe("");
  });

  it("a long message that is not one still is not", () => {
    expect(readQuickAsk("I spent a lot this month on food and travel and I want to know if I should cut down on something before my allowance comes")).toBeNull();
  });
});

describe("use ai", () => {
  it("is asking for the AI, said any of these ways", () => {
    for (const said of ["Use ai", "use the ai please", "ask the AI instead", "answer that with gemini", "pls use ai", "use AI for that", "Try the ai"]) expect(asksToUseAi(said), said).toBe(true);
  });

  it("not a question that mentions the AI", () => {
    for (const said of ["use ai to make a budget for food", "is the ai on?", "how do I use ai", "ai"]) expect(asksToUseAi(said), said).toBe(false);
  });
});

describe("a plan to save, said as one", () => {
  it("is not a target worked out in months", () => {
    expect(readGoalAsk("I am planning to save 1500 from my salary", asOf)).toBeNull();
    expect(readGoalAsk("I'll save 2000 when my allowance comes", asOf)).toBeNull();
    expect(readGoalAsk("i plan to save 3000 from my sahod", asOf)).toBeNull();
  });

  it("a target keeps its own words", () => {
    expect(readGoalAsk("I want to save 5000 by december", asOf)).not.toBeNull();
    expect(readGoalAsk("how long to save 10k", asOf)).not.toBeNull();
  });

  it("says it comes from the salary when it comes in", () => {
    const read = readPlanIntent("I am planning to save 1500 from my salary", { reference, transactions: [], asOf, debtNames: [], accounts });
    expect(read).toMatchObject({ kind: "later", plans: [{ amount: 150000, wallet: "" }] });
    expect(read?.kind === "later" ? read.plans[0]?.notes : "").toMatch(/From your salary when it comes in\./);
  });
});

describe("a deposit said done pays the plan to save", () => {
  const input: PlanInput = { title: "Deposit to Maya Bank", amount: 300_000, due: "2026-11-09", item: "", wallet: "", need: true, setAside: true, notes: "", into: "Maya Bank (Personal savings)" };
  const plan = makePlan(input, asOf, "owner", "s1");
  const lunch = makePlan({ ...input, title: "Lunch with friends", amount: 50_000, into: undefined, item: "Food" }, asOf, "owner", "p1");
  const ask = (said: string, focus: typeof plan | null = null) => readPlannerAsk(said, { plans: [plan, lunch], reference, transactions: [], asOf, focus });

  it("from the wallet said, never the plan's wallet changed", () => {
    expect(ask("I deposited the money for the deposit to maya bank plan from maya")).toMatchObject({ kind: "pay", plan: { id: "s1" }, wallet: "Maya", amount: null });
  });

  it("known by where it went, with the sum", () => {
    expect(ask("deposited 3000 to maya bank from maya for the plan")).toMatchObject({ kind: "pay", plan: { id: "s1" }, wallet: "Maya", amount: 300_000 });
  });

  it("\"I moved it\" about that plan", () => {
    expect(ask("I moved it", plan)).toMatchObject({ kind: "pay", plan: { id: "s1" } });
  });

  it("changing where it goes is still an edit", () => {
    expect(ask("the deposit to maya bank plan should go to extra cash")).toMatchObject({ kind: "edit", plan: { id: "s1" } });
  });
});

describe("an On behalf card says what the money is, by where the line stands", () => {
  const line = { kind: "receivable", form: "pass-through" } as const;

  it("money from someone who owed nothing is theirs, held", () => {
    expect(effectMeaning("collect", line, 0)).toMatch(/^They owe you nothing on this line, so this is their money/);
    expect(effectMeaning("collect", line, 59900)).toBe("They paid you back. It is not income: it was your money all along.");
    expect(effectMeaning("collect", line)).toBe("They paid you back. It is not income: it was your money all along.");
  });

  it("paying for them from what they left is not spending", () => {
    expect(effectMeaning("lend", line, -100000)).toMatch(/out of the money they left with you/);
    expect(effectMeaning("lend", line, 0)).toMatch(/^Paid or sent on their behalf/);
  });
});

describe("a plan to save, done, says moved", () => {
  it("in the list of done plans", () => {
    const saved = { ...makePlan({ title: "Deposit to Maya Bank", amount: 10_000, due: "2026-11-09", item: "", wallet: "Maya", need: true, setAside: true, notes: "", into: "Maya Bank (Personal savings)" }, asOf, "owner", "s2"), status: "done" as const, closedOn: asOf };
    const words = closedPlansWords([viewOf(saved, { transactions: [], accounts, asOf })], "done", asOf);
    expect(words).toMatch(/^\*\*1 plan moved:\*\*/);
    expect(words).toMatch(/Deposit to Maya Bank: ₱100\.00, moved on November 3, 2026/);
    expect(words).not.toMatch(/paid/);
  });
});

describe("can I afford it, for a later month", () => {
  const ctxAfford = { reference, transactions: [] as Transaction[], asOf, debtNames: [] };

  it("is that month's question, a plan asked about", () => {
    expect(readPlanIntent("can I afford a 2000 jacket next month?", ctxAfford)).toMatchObject({ kind: "later", asked: true, plans: [{ title: "Jacket", amount: 200_000, due: "2026-12-31", dueKind: "month" }] });
    expect(readPlanIntent("can I afford a 2000 jacket on december 20?", ctxAfford)).toMatchObject({ kind: "later", plans: [{ due: "2026-12-20", dueKind: "day" }] });
  });

  it("today, this month or no time said stays today's money", () => {
    expect(readPlanIntent("can I afford a 2000 jacket?", ctxAfford)).toBeNull();
    expect(readPlanIntent("can I afford a 2000 jacket today?", ctxAfford)).toBeNull();
    expect(readPlanIntent("can I afford a 2000 jacket on november 20?", ctxAfford)).toBeNull();
    expect(readPlanIntent("can I afford it next month?", ctxAfford)).toBeNull();
  });

  it("a bill is not made a plan, and is known by its own word", () => {
    expect(readPlanIntent("can I afford my wifi bill next month?", ctxAfford)).toBeNull();
    expect(recurringNamed("can I afford my wifi bill next month?", reference)).toEqual(["Globe at Home Wifi"]);
    expect(recurringNamed("can I afford a jacket next month?", reference)).toEqual([]);
  });

  it("says the bill is counted every month, with what it last cost", () => {
    const paid = { ...row("globe", 99_900), category: "Bills", item: "Globe at Home Wifi", date: "2026-10-12" } as Transaction;
    const words = recurringLaterAnswer(["Globe at Home Wifi"], "next month", [paid], (c) => `PHP ${(c / 100).toFixed(2)}`);
    expect(words).toMatch(/^Globe at Home Wifi is among your bills and subscriptions, so it is counted in every month already, next month included/);
    expect(words).toMatch(/Globe at Home Wifi: PHP 999\.00 last time, on October 12, 2026\./);
  });

  it("\"bill\" is never a thing bought", () => {
    const rows = [row("dito bill", 19_900), row("dito bill", 19_900)];
    expect(readAffordAsk("can I afford my wifi bill next month?", rows, reference, asOf).items).not.toContain("Bill");
  });
});
