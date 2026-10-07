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
