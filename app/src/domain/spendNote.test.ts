/**
 * Notes after spending (`spendNote.ts`).
 *
 * The owner, 28 September 2026: say it when the month goes over, "but dont
 * make those pushy what if its food or gas or whatever that is important
 * that is not in the budget but its need? just make it good and
 * reasonable". These pin the restraint as much as the notes.
 */

import { describe, expect, it } from "vitest";

import { acceptableWording, spendNoteFor } from "./spendNote";
import type { Budgets, Transaction } from "./types";
import type { Debt } from "./debt";

let n = 0;
const spend = (date: string, item: string, pesos: number, category: "Spending" | "Bills" = "Spending"): Transaction => {
  n += 1;
  return {
    id: `s-${n}`, recordNumber: n, date, type: "Spending", fromWallet: "Cash", toWallet: "", category, item, description: "",
    amount: pesos * 100, fee: 0, total: pesos * 100, notes: "", status: "Paid",
  };
};
const twelve = (sep: number): number[] => [0, 0, 0, 0, 0, 0, 0, 0, sep, 0, 0, 0];
const budgets: Budgets = { "2026": { spending: twelve(700_000) as never, billsSubs: twelve(100_000) as never } };
const asOf = "2026-09-28";

// September so far: PHP 6,900.00 of a PHP 7,000.00 spending budget.
const month = [spend("2026-09-02", "Food", 2_500), spend("2026-09-10", "Treat", 1_300), spend("2026-09-15", "Online Buy", 1_500), spend("2026-09-20", "Gas", 1_600)];

describe("when the month goes past its budget", () => {
  it("counts a need, and judges nothing", () => {
    const note = spendNoteFor([spend(asOf, "Food", 150)], month, budgets, asOf, new Set());
    expect(note?.stage).toBe("crossed");
    expect(note?.need).toBe(true);
    expect(note?.text).toContain("It is a need, so it is counted and that is all.");
    expect(note?.text).toContain("Online Buy ₱1,500.00 and Treat ₱1,300.00");
    expect(note?.text).not.toMatch(/!|should|must|stop/i);
  });

  it("says a want plainly, and leaves the call to the owner", () => {
    const note = spendNoteFor([spend(asOf, "Treat", 500)], month, budgets, asOf, new Set());
    expect(note?.text).toBe("Treat ₱500.00 takes September's spending ₱400.00 past its ₱7,000.00 budget, with 3 days left. Your call; the Budget screen shows where the month went.");
  });

  it("is said once a month", () => {
    const first = spendNoteFor([spend(asOf, "Treat", 500)], month, budgets, asOf, new Set());
    expect(spendNoteFor([spend(asOf, "Treat", 500)], month, budgets, asOf, new Set([first!.id]))).toBeNull();
  });

  it("calls a bill a bill: it has to be paid", () => {
    const note = spendNoteFor([spend(asOf, "Globe at Home Wifi", 1_199, "Bills")], [], budgets, asOf, new Set());
    expect(note?.text).toContain("A bill has to be paid");
  });
});

describe("restraint", () => {
  const over = [...month, spend("2026-09-25", "Online Buy", 900)];

  it("says nothing about a need once the month is already over", () => {
    expect(spendNoteFor([spend(asOf, "Gas", 300)], over, budgets, asOf, new Set())).toBeNull();
    expect(spendNoteFor([spend(asOf, "Food", 800)], over, budgets, asOf, new Set())).toBeNull();
  });

  it("mentions a want that is not small, once a day", () => {
    const note = spendNoteFor([spend(asOf, "Treat", 600)], over, budgets, asOf, new Set());
    expect(note?.stage).toBe("over-want");
    expect(spendNoteFor([spend(asOf, "Treat", 600)], over, budgets, asOf, new Set([note!.id]))).toBeNull();
    expect(spendNoteFor([spend(asOf, "Treat", 40)], over, budgets, asOf, new Set())).toBeNull();
  });

  it("says nothing about catching up on an earlier month", () => {
    expect(spendNoteFor([spend("2026-08-20", "Treat", 9_000)], month, budgets, asOf, new Set())).toBeNull();
  });

  it("says nothing when no budget is set", () => {
    expect(spendNoteFor([spend(asOf, "Treat", 9_000)], month, {}, asOf, new Set())).toBeNull();
  });
});

