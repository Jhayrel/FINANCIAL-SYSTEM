/**
 * A credit line's month, as a lender's statement reads it, for any lender
 * (owner, 17 November 2026: "Everything credit or loan in the span of ...
 * November it will be paid in billing date ... i credit 1000 today then paid
 * then credited again then paid agin ... not just in maya").
 *
 * A statement covers the days after one closing up to and including the
 * next. Everything borrowed in it, the fees added the day it was borrowed,
 * and everything paid in it add up to one total due, payable when the
 * lender's terms say. Paid in full before it closes, the bill is zero.
 *
 * Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { creditRoom } from "./creditLimit";
import { debtDue, positionOf, type Debt } from "./debt";
import type { DebtEffect, Transaction } from "./types";

const base: Debt = {
  id: "card-a", name: "Card A", kind: "payable", counterparty: "Lender A", openedDate: "2026-06-01", wallet: "Wallet A",
  interestType: "none", interestRate: 0, notes: "", archived: false, form: "credit-line", billingDay: 6, dueAfterDays: 15,
  creditLimit: 1_200_000, limitCounts: "borrowed",
};
let n = 0;
const move = (debt: Debt, date: string, effect: DebtEffect, amount: number): Transaction =>
  ({
    id: `r${(n += 1)}`, recordNumber: n, date, type: "Debt", fromWallet: effect === "repay" ? debt.wallet : "", toWallet: effect === "draw" ? debt.wallet : "",
    category: "", item: debt.name, description: "", amount, fee: 0, total: amount, notes: "", status: "Done", debtId: debt.id, debtEffect: effect,
  }) as Transaction;
/** A day as the app sees it: only what was saved by then. */
const on = (debt: Debt, rows: readonly Transaction[], asOf: string) => {
  const seen = rows.filter((t) => t.date <= asOf);
  return debtDue(positionOf(debt, seen, asOf), seen, asOf);
};

describe("a statement month: borrow, pay, borrow again, pay again", () => {
  const card = base;
  const rows = [
    // Covered by the bill that closes 6 November: borrowed with a fee, paid in full before it closed.
    move(card, "2026-10-29", "draw", 150_000),
    move(card, "2026-10-29", "charge", 11_235),
    move(card, "2026-11-02", "repay", 161_235),
    // The bill that closes 6 December: two borrowings and a payment that clears them, then one more.
    move(card, "2026-11-10", "draw", 250_000),
    move(card, "2026-11-10", "charge", 18_725),
    move(card, "2026-11-11", "draw", 250_000),
    move(card, "2026-11-11", "charge", 18_725),
    move(card, "2026-11-12", "repay", 537_450),
    move(card, "2026-11-15", "draw", 150_000),
    move(card, "2026-11-15", "charge", 11_235),
  ];

  it("owed before the first bill closes: the whole amount, fees in, due 15 days after it closes", () => {
    const d = on(card, rows, "2026-10-30");
    expect(d.amountDue).toBe(161_235);
    expect(d.nextDue).toBe("2026-11-21");
    expect(d.bill?.next).toBe("2026-11-06");
  });

  it("paid in full before it closed: the bill is zero and nothing is due", () => {
    const d = on(card, rows, "2026-11-07");
    expect(d.basis).toBe("none");
    expect(d.amountDue).toBe(0);
    expect(d.nextDue).toBeUndefined();
  });

  it("borrowed again after it closed: on the next bill, due 15 days after that one closes, never a month later", () => {
    for (const day of ["2026-11-10", "2026-11-11", "2026-11-15", "2026-12-01"]) {
      const d = on(card, rows, day);
      expect(d.nextDue, day).toBe("2026-12-21");
      expect(d.bill?.last, day).toBe("2026-11-06");
      expect(d.bill?.billed, day).toBe(0);
      expect(d.bill?.next, day).toBe("2026-12-06");
    }
    // Everything owed, fees in: the two cleared borrowings are gone.
    expect(on(card, rows, "2026-11-11").amountDue).toBe(537_450);
    expect(on(card, rows, "2026-11-12").basis).toBe("none");
    expect(on(card, rows, "2026-11-15").amountDue).toBe(161_235);
  });

  it("the lender counts only what was borrowed against the limit: the fees do not use it up", () => {
    const seen = rows.filter((t) => t.date <= "2026-11-15");
    const room = creditRoom(card, seen, "2026-11-15");
    expect(room?.used).toBe(150_000);
    expect(room?.available).toBe(1_050_000);
    const owedCounts = creditRoom({ ...card, limitCounts: "owed" }, seen, "2026-11-15");
    expect(owedCounts?.used).toBe(161_235);
  });

  it("once the bill closes, it holds what was owed that day, due 15 days later and late after", () => {
    const closed = on(card, rows, "2026-12-06");
    expect(closed.bill?.last).toBe("2026-12-06");
    expect(closed.bill?.billed).toBe(161_235);
    expect(closed.nextDue).toBe("2026-12-21");
    expect(on(card, rows, "2026-12-21").daysToDue).toBe(0);
    const late = on(card, rows, "2026-12-23");
    expect(late.nextDue).toBe("2026-12-21");
    expect(late.daysToDue).toBe(-2);
    expect(late.amountDue).toBe(161_235);
  });

  it("a part payment after the bill closes lowers that bill; a new borrowing waits for the next one", () => {
    const more = [...rows, move(card, "2026-12-09", "repay", 60_000), move(card, "2026-12-12", "draw", 100_000)];
    const d = on(card, more, "2026-12-12");
    expect(d.nextDue).toBe("2026-12-21");
    expect(d.amountDue).toBe(101_235);
    // The rest of the bill paid: what is left is the new borrowing, on the bill that closes 6 January.
    const paid = [...more, move(card, "2026-12-15", "repay", 101_235)];
    const after = on(card, paid, "2026-12-15");
    expect(after.nextDue).toBe("2027-01-21");
    expect(after.amountDue).toBe(100_000);
    expect(after.bill?.next).toBe("2027-01-06");
  });
});

