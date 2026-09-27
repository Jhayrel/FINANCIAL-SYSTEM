/**
 * The lender's fees, already owed, never counted again as interest.
 *
 * The owner, 27 September 2026: a credit line owed its two borrowings plus
 * the fees the lender added to each, saved as charges. They paid the whole
 * balance and typed the borrowed part as the amount and the fees as
 * "Interest included". The fees were counted twice, less came off the
 * balance than was paid, and the Debt screen said money was still owed on a
 * line they had just cleared: "why I still have 600+ its confusing". The
 * figures here are invented, in the same shape.
 */

import { describe, expect, it } from "vitest";

import { asAmountAndFees, feesAsInterest, feesCountedTwice, outstandingOf, owedParts, paymentCovers, unpaidCharges, withFeesPaid, type Debt } from "./debt";
import { debtCardIntro } from "./debtSentence";
import { checkDraft, draftToTransactions, emptyDraft, type Draft } from "./entry";
import { REFERENCE } from "./eval/corpus";
import { totalsFor } from "./totals";
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

// Two borrowings of ₱1,500.00, each with ₱120.50 of fees added: ₱3,241.00 owed, ₱241.00 of it fees.
const owed: Transaction[] = [
  row({ date: "2026-09-18", toWallet: "Maya", amount: 150000, total: 150000, debtEffect: "draw" }),
  row({ date: "2026-09-18", amount: 12050, total: 12050, debtEffect: "charge" }),
  row({ date: "2026-09-20", toWallet: "Maya", amount: 150000, total: 150000, debtEffect: "draw" }),
  row({ date: "2026-09-20", amount: 12050, total: 12050, debtEffect: "charge" }),
];

const payment = (over: Partial<Draft>): Draft => ({
  ...emptyDraft("2026-09-27"),
  flow: "Debt",
  debtId: "line",
  debtEffect: "repay",
  fromWallet: "Maya",
  item: "Pay Later",
  ...over,
});

describe("the fees inside what is owed", () => {
  it("counts the fees added since the balance was last cleared", () => {
    expect(outstandingOf(owed, "line")).toBe(324100);
    expect(unpaidCharges(owed, "line")).toBe(24100);
  });

  it("takes a payment out of the fees first", () => {
    const part = [...owed, row({ date: "2026-09-22", fromWallet: "Maya", amount: 10000, total: 10000, debtEffect: "repay" })];
    expect(unpaidCharges(part, "line")).toBe(14100);
  });

  it("has none once the line is cleared", () => {
    const cleared = [...owed, row({ date: "2026-09-25", fromWallet: "Maya", amount: 324100, total: 324100, debtEffect: "repay" })];
    expect(unpaidCharges(cleared, "line")).toBe(0);
  });
});

describe("fees typed again as interest", () => {
  it("are recognised, and the payment put right", () => {
    // The borrowed part as the amount, the fees as interest: together they are what was owed.
    expect(feesAsInterest(300000, 324100, 24100, 24100)).toEqual({ amount: 324100, exact: true });
    // The whole balance as the amount, the fees as interest as well.
    expect(feesAsInterest(324100, 324100, 24100, 24100)).toEqual({ amount: 324100, exact: true });
    // A smaller overlap is only a warning: a bill can carry new interest too.
    expect(feesAsInterest(100000, 324100, 5000, 24100)).toEqual({ amount: 100000, exact: false });
  });

  it("leave real interest alone, where no fees were added", () => {
    expect(feesAsInterest(300000, 300000, 18879, 0)).toBeNull();
    expect(feesAsInterest(300000, 324100, 30000, 24100)).toBeNull();
  });

  it("typed the owner's way, what was borrowed plus the interest and fees, are one payment that clears the line", () => {
    const typed = payment({ amount: 300000, interest: 24100 });
    const check = checkDraft(typed, owed, REFERENCE, [line], "2026-09-27");
    expect(check.ok).toBe(true);
    expect(check.feesPaid).toEqual({ fees: 24100, total: 324100 });
    expect(check.repaymentSplit).toEqual({ principal: 324100, interest: 0 });
    const saved = withFeesPaid(typed, owed);
    expect(saved).toMatchObject({ amount: 324100, interest: null });
    const rows = [...owed, ...draftToTransactions(saved, 99, "p", check.repaymentSplit)];
    expect(outstandingOf(rows, "line")).toBe(0);
    // The interest and fees stay counted once, as the charges they already were.
    expect(totalsFor(rows).interest).toBe(24100);
  });

  it("with the whole balance as the amount, the interest was inside it", () => {
    expect(withFeesPaid(payment({ amount: 324100, interest: 24100 }), owed)).toMatchObject({ amount: 324100, interest: null });
  });

  it("leave interest billed on top alone, where none was added to what is owed", () => {
    const plain = [row({ date: "2026-07-29", toWallet: "Maya", amount: 250000, total: 250000, debtEffect: "draw" })];
    const typed = payment({ amount: 268879, interest: 18879 });
    expect(withFeesPaid(typed, plain)).toBe(typed);
  });

  it("are filled in that way when a payment of the whole balance is offered", () => {
    expect(asAmountAndFees(payment({ amount: 324100 }), owed)).toMatchObject({ amount: 300000, interest: 24100 });
    expect(asAmountAndFees(payment({ amount: null }), owed)).toMatchObject({ amount: 300000, interest: 24100 });
    // A part payment is left as typed.
    expect(asAmountAndFees(payment({ amount: 100000 }), owed)).toMatchObject({ amount: 100000 });
  });
});

