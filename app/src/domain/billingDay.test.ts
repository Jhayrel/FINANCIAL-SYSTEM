/**
 * A credit line's billing day: what is owed when the lender closes the bill
 * is the bill, and what is borrowed after it goes on the next one.
 *
 * The owner, 27 September 2026: "some banks have biling date like allow me to
 * add billing date in the settings. example: Maya credit my personal billing
 * date is 6 of the months. every bank is different". Figures are invented.
 */

import { describe, expect, it } from "vitest";

import { financeAlerts } from "./alerts";
import { billClosingFor, billWords, debtDue, positionOf, type Debt } from "./debt";
import { BILL_DAY_CHOICES, choiceOfDay, dayOfChoice, ordinalDay } from "./debtWords";
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

describe("the bill a movement goes on", () => {
  it("is the first closing on or after its day", () => {
    expect(billClosingFor("2026-09-18", 6)).toBe("2026-10-06");
    expect(billClosingFor("2026-09-06", 6)).toBe("2026-09-06");
    expect(billClosingFor("2026-09-05", 6)).toBe("2026-09-06");
    // A closing day past the end of a short month is its last day.
    expect(billClosingFor("2026-02-10", 31)).toBe("2026-02-28");
    expect(billClosingFor("2026-12-20", 6)).toBe("2027-01-06");
  });

  it("is said with the payment it is due for", () => {
    const withDue: Debt = { ...line, dueDay: 20 };
    const rows = [draw("2026-08-29", 100000), draw("2026-09-18", 200000)];
    expect(billWords(dueOf(withDue, rows, "2026-09-27"))).toBe(", for the bill that closed September 6, 2026");
    expect(billWords(dueOf(withDue, [draw("2026-09-18", 200000)], "2026-09-27"))).toBe(", for the bill that closes October 6, 2026");
  });
});

describe("the bill closing soon", () => {
  const alertsOn = (debt: Debt, rows: Transaction[], asOf: string) =>
    financeAlerts({ transactions: rows, accounts: [], budgets: {}, debts: [debt], bills: [], lowBalanceThreshold: 0, asOf });

  it("is a nudge when a separate payment day follows it", () => {
    const withDue: Debt = { ...line, dueDay: 20 };
    const found = alertsOn(withDue, [draw("2026-09-18", 200000)], "2026-10-04").find((a) => a.id.startsWith("bill-line"));
    expect(found?.title).toBe("Pay Later's bill closes in 2 days");
    expect(found?.detail).toContain("₱2,000.00 borrowed since the last bill goes on the bill of October 6, 2026");
  });

  it("is not raised without a payment day, where closing is the due date and already said", () => {
    expect(alertsOn(line, [draw("2026-09-18", 200000)], "2026-10-04").some((a) => a.id.startsWith("bill-line"))).toBe(false);
  });
});

describe("the two days, as they are picked", () => {
  it("read the way a bill says them", () => {
    expect([1, 2, 3, 4, 6, 11, 12, 13, 21, 22, 23, 31].map(ordinalDay)).toEqual([
      "1st", "2nd", "3rd", "4th", "6th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st",
    ]);
    expect(BILL_DAY_CHOICES).toHaveLength(32);
  });

  it("go back to the day they name, or to none", () => {
    expect(dayOfChoice("6th")).toBe(6);
    expect(dayOfChoice("Not set")).toBeUndefined();
    expect(choiceOfDay(21)).toBe("21st");
    expect(choiceOfDay(undefined)).toBe("Not set");
  });
});
