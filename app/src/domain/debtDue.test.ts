/**
 * When a debt payment is due, which effects a debt takes, and payments filed
 * as spending. The cases are the ones that went wrong on 2026-09-15: a date
 * printed twelve days after it passed, and a form that let money lent to a
 * friend be "drawn".
 */

import { describe, expect, it } from "vitest";

import {
  debtDue,
  debtNamedBy,
  debtPace,
  effectsFor,
  paymentsFiledAsSpending,
  positionOf,
  type Debt,
} from "./debt";
import type { DebtEffect, Transaction } from "./types";

const line: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  counterparty: "Maya",
  openedDate: "2026-07-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};

let count = 0;
function move(date: string, effect: DebtEffect, amount: number, debt: Debt = line): Transaction {
  count += 1;
  const into = effect === "draw" || effect === "collect";
  return {
    id: `d${count}`,
    recordNumber: count,
    date,
    type: "Debt",
    fromWallet: into ? "" : debt.wallet,
    toWallet: into ? debt.wallet : "",
    category: "",
    item: debt.name,
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "",
    debtId: debt.id,
    debtEffect: effect,
  };
}

const dueOf = (debt: Debt, rows: Transaction[], asOf: string) =>
  debtDue(positionOf(debt, rows, asOf), rows, asOf);

describe("when the next payment is due", () => {
  it("is a month after the balance began when nothing has been paid since", () => {
    // The Maya Credit history on the Debt screen: cleared on Aug 3, borrowed again from Aug 13.
    const rows = [
      move("2026-07-29", "draw", 250000),
      move("2026-08-03", "repay", 250000),
      move("2026-08-13", "draw", 105000),
      move("2026-08-14", "draw", 150000),
      move("2026-08-20", "draw", 40000),
    ];
    const due = dueOf(line, rows, "2026-09-15");
    expect(due.basis).toBe("borrowed");
    expect(due.since).toBe("2026-08-13");
    expect(due.nextDue).toBe("2026-09-13");
    expect(due.daysToDue).toBe(-2);
    expect(due.amountDue).toBe(295000);
  });

  it("is a month after the last payment on a balance that never cleared", () => {
    const rows = [move("2026-07-01", "draw", 500000), move("2026-08-03", "repay", 100000)];
    const due = dueOf(line, rows, "2026-08-29");
    expect(due.basis).toBe("last-payment");
    expect(due.nextDue).toBe("2026-09-03");
    expect(due.daysToDue).toBe(5);
  });

  it("follows a due day, and counts a payment made in the weeks before it", () => {
    const withDay: Debt = { ...line, dueDay: 3 };
    const onTime = [move("2026-07-01", "draw", 500000), move("2026-08-03", "repay", 100000)];
    expect(dueOf(withDay, onTime, "2026-08-29").nextDue).toBe("2026-09-03");

    const early = [move("2026-07-01", "draw", 500000), move("2026-08-30", "repay", 100000)];
    expect(dueOf(withDay, early, "2026-09-01").nextDue).toBe("2026-10-03");
  });

  it("puts a due day past the end of a short month on its last day", () => {
    const withDay: Debt = { ...line, dueDay: 31 };
    const drawn = [move("2027-01-02", "draw", 100000)];
    expect(dueOf(withDay, drawn, "2027-01-10").nextDue).toBe("2027-01-31");

    const paid = [...drawn, move("2027-01-31", "repay", 50000)];
    expect(dueOf(withDay, paid, "2027-02-01").nextDue).toBe("2027-02-28");
  });

  it("crosses into the next year", () => {
    const rows = [move("2026-11-01", "draw", 100000), move("2026-12-10", "repay", 10000)];
    expect(dueOf(line, rows, "2026-12-20").nextDue).toBe("2027-01-10");
  });

  it("has nothing due once it is paid off", () => {
    const rows = [move("2026-07-01", "draw", 100000), move("2026-07-20", "repay", 100000)];
    const due = dueOf(line, rows, "2026-08-29");
    expect(due.nextDue).toBeUndefined();
    expect(due.amountDue).toBe(0);
    expect(due.basis).toBe("none");
  });

  it("invents no schedule for money borrowed from a person", () => {
    const family: Debt = { ...line, id: "tita", name: "Tita", form: "informal" };
    const due = dueOf(family, [move("2026-07-01", "draw", 100000, family)], "2026-08-29");
    expect(due.nextDue).toBeUndefined();
  });

  it("dates money owed to you by its due day, and counts what they paid back", () => {
    const ben: Debt = { ...line, id: "ben", name: "Ben", kind: "receivable", form: "informal", wallet: "Cash", dueDay: 20 };
    const lent = [move("2026-08-01", "lend", 50000, ben)];
    expect(dueOf(ben, lent, "2026-08-29").nextDue).toBe("2026-08-20");
    expect(dueOf(ben, lent, "2026-08-29").daysToDue).toBe(-9);

    const part = [...lent, move("2026-08-25", "collect", 20000, ben)];
    const due = dueOf(ben, part, "2026-08-29");
    expect(due.nextDue).toBe("2026-09-20");
    expect(due.amountDue).toBe(30000);
  });

  it("asks a loan with a schedule for its next instalment, not the whole balance", () => {
    const loan: Debt = {
      ...line,
      id: "bank",
      name: "Bank loan",
      form: "term-loan",
      creditLimit: 1200000,
      termMonths: 12,
      openedDate: "2026-01-15",
    };
    const rows = [
      move("2026-01-15", "draw", 1200000, loan),
      move("2026-02-15", "repay", 100000, loan),
      move("2026-03-15", "repay", 100000, loan),
    ];
    const due = dueOf(loan, rows, "2026-04-01");
    expect(due.basis).toBe("schedule");
    expect(due.nextDue).toBe("2026-04-15");
    expect(due.amountDue).toBe(100000);
  });
});

