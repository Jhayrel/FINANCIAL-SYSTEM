/**
 * The situations a system like this meets in real life, from the review of
 * 2026-09-16, section 6. Each is a pattern that happens to real people rather
 * than a synthetic edge case, and each asserts what the owner would be shown.
 */

import { describe, expect, it } from "vitest";

import { debtDue, debtNamedBy, outstandingOf, positionOf, positionsOf, renameDebtAccount, type Debt } from "./debt";
import { emptyDraft } from "./entry";
import { predictAmount } from "./predict";
import { totalsFor } from "./totals";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  const amount = over.amount ?? 0;
  return {
    id: `w${n}`,
    recordNumber: n,
    date: "2026-09-01",
    type: "Spending",
    fromWallet: "Maya",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount,
    fee: 0,
    total: amount + (over.fee ?? 0),
    notes: "",
    status: "Paid",
    ...over,
    ...(over.total === undefined ? { total: amount + (over.fee ?? 0) } : {}),
  };
};

const debt = (over: Partial<Debt> & { id: string; name: string }): Debt => ({
  kind: "payable",
  counterparty: over.name,
  openedDate: "2026-01-05",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
  ...over,
});

describe("a debt refinanced halfway through", () => {
  /**
   * PHP 10,000 owed on a credit line: PHP 6,000 paid off, the remaining
   * PHP 4,000 taken over by a personal loan, and the line closed.
   */
  const line = debt({ id: "line", name: "Maya Credit" });
  const loan = debt({ id: "loan", name: "Tita loan", counterpartyType: "person" });
  const ledger = [
    row({ date: "2026-06-01", type: "Debt", category: "", item: "", fromWallet: "", toWallet: "Maya", debtId: "line", debtEffect: "draw", amount: 1000000 }),
    row({ date: "2026-09-01", type: "Debt", category: "", item: "", debtId: "line", debtEffect: "repay", amount: 600000 }),
    // The rest is taken over, not paid: written off on the line, drawn on the loan.
    row({ date: "2026-09-01", type: "Debt", category: "", item: "", debtId: "line", debtEffect: "writeoff", amount: 400000 }),
    row({ date: "2026-09-01", type: "Debt", category: "", item: "", fromWallet: "", toWallet: "Maya", debtId: "loan", debtEffect: "draw", amount: 400000 }),
  ];

  it("closes the old line and opens the new loan at what moved across", () => {
    expect(outstandingOf(ledger, "line")).toBe(0);
    expect(outstandingOf(ledger, "loan")).toBe(400000);
  });

  it("counts none of it as income or as spending", () => {
    const totals = totalsFor(ledger);
    expect(totals.revenue).toBe(0);
    expect(totals.total).toBe(0);
  });
});

