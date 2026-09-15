/**
 * The forecast, against the four weaknesses it was rebuilt to fix.
 *
 * Spending that falls should be forecast falling, an estimate should say how
 * much it varies, one unusual month last year should not decide next month,
 * and a debt should land in the month it is due.
 */

import { describe, expect, it } from "vitest";

import { confidenceOf, forecastYear, trendOf } from "./forecast";
import type { Debt } from "./debt";
import type { Transaction } from "./types";

let n = 0;
const spend = (date: string, amount: number): Transaction => {
  n += 1;
  return {
    id: `f${n}`,
    recordNumber: n,
    date,
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Paid",
  };
};

/** One spending row a month, from January, at the amounts given. */
const months = (amounts: readonly number[], year = 2026): Transaction[] =>
  amounts.map((amount, i) => spend(`${year}-${String(i + 1).padStart(2, "0")}-10`, amount));

describe("the trend, measured rather than assumed", () => {
  it("reads a falling ledger as falling and a rising one as rising", () => {
    expect(trendOf([1000000, 900000, 800000, 700000])).toBeLessThan(0);
    expect(trendOf([700000, 800000, 900000, 1000000])).toBeGreaterThan(0);
  });

  it("is flat when there is too little history to read one", () => {
    expect(trendOf([])).toBe(0);
    expect(trendOf([500000])).toBe(0);
    expect(trendOf([500000, 900000])).toBe(0);
  });

  it("never moves an estimate by more than 15%, whatever the ledger did", () => {
    expect(trendOf([10000, 100000, 1000000, 10000000])).toBe(0.15);
    expect(trendOf([10000000, 1000000, 100000, 10000])).toBe(-0.15);
  });
});

describe("how much an estimate varies", () => {
  it("calls a steady window steady and a jumpy one wide", () => {
    expect(confidenceOf([580000, 610000, 590000])).toBe("tight");
    expect(confidenceOf([200000, 1100000, 450000])).toBe("wide");
  });

  it("calls anything under three months wide, whatever it holds", () => {
    expect(confidenceOf([600000, 600000])).toBe("wide");
  });
});

describe("a year of forecast", () => {
  it("forecasts spending that is falling as falling, not rising", () => {
    const ledger = months([1000000, 900000, 810000, 730000, 660000, 600000]);
    const [, , , , , , july] = forecastYear(ledger, 2026, 6, [], "2026-06-30");
    expect(july?.isActual).toBe(false);
    expect(july?.growth).toBeLessThan(0);
    // Under the most recent month, which the flat 3% could never produce.
    expect(july?.spending).toBeLessThan(600000);
    expect(july?.basis).toBe("recent-average");
  });

  it("gives a range around the estimate, wider when the months disagree", () => {
    const steady = forecastYear(months([580000, 610000, 590000]), 2026, 3, [], "2026-03-31")[3];
    const jumpy = forecastYear(months([200000, 1100000, 450000]), 2026, 3, [], "2026-03-31")[3];
    expect(steady?.confidence).toBe("tight");
    expect(jumpy?.confidence).toBe("wide");
    expect((steady?.high ?? 0) - (steady?.low ?? 0)).toBeLessThan((jumpy?.high ?? 0) - (jumpy?.low ?? 0));
    expect(steady?.low).toBeLessThanOrEqual(steady?.spending ?? 0);
    expect(steady?.high).toBeGreaterThanOrEqual(steady?.spending ?? 0);
  });

  it("blends one unusual month last year with the recent average instead of copying it", () => {
    const ledger = [...months([3000000], 2025), ...months([500000, 520000, 480000])];
    const january = forecastYear(ledger, 2026, 0, [], "2026-01-01")[0];
    // Nothing has happened this year yet, so last January is all there is.
    expect(january?.basis).toBe("same-month-last-year");

    const withHistory = [...months([3000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 2025).filter((t) => t.amount > 0), ...months([500000, 520000, 480000])];
    const april = forecastYear(withHistory, 2026, 3, [], "2026-03-31")[3];
    expect(april?.basis).toBe("recent-average");
    expect(april?.spending).toBeLessThan(1000000);
  });

  it("says plainly when there is not enough history", () => {
    const first = forecastYear([], 2026, 0, [], "2026-01-01")[5];
    expect(first?.basis).toBe("none");
    expect(first?.spending).toBe(0);
    expect(first?.confidence).toBe("wide");
  });

  it("charges a debt to the month its payment is due, not to next month", () => {
    const debt: Debt = {
      id: "d1",
      name: "Maya Credit",
      kind: "payable",
      counterparty: "Maya",
      openedDate: "2026-01-05",
      dueDay: 5,
      wallet: "Maya",
      interestType: "none",
      interestRate: 0,
      notes: "",
      archived: false,
    };
    const borrow: Transaction = {
      ...spend("2026-06-05", 0),
      type: "Debt",
      category: "",
      item: "",
      fromWallet: "",
      toWallet: "Maya",
      debtId: "d1",
      debtEffect: "draw",
      amount: 500000,
      total: 500000,
    };
    const ledger = [...months([400000, 420000, 380000, 410000, 390000, 400000]), borrow];

    const year = forecastYear(ledger, 2026, 6, [debt], "2026-06-30");
    const charged = year.filter((m) => m.debtService > 0).map((m) => m.month);
    expect(charged).toEqual([7]);
    expect(year[6]?.debtService).toBe(500000);
    // And the months after it are not charged for the same debt again.
    expect(year[7]?.debtService).toBe(0);
  });
});