describe("every lender's terms, the same cycle", () => {
  const borrow = (debt: Debt) => [move(debt, "2026-11-10", "draw", 300_000)];

  it("due the day the bill closes: no due date set, or the due day on the closing day", () => {
    for (const debt of [
      { ...base, id: "pay-later-b", name: "Pay Later B", billingDay: 20, dueAfterDays: undefined },
      { ...base, id: "pay-later-c", name: "Pay Later C", billingDay: 20, dueAfterDays: undefined, dueDay: 20 },
    ] as Debt[]) {
      const rows = borrow(debt);
      expect(on(debt, rows, "2026-11-12").nextDue, debt.name).toBe("2026-11-20");
      // On the day it closes the bill is due that day, not a month on.
      const closing = on(debt, rows, "2026-11-20");
      expect(closing.nextDue, debt.name).toBe("2026-11-20");
      expect(closing.daysToDue, debt.name).toBe(0);
      expect(closing.amountDue, debt.name).toBe(300_000);
      expect(on(debt, rows, "2026-11-21").daysToDue, debt.name).toBe(-1);
    }
  });

  it("a due day of the month: the first one after the bill closes", () => {
    const debt: Debt = { ...base, id: "bank-d", name: "Bank D", billingDay: 20, dueAfterDays: undefined, dueDay: 5 };
    const rows = [...borrow(debt), move(debt, "2026-11-25", "draw", 50_000)];
    const d = on(debt, rows, "2026-11-26");
    expect(d.nextDue).toBe("2026-12-05");
    expect(d.amountDue).toBe(300_000);
    const paid = [...rows, move(debt, "2026-12-03", "repay", 300_000)];
    const next = on(debt, paid, "2026-12-03");
    expect(next.nextDue).toBe("2027-01-05");
    expect(next.amountDue).toBe(50_000);
  });

  it("a long time to pay: an unpaid bill stays first, even after the next one closes", () => {
    const debt: Debt = { ...base, id: "bank-e", name: "Bank E", billingDay: 6, dueAfterDays: 45 };
    const rows = [move(debt, "2026-11-02", "draw", 50_000), move(debt, "2026-11-20", "draw", 30_000)];
    // The 6 November bill (500.00) is due 21 December; the 300.00 is on the 6 December bill, due 20 January.
    const d = on(debt, rows, "2026-12-10");
    expect(d.nextDue).toBe("2026-12-21");
    expect(d.amountDue).toBe(50_000);
    const paid = on(debt, [...rows, move(debt, "2026-12-15", "repay", 50_000)], "2026-12-15");
    expect(paid.nextDue).toBe("2027-01-20");
    expect(paid.amountDue).toBe(30_000);
  });
});