describe("a payment already saved that way", () => {
  // What the owner's entry saved: ₱2,759.00 off the balance, ₱241.00 as interest, then ₱482.00 to clear what it said was left.
  const saved: Transaction[] = [
    ...owed,
    row({ id: "pay", recordNumber: 50, date: "2026-09-27", fromWallet: "Maya", amount: 275900, total: 275900, debtEffect: "repay" }),
    row({ id: "pay-interest", recordNumber: 50, date: "2026-09-27", fromWallet: "Maya", amount: 24100, total: 24100, debtEffect: "interest", partOf: "pay" }),
    row({ id: "topup", recordNumber: 51, date: "2026-09-27", fromWallet: "Maya", amount: 48200, total: 48200, debtEffect: "repay" }),
  ];

  it("is found, with the payment that paid a balance never owed", () => {
    const [found] = feesCountedTwice(saved, "line");
    expect(found?.payment.id).toBe("pay");
    expect(found?.interest.amount).toBe(24100);
    expect(found?.paid).toBe(300000);
    expect(found?.leftShown).toBe(48200);
    expect(found?.followUp?.id).toBe("topup");
  });

  it("is not found where the interest was new", () => {
    const real: Transaction[] = [
      row({ date: "2026-07-29", toWallet: "Maya", amount: 250000, total: 250000, debtEffect: "draw" }),
      row({ id: "aug", recordNumber: 60, date: "2026-08-03", fromWallet: "Maya", amount: 250000, total: 250000, debtEffect: "repay" }),
      row({ id: "aug-interest", recordNumber: 60, date: "2026-08-03", fromWallet: "Maya", amount: 18879, total: 18879, debtEffect: "interest", partOf: "aug" }),
    ];
    expect(feesCountedTwice(real, "line")).toEqual([]);
  });
});

describe("what is owed, said in its parts", () => {
  it("splits what is owed into what was borrowed and the interest and fees", () => {
    expect(owedParts(owed, "line")).toEqual({ owed: 324100, fees: 24100, borrowed: 300000 });
  });

  it("says what a payment covers, the interest and fees first", () => {
    const parts = owedParts(owed, "line");
    expect(paymentCovers(324100, parts)).toEqual({ fees: 24100, borrowed: 300000, left: 0 });
    // Typed as what was borrowed: the interest and fees come out first, and that much is still owed.
    expect(paymentCovers(300000, parts)).toEqual({ fees: 24100, borrowed: 275900, left: 24100 });
  });

  it("is said in the chat instead of asked for", () => {
    const intro = debtCardIntro(payment({ amount: 324100 }), true, [line], null, owedParts(owed, "line"));
    expect(intro).toContain("**Pay Later** is owed **₱3,241.00**: **₱3,000.00** you borrowed and **₱241.00** of interest and fees Lender already added.");
    expect(intro).toContain("clears both");
    expect(intro).not.toContain("Put how much");
    const typedBorrowed = debtCardIntro(payment({ amount: 300000 }), true, [line], null, owedParts(owed, "line"));
    expect(typedBorrowed).toContain("it is one payment of **₱3,241.00**");
    const filled = debtCardIntro(payment({ amount: 300000, interest: 24100 }), true, [line], null, owedParts(owed, "line"));
    expect(filled).toContain("one payment of **₱3,241.00**");
    expect(filled).toContain("It clears Pay Later.");
  });
});
