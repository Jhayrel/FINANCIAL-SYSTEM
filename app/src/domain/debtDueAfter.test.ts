/**
 * A bill due a number of days after it closes, for any lender (owner, 16
 * November 2026: a credit line whose bill closes on the 6th and is due 15
 * days later was shown due a month after, because it was set to the 6th for
 * both). Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { debtDue, dueIfBorrowedOn, positionOf, type Debt } from "./debt";
import { readDebtDetailAsk, debtDetailChange } from "./debtDetailAsk";
import { dueChoiceOf, dueChoices, dueOfChoice, dueWords, sameDayNote } from "./debtWords";
import type { DebtEffect, Transaction } from "./types";

const line: Debt = {
  id: "line-d", name: "Line D", kind: "payable", counterparty: "Bank D", openedDate: "2026-07-01", wallet: "Wallet B",
  interestType: "none", interestRate: 0, notes: "", archived: false, form: "credit-line", billingDay: 6, dueAfterDays: 15, creditLimit: 800_000,
};
let n = 0;
const move = (date: string, effect: DebtEffect, amount: number, debt: Debt = line): Transaction =>
  ({ id: `m${(n += 1)}`, recordNumber: n, date, type: "Debt", fromWallet: effect === "draw" ? "" : debt.wallet, toWallet: effect === "draw" ? debt.wallet : "", category: "", item: debt.name, description: "", amount, fee: 0, total: amount, notes: "", status: "Done", debtId: debt.id, debtEffect: effect }) as Transaction;
const due = (rows: Transaction[], asOf: string, debt: Debt = line) => debtDue(positionOf(debt, rows, asOf), rows, asOf);

describe("due a number of days after the bill closes", () => {
  it("borrowed, paid early, borrowed again: the new amount is due 15 days after the next bill, not a month after it", () => {
    const rows = [move("2026-11-12", "draw", 200_000), move("2026-11-13", "draw", 200_000), move("2026-11-14", "repay", 400_000), move("2026-11-16", "draw", 100_000)];
    const d = due(rows, "2026-11-16");
    expect(d.nextDue).toBe("2026-12-21");
    expect(d.amountDue).toBe(100_000);
    expect(d.bill?.next).toBe("2026-12-06");
  });
  it("a bill left unpaid is due 15 days after it closed, and late after that", () => {
    const rows = [move("2026-10-30", "draw", 100_000)];
    expect(due(rows, "2026-11-10").nextDue).toBe("2026-11-21");
    expect(due(rows, "2026-11-10").amountDue).toBe(100_000);
    const late = due(rows, "2026-11-23");
    expect(late.nextDue).toBe("2026-11-21");
    expect(late.daysToDue).toBe(-2);
  });
  it("what borrowing on a day would be due on", () => {
    expect(dueIfBorrowedOn(line, "2026-11-16")).toBe("2026-12-21");
    expect(dueIfBorrowedOn(line, "2026-12-06")).toBe("2026-12-21");
    expect(dueIfBorrowedOn(line, "2026-12-07")).toBe("2027-01-21");
    // A day of the month still works as before.
    const byDay: Debt = { ...line, dueAfterDays: undefined, dueDay: 21 };
    expect(dueIfBorrowedOn(byDay, "2026-11-16")).toBe("2026-12-21");
  });
});

describe("set once, the same everywhere", () => {
  it("the choices: a day of the month, or days after the bill closes when it has a closing day", () => {
    expect(dueChoices(false)).toHaveLength(32);
    expect(dueChoices(true)).toContain("15 days after the bill closes");
    expect(dueOfChoice("15 days after the bill closes")).toEqual({ dueAfterDays: 15 });
    expect(dueOfChoice("21st")).toEqual({ dueDay: 21 });
    expect(dueOfChoice("Not set")).toEqual({});
    expect(dueChoiceOf(line)).toBe("15 days after the bill closes");
    expect(dueWords(line)).toBe("due 15 days after");
    expect(sameDayNote("Line D", 6, undefined, 15)).toBe("Line D: each bill closes on the 6th and is due 15 days later, on the 21st. What you borrow after a bill closes goes on the next one.");
  });
  it("said in the chat", () => {
    const bare: Debt = { ...line, dueAfterDays: undefined, dueDay: 6 };
    const ask = readDebtDetailAsk("Line D is due 15 days after the bill closes", [bare]);
    expect(ask).toEqual({ debtId: "line-d", detail: "dueAfter", value: 15 });
    const change = debtDetailChange(ask!, [bare], "2026-11-16");
    expect("next" in change && change.next.dueAfterDays).toBe(15);
    expect("next" in change && change.next.dueDay).toBeUndefined();
    expect(readDebtDetailAsk("Line D due date is 15 days after the cutoff", [bare])?.detail).toBe("dueAfter");
  });
});
