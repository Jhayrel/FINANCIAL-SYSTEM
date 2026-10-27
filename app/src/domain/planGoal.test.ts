/**
 * A goal for a plan (planGoal.ts). The owner, 27 October 2026: "it just keep
 * creating a goal it shouldnt do that", then "it will not do goal until it is
 * actually created also add validation etc".
 */
import { describe, expect, it } from "vitest";
import type { Account } from "./accounts";
import { asksForGoal, goalDeadline, goalForPlan, goalInStep } from "./planGoal";
import { makePlan, NO_DATE } from "./planner";

const asOf = "2026-10-27";
const bank: Account = { id: "bank", name: "Maya Bank (Personal savings)", kind: "savings", archived: false };
const cash: Account = { id: "cash", name: "Cash", kind: "spending", archived: false };
const accounts = [cash, bank];
const ctx = { accounts, plans: [], transactions: [], asOf };
const phone = { title: "iPhone 18 Pro Max", amount: 10_000_000, due: "2027-02-28", dueKind: "month" as const };

describe("the goal a plan would get", () => {
  it("sits inside a savings account, named as Settings names one, aiming for the plan's day", () => {
    const g = goalForPlan(phone, ctx);
    expect(g).toMatchObject({ name: "Maya Bank (iPhone 18 Pro Max)", parentId: "bank", target: 10_000_000, deadline: "2027-02-28", reuse: null, problems: [] });
    expect(g.notes.join(" ")).toContain("made inside Maya Bank (Personal savings) when you save");
    expect(g.notes.join(" ")).toContain("put in about ₱25,000.00 a month for 4 months");
  });
  it("never takes the year 9999, or a day gone, as a deadline", () => {
    expect(goalForPlan({ ...phone, due: NO_DATE, dueKind: "none" }, ctx).deadline).toBeUndefined();
    expect(goalForPlan({ ...phone, due: "2026-10-01", dueKind: "day" }, ctx).deadline).toBeUndefined();
    expect(goalDeadline({ due: "9999-12-31" }, asOf)).toBeUndefined();
  });
  it("uses the goal already there, never a second, and says how it differs", () => {
    const old: Account = { id: "g1", name: "iPhone 18 Pro Max", kind: "goal", target: 8_000_000, archived: false };
    const g = goalForPlan(phone, { ...ctx, accounts: [...accounts, old] });
    expect(g.reuse?.id).toBe("g1");
    expect(g.notes.join(" ")).toContain("no new one is made");
    expect(g.notes.join(" ")).toContain("Its target is ₱80,000.00 and this plan is ₱100,000.00");
    const fund: Account = { id: "g2", name: "iPhone 18 Pro Max fund", kind: "goal", target: 10_000_000, archived: false };
    expect(goalForPlan(phone, { ...ctx, accounts: [...accounts, fund] }).reuse?.id).toBe("g2");
  });
  it("says what is missing instead of making nothing in silence", () => {
    expect(goalForPlan({ ...phone, title: " " }, ctx).problems[0]).toMatch(/^Say what it is for first/);
    expect(goalForPlan({ ...phone, amount: null }, ctx).problems[0]).toMatch(/^Put in how much it will cost first/);
    expect(goalForPlan(phone, { ...ctx, accounts: [cash] }).problems[0]).toMatch(/no savings|savings or reserve account/);
  });
  it("warns when another plan saves in the same goal", () => {
    const old: Account = { id: "g1", name: "Maya Bank (iPhone 18 Pro Max)", kind: "goal", target: 10_000_000, archived: false };
    const other = { ...makePlan({ title: "Case", amount: 100_000, due: "2027-02-28", item: "", wallet: "", goalId: "g1", need: false, setAside: false, notes: "" }, asOf, "owner") };
    expect(goalForPlan(phone, { ...ctx, accounts: [...accounts, old], plans: [other] }).notes.join(" ")).toContain('saving for "Case" too');
  });
});

describe("a goal made for a plan follows it", () => {
  const before = makePlan({ title: "iPhone", amount: 10_000_000, due: "2027-02-28", dueKind: "month", item: "", wallet: "", need: false, setAside: false, notes: "" }, asOf, "owner");
  const goal: Account = { id: "g", name: "Maya Bank (iPhone)", kind: "goal", target: 10_000_000, deadline: "2027-02-28", archived: false };
  it("moves its target and deadline with the plan's", () => {
    expect(goalInStep(goal, before, { ...before, amount: 9_000_000 }, asOf)).toEqual({ target: 9_000_000 });
    expect(goalInStep(goal, before, { ...before, due: "2027-03-31" }, asOf)).toEqual({ deadline: "2027-03-31" });
    expect(goalInStep({ ...goal, deadline: "9999-12-31" }, { ...before, due: NO_DATE, dueKind: "none" }, before, asOf)).toEqual({ deadline: "2027-02-28" });
  });
  it("leaves a goal set by hand alone", () => {
    expect(goalInStep({ ...goal, target: 5_000_000, deadline: "2027-06-30" }, before, { ...before, amount: 9_000_000, due: "2027-03-31" }, asOf)).toBeNull();
  });
});

describe("asked in the chat", () => {
  it.each(["make a goal for it", "create a savings goal for the iphone plan", "put it in a goal", "save for it in a new goal"])("%s", (t) => expect(asksForGoal(t)).toBe(true));
  it.each(["what are my goals", "save for the phone plan in Phone fund", "I want to save 5000 by december"])("not: %s", (t) => expect(asksForGoal(t)).toBe(false));
});
