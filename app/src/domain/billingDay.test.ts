/**
 * A credit line's billing day: what is owed when the lender closes the bill
 * is the bill, and what is borrowed after it goes on the next one.
 *
 * The owner, 27 September 2026: "some banks have biling date like allow me to
 * add billing date in the settings. example: Maya credit my personal billing
 * date is 6 of the months. every bank is different". Figures are invented.
 */

import { describe, expect, it } from "vitest";

import { debtDue, positionOf, type Debt } from "./debt";
import type { Transaction } from "./types";

const line: Debt = {
  id: "line",
  name: "Pay Later",
  kind: "payable",
  form: "credit-line",
  counterparty: "Lender",
  counterpartyType: "institution",
  openedDate: "2026-01-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
  billingDay: 6,
};

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `r${n}`,
    recordNumber: n,
    date: "2026-09-18",
    type: "Debt",
    fromWallet: "",
    toWallet: "",
    category: "",
    item: "Pay Later",
    description: "",
    amount: 0,
    fee: 0,
    total: 0,
    notes: "",
    status: "",
    debtId: "line",
    ...over,
  };
};
const draw = (date: string, amount: number) => row({ date, toWallet: "Maya", amount, total: amount, debtEffect: "draw" });
const pay = (date: string, amount: number) => row({ date, fromWallet: "Maya", amount, total: amount, debtEffect: "repay" });
const dueOf = (debt: Debt, rows: Transaction[], asOf: string) => debtDue(positionOf(debt, rows, asOf), rows, asOf);

describe("a billing day and no due day", () => {
  it("puts borrowing after the last bill on the next one, due by its billing day", () => {
    const rows = [draw("2026-09-18", 200000), draw("2026-09-20", 200000)];
    const due = dueOf(line, rows, "2026-09-27");
    expect(due).toMatchObject({ basis: "billing", nextDue: "2026-10-06", amountDue: 400000 });
    expect(due.bill).toEqual({ last: "2026-09-06", billed: 0, next: "2026-10-06" });
  });

  it("counts what was owed on the billing day as the bill", () => {
    const rows = [draw("2026-08-29", 100000), draw("2026-09-18", 200000)];
    expect(dueOf(line, rows, "2026-09-27").bill).toEqual({ last: "2026-09-06", billed: 100000, next: "2026-10-06" });
  });
});

describe("a billing day and a due day", () => {
  const withDue: Debt = { ...line, dueDay: 20 };

  it("is due the bill, on the due day after it, and late once it passes", () => {
    const rows = [draw("2026-08-29", 100000), draw("2026-09-18", 200000)];
    const due = dueOf(withDue, rows, "2026-09-27");
    expect(due).toMatchObject({ basis: "billing", nextDue: "2026-09-20", amountDue: 100000, daysToDue: -7 });
  });

  it("is clear of the bill once it is paid, and due the next one", () => {
    const rows = [draw("2026-08-29", 100000), draw("2026-09-18", 200000), pay("2026-09-15", 100000)];
    const due = dueOf(withDue, rows, "2026-09-27");
    expect(due.bill?.billed).toBe(0);
    expect(due).toMatchObject({ nextDue: "2026-10-20", amountDue: 200000 });
  });
});

describe("no billing day", () => {
  it("works as before", () => {
    const { billingDay: _b, ...plain } = line;
    const due = dueOf(plain as Debt, [draw("2026-09-18", 200000)], "2026-09-27");
    expect(due.basis).toBe("borrowed");
    expect(due.bill).toBeUndefined();
  });
});