describe("which way the money moves", () => {
  it("offers money you owe draws and repayments, and money owed to you lending and collecting", () => {
    expect(effectsFor("payable")).toEqual(["draw", "repay", "interest", "writeoff"]);
    expect(effectsFor("receivable")).toEqual(["lend", "collect", "writeoff"]);
  });
});

describe("payments filed as spending", () => {
  const joy: Debt = { ...line, id: "joy", name: "Joy", kind: "receivable" };

  it("recognises a debt by its item, and a short name only exactly", () => {
    expect(debtNamedBy([line, joy], "Maya Credit")?.id).toBe("maya-credit");
    expect(debtNamedBy([line, joy], "maya credit bill")?.id).toBe("maya-credit");
    expect(debtNamedBy([line, joy], "Maya")).toBeUndefined();
    expect(debtNamedBy([line, joy], "Joyride")).toBeUndefined();
    expect(debtNamedBy([line, joy], " joy ")?.id).toBe("joy");
  });

  it("finds the Maya Credit bill filed under Bills", () => {
    const bill: Transaction = {
      ...move("2026-09-01", "repay", 402136),
      id: "bill",
      type: "Spending",
      category: "Bills",
      debtId: undefined,
      debtEffect: undefined,
    };
    const found = paymentsFiledAsSpending([line], [bill, move("2026-09-02", "repay", 1000)]);
    expect(found.map((f) => f.row.id)).toEqual(["bill"]);
  });
});

describe("how fast it is moving", () => {
  it("compares the last month's borrowing with its payments", () => {
    const rows = [
      move("2026-08-03", "repay", 250000),
      move("2026-07-29", "draw", 250000),
      move("2026-08-13", "draw", 105000),
      move("2026-08-14", "draw", 150000),
      move("2026-08-20", "draw", 40000),
    ];
    const pace = debtPace(positionOf(line, rows, "2026-08-29"), rows, "2026-08-29");
    expect(pace.added30).toBe(295000);
    expect(pace.paid30).toBe(250000);
    expect(pace.monthlyPayment).toBe(83333);
    expect(pace.monthsToClear).toBe(4);
  });
});
