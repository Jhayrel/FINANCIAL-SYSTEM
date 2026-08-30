/**
 * Debt forms.
 *
 * A credit line, a term loan and money lent to a friend are three different
 * arrangements. These tests pin what makes each one different, and check that
 * the direction (who owes whom) stays independent of the form.
 */

import { describe, expect, it } from "vitest";

import { positionOf } from "./debt";
import {
  creditLineState,
  debtExplanation,
  debtLabel,
  defaultsFor,
  headline,
  loanSchedule,
} from "./debtForms";
import { formatMoney } from "./money";
import type { Debt } from "./debt";
import type { Transaction } from "./types";

const TODAY = "2026-08-30";

const base: Debt = {
  id: "d1",
  name: "Test",
  kind: "payable",
  counterparty: "Maya",
  openedDate: "2026-01-15",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};

const move = (
  effect: Transaction["debtEffect"],
  amount: number,
  n: number,
  date = "2026-02-15",
): Transaction => ({
  id: `t${n}`,
  recordNumber: n,
  date,
  type: "Debt",
  fromWallet: effect === "draw" || effect === "collect" ? "" : "Maya",
  toWallet: effect === "draw" || effect === "collect" ? "Maya" : "",
  category: "",
  item: "Test",
  description: "",
  amount,
  fee: 0,
  total: amount,
  notes: "",
  status: "Done",
  debtId: "d1",
  debtEffect: effect,
});

describe("direction and form are independent", () => {
  it("names all six combinations distinctly", () => {
    const names = new Set([
      debtLabel("payable", "credit-line"),
      debtLabel("payable", "term-loan"),
      debtLabel("payable", "informal"),
      debtLabel("receivable", "credit-line"),
      debtLabel("receivable", "term-loan"),
      debtLabel("receivable", "informal"),
    ]);
    expect(names.size).toBe(6);
  });

  it("explains lending separately from borrowing", () => {
    expect(debtExplanation("payable", "informal")).toContain("you owe back");
    expect(debtExplanation("receivable", "informal")).toContain("still yours");
  });

  it("says a draw is borrowing rather than income", () => {
    expect(debtExplanation("payable", "credit-line")).toContain("not income");
  });

  it("says a loan out is an asset rather than spending", () => {
    expect(debtExplanation("receivable", "term-loan")).toContain("not spending");
  });
});

describe("defaults follow the form", () => {
  it("assumes an institution charges interest", () => {
    expect(defaultsFor("credit-line")).toEqual({
      interestType: "monthly_pct",
      counterpartyType: "institution",
    });
    expect(defaultsFor("term-loan").counterpartyType).toBe("institution");
  });

  it("assumes a person does not", () => {
    expect(defaultsFor("informal")).toEqual({
      interestType: "none",
      counterpartyType: "person",
    });
  });
});

describe("credit line", () => {
  const debt: Debt = { ...base, form: "credit-line", creditLimit: 10_000_00 };
  const ledger = [move("draw", 2_500_00, 1), move("draw", 1_000_00, 2)];
  const state = creditLineState(positionOf(debt, ledger, TODAY));

  it("reports what is left to draw, not just what is owed", () => {
    expect(state?.used).toBe(3_500_00);
    expect(state?.available).toBe(6_500_00);
    expect(state?.limit).toBe(10_000_00);
  });

  it("reports utilisation as a fraction of the limit", () => {
    expect(state?.utilisation).toBeCloseTo(0.35, 5);
    expect(state?.maxedOut).toBe(false);
  });

  it("frees the limit again as it is repaid, because it revolves", () => {
    const after = [...ledger, move("repay", 1_500_00, 3)];
    const s = creditLineState(positionOf(debt, after, TODAY));
    expect(s?.used).toBe(2_000_00);
    expect(s?.available).toBe(8_000_00);
  });

  it("knows when there is nothing left", () => {
    const maxed = [move("draw", 10_000_00, 1)];
    expect(creditLineState(positionOf(debt, maxed, TODAY))?.maxedOut).toBe(true);
  });

  it("has nothing to say without a limit", () => {
    const noLimit: Debt = { ...base, form: "credit-line" };
    expect(creditLineState(positionOf(noLimit, ledger, TODAY))).toBeNull();
  });

  it("summarises as used, limit and headroom", () => {
    const text = headline(positionOf(debt, ledger, TODAY), TODAY, formatMoney);
    expect(text).toContain("3,500.00");
    expect(text).toContain("10,000.00");
    expect(text).toContain("6,500.00");
  });
});

