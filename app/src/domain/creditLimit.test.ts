/**
 * A credit line's limit, set by its lender and raised over time.
 *
 * The owner, 27 September 2026: a ₱4,000.00 limit on their credit line that
 * the lender raises as it is used, and no limit at all on a personal loan or
 * a business one. Figures here are invented, in the shape of that line: two
 * ₱2,000.00 borrowings, each with ₱151.03 of fees added.
 */

import { describe, expect, it } from "vitest";

import { financeAlerts } from "./alerts";
import {
  creditRoom,
  limitOn,
  limitSteps,
  roomWords,
  takesLimit,
  usedAfterEach,
  usedAfterOne,
  usedOn,
  withLimit,
  withoutStep,
} from "./creditLimit";
import type { Debt } from "./debt";
import { checkDraft, emptyDraft, type Draft } from "./entry";
import { REFERENCE } from "./eval/corpus";
import type { Transaction } from "./types";

const line: Debt = {
  id: "easy-credit",
  name: "Easy Credit",
  kind: "payable",
  form: "credit-line",
  counterparty: "Easy Bank",
  counterpartyType: "institution",
  openedDate: "2026-07-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};

let n = 0;
const row = (date: string, effect: Transaction["debtEffect"], amount: number): Transaction => {
  n += 1;
  return {
    id: `r${n}`,
    recordNumber: n,
    date,
    type: "Debt",
    fromWallet: effect === "repay" ? "Maya" : "",
    toWallet: effect === "draw" ? "Maya" : "",
    category: "",
    item: "Easy Credit",
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Paid",
    debtId: "easy-credit",
    debtEffect: effect,
  };
};

const ledger: Transaction[] = [
  row("2026-09-18", "draw", 200000),
  row("2026-09-18", "charge", 15103),
  row("2026-09-20", "draw", 200000),
  row("2026-09-20", "charge", 15103),
];

describe("which lines take a limit", () => {
  it("is a credit line you owe a lender, and nothing else", () => {
    expect(takesLimit(line)).toBe(true);
    expect(takesLimit({ ...line, form: "informal", counterpartyType: "person" })).toBe(false);
    expect(takesLimit({ ...line, form: "pass-through" })).toBe(false);
    expect(takesLimit({ ...line, form: "term-loan" })).toBe(false);
    expect(takesLimit({ ...line, counterpartyType: "person" })).toBe(false);
    expect(takesLimit({ ...line, kind: "receivable" })).toBe(false);
  });

  it("gives a loan's amount no limit, since it is the principal", () => {
    expect(limitSteps({ ...line, form: "term-loan", creditLimit: 5000000 })).toEqual([]);
  });
});

describe("a limit that grows over time", () => {
  const raised = withLimit(withLimit(line, 300000, "2026-07-01"), 400000, "2026-09-01");

  it("keeps each step, and the latest as the limit", () => {
    expect(limitSteps(raised)).toEqual([
      { from: "2026-07-01", amount: 300000 },
      { from: "2026-09-01", amount: 400000 },
    ]);
    expect(raised.creditLimit).toBe(400000);
  });

  it("judges a day by the limit it had", () => {
    expect(limitOn(raised, "2026-08-15")).toBe(300000);
    expect(limitOn(raised, "2026-09-01")).toBe(400000);
    // Before the first step the first known limit stands.
    expect(limitOn(raised, "2026-06-01")).toBe(300000);
  });

  it("keeps an old single figure as the first step when the limit is raised", () => {
    const old: Debt = { ...line, creditLimit: 300000 };
    expect(limitSteps(withLimit(old, 500000, "2026-10-01"))).toEqual([
      { from: "2026-07-01", amount: 300000 },
      { from: "2026-10-01", amount: 500000 },
    ]);
  });

  it("takes a step back out, or the limit off altogether", () => {
    expect(limitSteps(withoutStep(raised, "2026-09-01"))).toEqual([{ from: "2026-07-01", amount: 300000 }]);
    const none = withLimit(raised, null, "2026-09-27");
    expect(none.creditLimit).toBeUndefined();
    expect(none.limits).toBeUndefined();
  });
});

describe("what counts against the limit", () => {
  const limited = withLimit(line, 400000, "2026-07-01");

  it("counts everything owed by default, fees too (rule D3)", () => {
    expect(usedOn(limited, ledger, "2026-09-27")).toBe(430206);
    expect(creditRoom(limited, ledger, "2026-09-27")).toMatchObject({ state: "over", over: 30206, available: 0 });
  });

  it("counts only what was borrowed when the lender does", () => {
    const borrowed = { ...limited, limitCounts: "borrowed" as const };
    expect(usedOn(borrowed, ledger, "2026-09-27")).toBe(400000);
    const room = creditRoom(borrowed, ledger, "2026-09-27")!;
    expect(room).toMatchObject({ state: "reached", available: 0, over: 0 });
    expect(roomWords(room)).toBe("Limit reached: all ₱4,000.00 used");
  });

  it("clears the fees first when a payment comes in, as lenders apply it", () => {
    const borrowed = { ...limited, limitCounts: "borrowed" as const };
    const paid = [...ledger, row("2026-09-25", "repay", 100000)];
    // ₱302.06 of the payment clears the fees, the other ₱697.94 comes off what was borrowed.
    expect(usedOn(borrowed, paid, "2026-09-27")).toBe(400000 - (100000 - 30206));
    expect(usedOn(limited, paid, "2026-09-27")).toBe(430206 - 100000);
  });

  it("follows what is used after every row, for the history", () => {
    const each = usedAfterEach({ ...limited, limitCounts: "borrowed" }, ledger);
    expect([...each.values()]).toEqual([200000, 200000, 400000, 400000]);
  });

  it("says close before it is reached", () => {
    const room = creditRoom(withLimit(line, 500000, "2026-07-01"), ledger, "2026-09-27")!;
    expect(room.state).toBe("near");
    expect(roomWords(room)).toBe("₱697.94 of ₱5,000.00 left to borrow");
  });

  it("works out a movement not saved yet", () => {
    const borrowed = { ...limited, limitCounts: "borrowed" as const };
    expect(usedAfterOne(borrowed, ledger, { date: "2026-09-27", effect: "repay", amount: 200000 })).toBe(400000 - (200000 - 30206));
    expect(usedAfterOne(borrowed, ledger.slice(0, 2), { date: "2026-09-19", effect: "draw", amount: 100000, charges: 7000 })).toBe(300000);
  });
});

describe("the rest of the app knows", () => {
  const limited: Debt = { ...withLimit(line, 400000, "2026-07-01"), limitCounts: "borrowed" };

  it("warns on a borrowing past the limit of its day, and says what was left", () => {
    const draft: Draft = { ...emptyDraft("2026-09-19"), flow: "Debt", debtId: "easy-credit", debtEffect: "draw", toWallet: "Maya", amount: 250000 };
    const check = checkDraft(draft, ledger.slice(0, 2), REFERENCE, [limited], "2026-09-27");
    const said = check.warnings.map((w) => w.message).join(" ");
    expect(said).toContain("over the ₱4,000.00 limit on Easy Credit");
    expect(said).toContain("₱2,000.00 left");
  });

  it("raises an alert naming the limit and the payment due", () => {
    const alerts = financeAlerts({
      transactions: ledger,
      accounts: [],
      budgets: {},
      debts: [{ ...limited, dueDay: 2 }],
      bills: [],
      lowBalanceThreshold: 0,
      asOf: "2026-09-27",
    });
    const limit = alerts.find((a) => a.id === "limit-easy-credit");
    expect(limit?.title).toBe("Easy Credit has reached its limit and a payment is due");
    expect(limit?.detail).toContain("is due");
  });
});