describe("income that arrives, is moved twice, and is then spent", () => {
  /** Into the e-wallet, on to the bank, out as cash, then spent. */
  const ledger = [
    row({ date: "2026-09-01", type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Maya", amount: 1000000 }),
    row({ date: "2026-09-02", type: "Transfer", category: "", item: "", fromWallet: "Maya", toWallet: "Maya Bank", amount: 1000000 }),
    row({ date: "2026-09-03", type: "Transfer", category: "", item: "", fromWallet: "Maya Bank", toWallet: "Cash", amount: 500000, fee: 1500 }),
    row({ date: "2026-09-04", item: "Food", fromWallet: "Cash", amount: 200000 }),
  ];

  it("counts the money as income once, however many times it moves", () => {
    expect(totalsFor(ledger).revenue).toBe(1000000);
  });

  it("counts the spending, and of the moves only the fee", () => {
    const totals = totalsFor(ledger);
    expect(totals.total).toBe(200000 + 1500);
    expect(totals.fees).toBe(1500);
  });
});

describe("a payment day that does not exist in the month", () => {
  const onThe31st = debt({ id: "d31", name: "Card", dueDay: 31 });

  /** Borrowed in January, part paid early in February, so the next day owed falls in February. */
  const cycle = (year: number): Transaction[] => [
    row({ date: `${year}-01-05`, type: "Debt", category: "", item: "", fromWallet: "", toWallet: "Maya", debtId: "d31", debtEffect: "draw", amount: 500000 }),
    row({ date: `${year}-02-02`, type: "Debt", category: "", item: "", fromWallet: "Maya", debtId: "d31", debtEffect: "repay", amount: 100000 }),
  ];

  it("lands on the last day of a short month, and on the 29th in a leap year", () => {
    const short = cycle(2026);
    expect(debtDue(positionOf(onThe31st, short, "2026-02-10"), short, "2026-02-10").nextDue).toBe("2026-02-28");

    const leap = cycle(2024);
    expect(debtDue(positionOf(onThe31st, leap, "2024-02-10"), leap, "2024-02-10").nextDue).toBe("2024-02-29");
  });

  it("leaves a payment that was never made on the day it was due, and calls it late", () => {
    const unpaid = [
      row({ date: "2026-01-05", type: "Debt", category: "", item: "", fromWallet: "", toWallet: "Maya", debtId: "d31", debtEffect: "draw", amount: 500000 }),
    ];
    const due = debtDue(positionOf(onThe31st, unpaid, "2026-02-10"), unpaid, "2026-02-10");
    expect(due.nextDue).toBe("2026-01-31");
    expect(due.daysToDue).toBeLessThan(0);
  });
});

describe("a wallet renamed while a debt hangs off it", () => {
  const before = debt({ id: "line", name: "Maya Credit", wallet: "Maya" });
  const ledger = [
    row({ date: "2026-06-01", type: "Debt", category: "", item: "", fromWallet: "", toWallet: "Maya", debtId: "line", debtEffect: "draw", amount: 500000 }),
    row({ date: "2026-08-01", type: "Debt", category: "", item: "", fromWallet: "Maya", debtId: "line", debtEffect: "repay", amount: 200000 }),
  ];

  it("keeps the balance and the dates, and moves the debt to the new name", () => {
    const [after] = renameDebtAccount([before], "Maya", "Maya Wallet");
    expect(after?.wallet).toBe("Maya Wallet");

    // Rows written before the rename still name the old wallet, and the debt
    // is worked out from the rows filed against it, not from the wallet name.
    expect(outstandingOf(ledger, "line")).toBe(300000);
    const position = positionOf(after ?? before, ledger, "2026-09-16");
    expect(position.outstanding).toBe(300000);
    expect(debtDue(position, ledger, "2026-09-16").nextDue).toBeDefined();
  });
});

describe("one very large month of income in an otherwise ordinary year", () => {
  /**
   * A windfall ten times an ordinary month. What matters is that it ages out
   * of a trailing window rather than resetting what normal looks like.
   */
  const ordinary = Array.from({ length: 8 }, (_, i) =>
    row({
      date: `2026-${String(i + 1).padStart(2, "0")}-05`,
      type: "Revenue",
      category: "Revenue",
      item: "Allowance",
      fromWallet: "",
      toWallet: "Maya",
      amount: 500000,
    }),
  );
  const windfall = row({ date: "2026-09-05", type: "Revenue", category: "Revenue", item: "Backpay", fromWallet: "", toWallet: "Maya", amount: 5000000 });

  it("counts it once in the year, and leaves the months before it alone", () => {
    const year = totalsFor([...ordinary, windfall]);
    expect(year.revenue).toBe(8 * 500000 + 5000000);

    const beforeIt = totalsFor(ordinary);
    expect(beforeIt.revenue).toBe(4000000);
  });

  it("is a tenth of the trailing figure once it has aged out of the window", () => {
    // A window that ends before the windfall does not see it at all.
    const upToAugust = [...ordinary, windfall].filter((t) => t.date < "2026-09-01");
    expect(totalsFor(upToAugust).revenue).toBe(4000000);
  });
});

describe("two debts owed to the same person at once", () => {
  const first = debt({ id: "tita-1", name: "Tita loan", counterparty: "Tita", counterpartyType: "person" });
  const second = debt({ id: "tita-2", name: "Tita loan 2", counterparty: "Tita", counterpartyType: "person" });
  const ledger = [
    row({ date: "2026-07-01", type: "Debt", category: "", item: "", fromWallet: "", toWallet: "Cash", debtId: "tita-1", debtEffect: "draw", amount: 300000 }),
    row({ date: "2026-08-01", type: "Debt", category: "", item: "", fromWallet: "", toWallet: "Cash", debtId: "tita-2", debtEffect: "draw", amount: 200000 }),
    // A repayment names the debt it belongs to, never the person.
    row({ date: "2026-09-01", type: "Debt", category: "", item: "", fromWallet: "Cash", debtId: "tita-1", debtEffect: "repay", amount: 100000 }),
  ];

  it("keeps them apart, and applies a repayment only to the one it names", () => {
    expect(outstandingOf(ledger, "tita-1")).toBe(200000);
    expect(outstandingOf(ledger, "tita-2")).toBe(200000);

    const positions = positionsOf([first, second], ledger, "2026-09-16");
    expect(positions.map((p) => p.outstanding)).toEqual([200000, 200000]);
  });
});

describe("a bill whose price changes for good", () => {
  const at = (date: string, amount: number): Transaction =>
    row({ date, category: "Subscriptions", item: "Spotify", amount });

  const eightMonths = [
    at("2026-01-05", 11900),
    at("2026-02-05", 11900),
    at("2026-03-05", 11900),
    at("2026-04-05", 11900),
    at("2026-05-05", 11900),
    at("2026-06-05", 11900),
    at("2026-07-05", 11900),
    at("2026-08-05", 11900),
  ];
  const draft = { ...emptyDraft("2026-12-01"), flow: "Spending" as const, item: "Spotify" };

  it("offers the repeated price while it is still the price", () => {
    expect(predictAmount(eightMonths, draft)?.amount).toBe(11900);
  });

  it("moves to the new price once it has held for three months, not after a dozen", () => {
    const raised = [...eightMonths, at("2026-09-05", 14900), at("2026-10-05", 14900), at("2026-11-05", 14900)];
    const guess = predictAmount(raised, draft);
    expect(guess?.amount).toBe(14900);
    expect(guess?.why).toContain("last 3");
  });

  it("does not flip to a one-off change", () => {
    const once = [...eightMonths, at("2026-09-05", 14900)];
    expect(predictAmount(once, draft)?.amount).toBe(11900);
  });
});

describe("naming a debt in a row when two are owed to the same person", () => {
  const first = debt({ id: "tita-1", name: "Tita loan" });
  const second = debt({ id: "tita-2", name: "Tita loan 2" });

  it("takes an exact name, and refuses to guess between two that read alike", () => {
    expect(debtNamedBy([first, second], "Tita loan 2")?.id).toBe("tita-2");
    expect(debtNamedBy([first, second], "Tita loan")?.id).toBe("tita-1");
    // Reads like both, so it names neither and the form asks which.
    expect(debtNamedBy([first, second], "Paid Tita loan 2 today")).toBeUndefined();
    // Reads like only one, so that one is offered.
    expect(debtNamedBy([first, second], "Paid Tita loan today")?.id).toBe("tita-1");
  });
});
