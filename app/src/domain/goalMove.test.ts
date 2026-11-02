/**
 * Owner, 27 October 2026: "what if I want to use the money in goal to another
 * ... what if I transfer the goal to another account or another goal", and
 * "what if the plan i made is connected to a goal then I edit the goal change
 * it to none goal". Figures invented.
 */
import { describe, expect, it } from "vitest";
import type { Account } from "./accounts";
import { closePlansNote, goalParentNote, planGoalMove } from "./goalMove";
import type { Plan } from "./planner";
import type { Transaction } from "./types";

const acct = (id: string, name: string, kind: Account["kind"], extra: Partial<Account> = {}): Account => ({ id, name, kind, archived: false, ...extra });
const bank = acct("b", "Maya Bank", "savings");
const phone = acct("g1", "Maya Bank (Phone)", "goal", { parentId: "b", target: 2_000_000 });
const trip = acct("g2", "Maya Bank (Trip)", "goal", { parentId: "b", target: 500_000 });
const cash = acct("c", "Cash", "spending");
const shut = acct("x", "Old wallet", "spending", { archived: true });
const accounts = [bank, phone, trip, cash, shut];
const into = (to: string, amount: number, n: number): Transaction =>
  ({ id: `t${n}`, recordNumber: n, date: "2026-10-01", type: "Transfer", fromWallet: "Maya Bank", toWallet: to, category: "", item: "", description: "", amount, fee: 0, total: amount, notes: "", status: "Transferred" }) as Transaction;
const ledger = [into("Maya Bank (Phone)", 600_000, 1), into("Maya Bank (Trip)", 100_000, 2)];
const plan = { id: "p1", title: "New phone", amount: 2_000_000, due: "2027-03-31", status: "open", goalId: "g1", wallet: "Maya Bank (Phone)", setAside: true } as unknown as Plan;
const other = { id: "p2", title: "Haircut", amount: 15_000, due: "2026-11-20", status: "open", setAside: true } as unknown as Plan;
const ctx = (choice: "keep" | "follow" | "free") => ({ accounts, transactions: ledger, plans: [plan, other], choice, today: "2026-11-02", nextRecordNumber: 100 });

describe("moving a goal's money", () => {
  it("is one transfer, all of it by default, and says what the other goal will hold", () => {
    const m = planGoalMove(phone, "g2", null, ctx("keep"));
    expect(m.blocked).toBeUndefined();
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ type: "Transfer", fromWallet: "Maya Bank (Phone)", toWallet: "Maya Bank (Trip)", amount: 600_000, recordNumber: 100, date: "2026-11-02" });
    expect(m.notes.join(" ")).toContain("Maya Bank (Trip) will hold ₱7,000.00 of its ₱5,000.00, its target reached");
    expect(m.notes.join(" ")).toContain('"New phone" keeps saving in Maya Bank (Phone), which will be empty');
    expect(m.plans).toEqual([]);
  });

  it("takes the plans with the money, or lets them go to safe to spend", () => {
    const follow = planGoalMove(phone, "g2", 200_000, ctx("follow"));
    expect(follow.plans.find((p) => p.id === "p1")).toMatchObject({ goalId: "g2", wallet: "Maya Bank (Trip)" });
    expect(follow.plans.find((p) => p.id === "p2")).toEqual(other);
    expect(follow.notes.join(" ")).toContain("₱4,000.00 stays in Maya Bank (Phone)");
    const free = planGoalMove(phone, "c", null, ctx("free"));
    expect(free.plans.find((p) => p.id === "p1")).toMatchObject({ goalId: undefined, wallet: "", setAside: true });
    expect(free.notes.join(" ")).toContain("In Cash it is money to spend: it counts in safe to spend from now.");
  });

  it("never lets a plan follow into an account that is not a goal", () => {
    const m = planGoalMove(phone, "c", null, ctx("follow"));
    expect(m.plans.find((p) => p.id === "p1")?.goalId).toBeUndefined();
    expect(m.notes.join(" ")).toContain("Cash is not a goal, so a plan cannot save in it");
  });

  it("refuses what cannot be: more than it holds, a closed account, itself, nothing in it", () => {
    expect(planGoalMove(phone, "g2", 700_000, ctx("keep")).blocked).toBe("Maya Bank (Phone) holds ₱6,000.00, so at most that can move.");
    expect(planGoalMove(phone, "x", null, ctx("keep")).blocked).toContain("Old wallet is closed");
    expect(planGoalMove(phone, "g1", null, ctx("keep")).blocked).toBe("That is the same goal.");
    expect(planGoalMove(phone, "nope", null, ctx("keep")).blocked).toBe("Pick where the money goes.");
    expect(planGoalMove(acct("g3", "Empty", "goal"), "g2", null, ctx("keep")).blocked).toBe("Empty holds nothing, so there is no money to move.");
    expect(planGoalMove(phone, "g2", 0, ctx("keep")).blocked).toBe("Say how much to move, more than PHP 0.00.");
  });

  it("says what moving a goal inside another account means, and what closing does to its plans", () => {
    expect(goalParentNote(phone, acct("b2", "GoTyme", "savings"), ledger)).toContain("Its ₱6,000.00 stays its own here");
    expect(closePlansNote(phone, [plan, other])).toContain('"New phone" saves in it: after closing, it is counted in safe to spend again.');
    expect(closePlansNote(trip, [plan, other])).toBe("");
  });
});