describe("near the budget", () => {
  it("says what is left a day, once, when the month passes nine tenths", () => {
    const early = [spend("2026-09-02", "Food", 3_000), spend("2026-09-10", "Treat", 3_000)];
    const note = spendNoteFor([spend(asOf, "Food", 400)], early, budgets, asOf, new Set());
    expect(note?.stage).toBe("near");
    // 28 September: three days left, today included, as the Budget screen counts them.
    expect(note?.text).toBe("September's spending is at 91% of its budget: ₱600.00 left for 3 days, about ₱200.00 a day.");
  });
});

describe("the model's wording", () => {
  const note = spendNoteFor([spend(asOf, "Food", 150)], month, budgets, asOf, new Set())!;

  it("is kept when it uses only the note's figures and stays calm", () => {
    expect(acceptableWording("Food ₱150.00 takes September ₱50.00 past its ₱7,000.00 budget. It's a need, so it's simply counted.", note)).toBe(true);
  });

  it("is thrown away for a figure it made up, or for preaching", () => {
    expect(acceptableWording("Food ₱150.00 puts you ₱2,000.00 over.", note)).toBe(false);
    expect(acceptableWording("You should stop spending on food!", note)).toBe(false);
  });
});

/*
 * 7 October 2026: "it warns me like you're using that money from credit and
 * you spend it to treat". And the limits audit: a limit crossed in a save
 * that also crossed the budget, or set after the kind was over, was never said.
 */
describe("borrowed money and limits", () => {
  const credit = { id: "maya-credit", name: "Maya Credit", kind: "payable", counterparty: "Maya", openedDate: "2026-01-01", wallet: "Maya", interestType: "none", interestRate: 0, notes: "", archived: false } as Debt;
  const ctx = { debts: [credit], accounts: ["Cash", "Maya"], spendingTypes: [{ name: "Treat", necessity: "discretionary" as const }, { name: "Food", necessity: "essential" as const }] };
  const draw = { ...spend("2026-09-26", "x", 5000), type: "Debt", category: "", item: "", fromWallet: "", toWallet: "Maya", debtId: "maya-credit", debtEffect: "draw", id: "draw" } as Transaction;
  const own = { ...spend("2026-09-20", "x", 500), type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "Maya", id: "own" } as Transaction;

  it("says how much of a treat was borrowed, and whose it was", () => {
    const treat = { ...spend(asOf, "Treat", 1_200), fromWallet: "Maya", id: "treat" } as Transaction;
    const note = spendNoteFor([treat], [own, draw], {}, asOf, new Set(), ctx);
    expect(note?.stage).toBe("borrowed");
    expect(note?.text).toContain("₱700.00 of this ₱1,200.00 Treat was borrowed money, from Maya Credit.");
    expect(note?.text).toContain("Your own money left: ₱0.00; borrowed still in your wallets: ₱4,300.00.");
    expect(note?.need).toBe(false);
  });

  it("is calm about a need", () => {
    const food = { ...spend(asOf, "Food", 800), fromWallet: "Maya", id: "food" } as Transaction;
    const note = spendNoteFor([food], [own, draw], {}, asOf, new Set(), ctx);
    expect(note?.text).toContain("It is a need, so this is for knowing.");
  });

  it("says nothing when their own money paid", () => {
    const food = { ...spend(asOf, "Food", 300), fromWallet: "Maya", id: "food" } as Transaction;
    expect(spendNoteFor([food], [own, draw], {}, asOf, new Set(), ctx)?.stage).not.toBe("borrowed");
  });

  it("says a limit already past, once, when that kind is next saved", () => {
    const set = { "2026": { spending: Array(12).fill(0), billsSubs: Array(12).fill(0), categories: { Treat: [0, 0, 0, 0, 0, 0, 0, 0, 100_000, 0, 0, 0] } } } as unknown as Budgets;
    const earlier = spend("2026-09-10", "Treat", 1_500);
    const note = spendNoteFor([spend(asOf, "Treat", 100)], [earlier], set, asOf, new Set());
    expect(note?.stage).toBe("limit");
    expect(spendNoteFor([spend(asOf, "Treat", 100)], [earlier], set, asOf, new Set([note!.id]))).toBeNull();
  });
});