describe("term loan", () => {
  // PHP 12,000.00 over 12 months: PHP 1,000.00 a month.
  const debt: Debt = {
    ...base,
    form: "term-loan",
    creditLimit: 12_000_00,
    termMonths: 12,
    openedDate: "2026-01-15",
  };
  const drawn = [move("draw", 12_000_00, 1, "2026-01-15")];

  it("works out the monthly payment from principal and term", () => {
    const s = loanSchedule(positionOf(debt, drawn, TODAY), TODAY);
    expect(s?.monthlyPayment).toBe(1_000_00);
    expect(s?.termMonths).toBe(12);
  });

  it("counts instalments from the ledger, not from a stored counter", () => {
    const paid = [
      ...drawn,
      move("repay", 1_000_00, 2, "2026-02-15"),
      move("repay", 1_000_00, 3, "2026-03-15"),
      move("repay", 1_000_00, 4, "2026-04-15"),
    ];
    const s = loanSchedule(positionOf(debt, paid, TODAY), TODAY);
    expect(s?.paid).toBe(3);
    expect(s?.remaining).toBe(9);
  });

  it("dates the next payment a month after the last one due", () => {
    const paid = [...drawn, move("repay", 1_000_00, 2, "2026-02-15")];
    const s = loanSchedule(positionOf(debt, paid, TODAY), TODAY);
    expect(s?.nextDue).toBe("2026-03-15");
  });

  it("reports a late payment as negative days", () => {
    const paid = [...drawn, move("repay", 1_000_00, 2, "2026-02-15")];
    const s = loanSchedule(positionOf(debt, paid, TODAY), TODAY);
    // Due 15 March, today is 30 August.
    expect(s?.daysToNext).toBeLessThan(0);
  });

  it("is finished once the balance reaches zero, however many rows it took", () => {
    const cleared = [...drawn, move("repay", 12_000_00, 2, "2026-03-15")];
    const s = loanSchedule(positionOf(debt, cleared, TODAY), TODAY);
    expect(s?.finished).toBe(true);
    expect(s?.remaining).toBe(0);
    expect(s?.nextDue).toBeUndefined();
  });

  it("summarises as a monthly amount and how many are left", () => {
    const paid = [...drawn, move("repay", 1_000_00, 2, "2026-02-15")];
    const text = headline(positionOf(debt, paid, TODAY), TODAY, formatMoney);
    expect(text).toContain("1,000.00");
    expect(text).toContain("11 of 12");
  });

  it("has nothing to schedule without a term", () => {
    const noTerm: Debt = { ...base, form: "term-loan", creditLimit: 12_000_00 };
    expect(loanSchedule(positionOf(noTerm, drawn, TODAY), TODAY)).toBeNull();
  });
});

describe("money lent to a person", () => {
  const debt: Debt = {
    ...base,
    kind: "receivable",
    form: "informal",
    counterparty: "A classmate",
  };
  const ledger = [move("lend", 500_00, 1)];

  it("tracks what is still owed to you", () => {
    expect(positionOf(debt, ledger, TODAY).outstanding).toBe(500_00);
  });

  it("clears when they pay you back", () => {
    const after = [...ledger, move("collect", 500_00, 2)];
    const position = positionOf(debt, after, TODAY);
    expect(position.outstanding).toBe(0);
    expect(position.status).toBe("settled");
  });

  it("says only what is outstanding, because there is no schedule to report", () => {
    const text = headline(positionOf(debt, ledger, TODAY), TODAY, formatMoney);
    expect(text).toBe("₱500.00 outstanding");
  });

  it("survives a write-off without pretending it was collected", () => {
    const after = [...ledger, move("writeoff", 500_00, 2)];
    const position = positionOf(debt, after, TODAY);
    expect(position.status).toBe("written_off");
    expect(position.writtenOff).toBe(500_00);
  });
});

describe("an old row with no form", () => {
  it("is treated as a credit line, which is what they all were", () => {
    const legacy: Debt = { ...base, creditLimit: 5_000_00 };
    const text = headline(positionOf(legacy, [move("draw", 1_000_00, 1)], TODAY), TODAY, formatMoney);
    expect(text).toContain("left to draw");
  });
});
