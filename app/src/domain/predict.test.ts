/**
 * These run against the real 440 row ledger where they can, because a
 * prediction that works on invented data and not on the owner's own history
 * is not a prediction.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import type { Draft } from "./entry";
import { billsToLog, predictAmount, reasons } from "./predict";
import type { Transaction } from "./types";

const fixture = loadFixture();

const row = (over: Partial<Transaction>): Transaction => ({
  id: "t",
  recordNumber: 1,
  date: "2026-01-01",
  type: "Spending",
  category: "Bills",
  item: "Globe",
  description: "",
  amount: 59900,
  fee: 0,
  total: 59900,
  fromWallet: "Maya",
  toWallet: "",
  status: "Paid",
  ...over,
});

const draft = (over: Partial<Draft> = {}): Draft => ({
  flow: "Spending",
  date: "2026-08-30",
  fromWallet: "",
  toWallet: "",
  category: "",
  item: "",
  description: "",
  amount: null,
  fee: 0,
  notes: "",
  status: "",
  ...over,
});

describe("billsToLog", () => {
  it("finds a bill due today, one month after the last payment", () => {
    const due = billsToLog([row({ date: "2026-07-30", id: "a" })], "2026-08-30");

    expect(due).toHaveLength(1);
    expect(due[0]?.item).toBe("Globe");
    expect(due[0]?.daysAway).toBe(0);
    expect(due[0]?.why).toContain("Due today");
  });

  it("carries the amount and wallet forward, which is the useful part", () => {
    const due = billsToLog(
      [
        row({ date: "2026-05-30", id: "a" }),
        row({ date: "2026-06-30", id: "b" }),
        row({ date: "2026-07-30", id: "c" }),
      ],
      "2026-08-30",
    );

    expect(due[0]?.expected).toBe(59900);
    expect(due[0]?.wallet).toBe("Maya");
  });

  it("says how late a bill is, rather than just that it is due", () => {
    const due = billsToLog([row({ date: "2026-06-27", id: "a" })], "2026-07-30");
    expect(due[0]?.why).toContain("late");
    expect(due[0]?.daysAway).toBeLessThan(0);
  });

  it("does not nag about a bill already paid this month", () => {
    const due = billsToLog(
      [
        row({ date: "2026-07-30", id: "a" }),
        // Paid early, so nothing is outstanding.
        row({ date: "2026-08-28", id: "b" }),
      ],
      "2026-08-30",
    );

    expect(due).toHaveLength(0);
  });

  it("stays quiet when the wallet has varied, rather than guessing", () => {
    const due = billsToLog(
      [
        row({ date: "2026-05-30", id: "a", fromWallet: "Maya" }),
        row({ date: "2026-06-30", id: "b", fromWallet: "Cash" }),
        row({ date: "2026-07-30", id: "c", fromWallet: "Gcash" }),
      ],
      "2026-08-30",
    );

    expect(due[0]?.wallet).toBe("");
  });

  it("ignores anything that is not a bill or a subscription", () => {
    const due = billsToLog(
      [row({ date: "2026-07-30", category: "Food", item: "Lunch" })],
      "2026-08-30",
    );

    expect(due).toHaveLength(0);
  });

  it("runs over the real ledger without inventing anything", () => {
    const due = billsToLog(fixture.transactions, fixture.expected.asOf);

    for (const d of due) {
      expect(d.item.trim().length).toBeGreaterThan(0);
      expect(d.expected).toBeGreaterThan(0);
      expect(Number.isInteger(d.expected)).toBe(true);
      expect(["Bills", "Subscriptions"]).toContain(d.category);
    }
  });
});

describe("predictAmount", () => {
  it("offers the figure that keeps repeating", () => {
    const history = [
      row({ date: "2026-05-30", id: "a" }),
      row({ date: "2026-06-30", id: "b" }),
      row({ date: "2026-07-30", id: "c", total: 79900, amount: 79900 }),
    ];

    const guess = predictAmount(history, draft({ item: "Globe" }));

    expect(guess?.amount).toBe(59900);
    expect(guess?.why).toContain("2 of the last 3");
  });

  it("never averages, because the mean is a figure never charged", () => {
    const history = [
      row({ date: "2026-06-30", id: "a", total: 59900, amount: 59900 }),
      row({ date: "2026-07-30", id: "b", total: 79900, amount: 79900 }),
    ];

    const guess = predictAmount(history, draft({ item: "Globe" }));

    // 69900 would be the average, and has never been paid.
    expect(guess?.amount).not.toBe(69900);
    expect([59900, 79900]).toContain(guess?.amount);
  });

  it("says the amount varies when nothing repeats", () => {
    const history = [
      row({ date: "2026-06-30", id: "a", total: 10000, amount: 10000 }),
      row({ date: "2026-07-30", id: "b", total: 20000, amount: 20000 }),
    ];

    expect(predictAmount(history, draft({ item: "Globe" }))?.why).toContain("varies");
  });

  it("stays quiet on a single past entry, which is a fact not a pattern", () => {
    expect(predictAmount([row({ id: "a" })], draft({ item: "Globe" }))).toBeNull();
  });

  it("stays quiet with nothing to go on", () => {
    expect(predictAmount([], draft({ item: "Globe" }))).toBeNull();
    expect(predictAmount(fixture.transactions, draft({ item: "" }))).toBeNull();
  });

  it("keeps to the same flow: revenue is not evidence about spending", () => {
    const history = [
      row({ date: "2026-06-30", id: "a", type: "Revenue" }),
      row({ date: "2026-07-30", id: "b", type: "Revenue" }),
    ];

    expect(predictAmount(history, draft({ flow: "Spending", item: "Globe" }))).toBeNull();
  });

  it("returns whole centavos, never a fraction", () => {
    const guess = predictAmount(
      fixture.transactions,
      draft({ flow: "Spending", item: fixture.transactions[20]?.item ?? "" }),
    );

    if (guess) expect(Number.isInteger(guess.amount)).toBe(true);
  });
});

describe("reasons", () => {
  it("counts how often the item has been entered", () => {
    const history = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    const why = reasons(draft({ item: "Globe" }), history);

    expect(why.find((r) => r.field === "item")?.why).toBe("Entered 3 times before");
  });

  it("gets the singular right", () => {
    const why = reasons(draft({ item: "Globe" }), [row({ id: "a" })]);
    expect(why.find((r) => r.field === "item")?.why).toBe("Entered 1 time before");
  });

  it("explains the wallet only when the item is known", () => {
    const history = [row({ id: "a" }), row({ id: "b" })];

    expect(reasons(draft({ fromWallet: "Maya" }), history).find((r) => r.field === "fromWallet"))
      .toBeUndefined();
    expect(
      reasons(draft({ item: "Globe", fromWallet: "Maya" }), history).find(
        (r) => r.field === "fromWallet",
      )?.why,
    ).toBe("Paid from here 2 times");
  });

  it("says nothing when there is no history at all", () => {
    expect(reasons(draft({ item: "Globe" }), [])).toEqual([]);
  });
});
