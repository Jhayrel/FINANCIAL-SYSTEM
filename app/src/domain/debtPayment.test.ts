/**
 * One debt payment with interest inside it, from the sentence to the ledger
 * and back.
 *
 * The owner's case, in their words: "if I get credit example 1000 then theres
 * 120 pesos that I need to add as interest ... how can I pay the interest?
 * also in database how it will know that the 120 is connected to the 1000 I
 * just paid ... I paid 1000 including its interest". And no percentage may be
 * assumed, because every lender counts interest differently.
 *
 * Pinned here:
 *   1. The interest can be stated, so a payment no larger than the balance
 *      can still carry interest (rule D2 only ever found the excess).
 *   2. The two rows it saves are linked in the data (`partOf`), not only by
 *      an id convention, and they are put back together wherever they show.
 *   3. Rule 5.6.2 holds: only the principal lowers what is owed, and the
 *      wallet goes down by all of it.
 *   4. A sentence gives up the figure when it has one, and says so when it
 *      does not, without inventing a rate.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import {
  debtDue,
  interestOf,
  movementsOf,
  outstandingOf,
  paymentOf,
  positionOf,
  splitRepayment,
  type Debt,
} from "./debt";
import { debtCardIntro, readDebtSentence } from "./debtSentence";
import { checkDraft, draftToTransactions, emptyDraft, runningBalance, type Draft } from "./entry";
import { entryImpact } from "./entryImpact";
import { readMoney } from "./proposal";
import { readEntry } from "./readEntry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
  credits: ["Maya Credit"],
};

const credit: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  counterparty: "Maya",
  form: "credit-line",
  openedOn: "2026-01-01",
  archived: false,
} as unknown as Debt;

const base = (over: Partial<Transaction>): Transaction => ({
  id: "x",
  recordNumber: 1,
  date: "2026-09-01",
  type: "Revenue",
  fromWallet: "",
  toWallet: "Maya",
  category: "Revenue",
  item: "Allowance",
  description: "",
  amount: 0,
  fee: 0,
  total: 0,
  notes: "",
  status: "Received",
  ...over,
});

/** ₱5,000.00 in Maya, and ₱1,000.00 borrowed on Maya Credit. */
const ledger: Transaction[] = [
  base({ id: "in", amount: 500000, total: 500000 }),
  base({
    id: "draw",
    recordNumber: 2,
    date: "2026-09-02",
    type: "Debt",
    category: "",
    item: "",
    amount: 100000,
    total: 100000,
    status: "",
    debtId: "maya-credit",
    debtEffect: "draw",
  }),
];

const payment = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft("2026-09-10"),
  flow: "Debt",
  debtId: "maya-credit",
  debtEffect: "repay",
  fromWallet: "Maya",
  item: "Maya Credit",
  amount: 100000,
  ...over,
});

const save = (draft: Draft, id = "pay"): Transaction[] => {
  const check = checkDraft(draft, ledger, reference, [credit], "2026-09-10");
  expect(check.ok).toBe(true);
  return draftToTransactions(draft, 3, id, check.repaymentSplit);
};

describe("interest the owner states", () => {
  it("splits a payment no larger than the balance, which the excess rule never could", () => {
    expect(splitRepayment(100000, 100000)).toEqual({ principal: 100000, interest: 0 });
    expect(splitRepayment(100000, 100000, 12000)).toEqual({ principal: 88000, interest: 12000 });
  });

  it("still makes anything above the balance interest, stated or not", () => {
    // ₱1,500.00 paid, ₱120.00 said to be interest, ₱1,000.00 owed: ₱500.00 is interest.
    expect(splitRepayment(150000, 100000, 12000)).toEqual({ principal: 100000, interest: 50000 });
  });

  it("keeps the old behaviour when nothing is stated", () => {
    expect(splitRepayment(268879, 250000)).toEqual({ principal: 250000, interest: 18879 });
    expect(splitRepayment(268879, 250000, null)).toEqual({ principal: 250000, interest: 18879 });
  });

  it("refuses interest larger than the payment it is part of", () => {
    const check = checkDraft(payment({ interest: 150000 }), ledger, reference, [credit], "2026-09-10");
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => e.field)).toContain("interest");
  });

  it("says nothing extra when the stated interest accounts for the split", () => {
    const check = checkDraft(payment({ interest: 12000 }), ledger, reference, [credit], "2026-09-10");
    expect(check.repaymentSplit).toEqual({ principal: 88000, interest: 12000 });
    expect(check.warnings.filter((w) => w.field === "amount")).toEqual([]);
  });
});

describe("the two rows are linked in the database", () => {
  it("saves the principal and an interest row that names its payment", () => {
    const rows = save(payment({ interest: 12000 }));
    expect(rows).toHaveLength(2);
    const [principal, interest] = rows;
    expect(principal).toMatchObject({ id: "pay", debtEffect: "repay", amount: 88000, total: 88000 });
    expect(interest).toMatchObject({ id: "pay-interest", debtEffect: "interest", amount: 12000, partOf: "pay" });
    expect(principal?.partOf).toBeUndefined();
  });

  it("saves one interest row, and no ₱0.00 repayment, when all of it was interest", () => {
    const rows = save(payment({ amount: 12000, interest: 12000 }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "pay", debtEffect: "interest", amount: 12000 });
  });

  it("finds each half from the other, by the link and by the old id", () => {
    const rows = save(payment({ interest: 12000 }));
    const all = [...ledger, ...rows];
    const [principal, interest] = rows as [Transaction, Transaction];
    expect(interestOf(principal, all)?.id).toBe("pay-interest");
    expect(paymentOf(interest, all)?.id).toBe("pay");

    // A pair saved before `partOf` existed, found by its id alone.
    const old = { ...interest, id: "legacy-interest", partOf: undefined };
    const oldPayment = { ...principal, id: "legacy" };
    expect(paymentOf(old, [oldPayment, old])?.id).toBe("legacy");
  });

  it("does not take an interest row that belongs to another payment", () => {
    const rows = save(payment({ interest: 12000 }));
    const other = { ...(rows[0] as Transaction), id: "another" };
    expect(interestOf(other, [...rows, other])).toBeUndefined();
  });
});

describe("rule 5.6.2 and the wallet", () => {
  it("lowers what is owed by the principal only, and the wallet by all of it", () => {
    const all = [...ledger, ...save(payment({ interest: 12000 }))];
    expect(outstandingOf(all, "maya-credit")).toBe(12000);
    expect(walletBalance(all, "Maya")).toBe(500000 + 100000 - 100000);
    expect(positionOf(credit, all, "2026-09-10").interestPaid).toBe(12000);
  });

  it("reports the last payment whole, with the interest in it", () => {
    const all = [...ledger, ...save(payment({ interest: 12000 }))];
    const due = debtDue(positionOf(credit, all, "2026-09-10"), all, "2026-09-10");
    expect(due.lastPayment).toEqual({ date: "2026-09-10", amount: 100000, interest: 12000 });
  });
});

describe("shown as one movement", () => {
  it("folds each payment's interest into it, and leaves everything else alone", () => {
    const all = [...ledger, ...save(payment({ interest: 12000 }))];
    const moves = movementsOf(all);
    expect(moves).toHaveLength(3);
    const paid = moves.find((m) => m.row.id === "pay");
    expect(paid?.part?.id).toBe("pay-interest");
    expect(paid?.total).toBe(100000);
    expect(moves.find((m) => m.row.id === "draw")?.part).toBeUndefined();
  });

  it("keeps an interest row on its own when its payment is not in view", () => {
    const rows = save(payment({ interest: 12000 }));
    const moves = movementsOf([rows[1] as Transaction]);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.total).toBe(12000);
  });
});

describe("what a sentence says about it", () => {
  const read = (text: string) => readDebtSentence(text, (t) => figure(t), readMoney);
  /** The first figure, as the general reader finds it. */
  const figure = (t: string) => {
    const m = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{1,2}|\d{2,})/.exec(t);
    return m?.[1] ? readMoney(m[1]) : null;
  };

  it("reads interest inside the payment", () => {
    expect(read("I paid my maya credit 1000 including 120 interest")).toMatchObject({
      effect: "repay",
      amount: 100000,
      interest: 12000,
    });
    expect(read("paid 1000 to maya credit, 120 of it was interest")).toMatchObject({ amount: 100000, interest: 12000 });
    expect(read("interest is 120, I paid 1000 on maya credit")).toMatchObject({ amount: 100000, interest: 12000 });
    expect(read("paid maya credit 1000 with 120 interest")).toMatchObject({ amount: 100000, interest: 12000 });
  });

  it("adds interest said to be on top", () => {
    expect(read("paid maya credit 1000 plus 120 interest")).toMatchObject({ amount: 112000, interest: 12000 });
    expect(read("paid 880 principal and 120 interest on maya credit")).toMatchObject({
      amount: 100000,
      interest: 12000,
    });
  });

  it("says interest was mentioned without a figure, and invents none", () => {
    const said = read("I paid 1000 including its interest");
    expect(said).toMatchObject({ effect: "repay", amount: 100000, interest: null, interestUnstated: true });
  });

  it("reads a payment that was only interest as interest", () => {
    expect(read("paid 120 interest on maya credit")).toMatchObject({ effect: "interest", amount: 12000, interest: null });
    expect(read("paid the interest only, 120, maya credit")).toMatchObject({ effect: "interest", amount: 12000 });
  });

  it("never reads paying with credit as paying it off", () => {
    expect(read("paid 500 for food using maya credit").effect).toBeUndefined();
    expect(read("I paid with my maya credit 500").effect).toBeUndefined();
  });

  it("reads borrowing, and leaves a sentence with both for the owner", () => {
    expect(read("borrowed 2000 from maya credit").effect).toBe("draw");
    expect(read("nangutang 500 sa maya credit").effect).toBe("draw");
    expect(read("borrowed 2000 and paid 500 on maya credit").effect).toBeUndefined();
  });

  it("reads no effect from a sentence that names none", () => {
    expect(read("maya credit 1000").effect).toBeUndefined();
  });
});

describe("the chat, end to end", () => {
  it("fills the card from the sentence, the wallet on the side a payment takes it from", () => {
    const read = readEntry("I paid my maya credit 1000 from maya including 120 interest", ledger, reference, "2026-09-10");
    expect(read.readsAsDebt).toBe(true);
    expect(read.draft).toMatchObject({
      flow: "Debt",
      debtId: "maya-credit",
      debtEffect: "repay",
      fromWallet: "Maya",
      toWallet: "",
      amount: 100000,
      interest: 12000,
    });
    const check = checkDraft(read.draft, ledger, reference, [credit], "2026-09-10");
    expect(check.ok).toBe(true);
    expect(check.repaymentSplit).toEqual({ principal: 88000, interest: 12000 });
  });

  it("asks for the interest when the sentence only says there was some", () => {
    const read = readEntry("I paid 1000 on maya credit including its interest", ledger, reference, "2026-09-10");
    expect(read.interestUnstated).toBe(true);
    expect(read.draft.interest).toBeUndefined();
    const intro = debtCardIntro(read.draft, true, [credit]);
    expect(intro).toContain("Interest included");
    expect(intro).toContain("No rate is assumed");
  });

  it("names what it read instead of asking for it again", () => {
    const read = readEntry("I paid my maya credit 1000 including 120 interest", ledger, reference, "2026-09-10");
    const intro = debtCardIntro(read.draft, false, [credit]);
    expect(intro).toContain("a payment on **Maya Credit**");
    expect(intro).not.toContain("Pick");
    expect(intro).toContain("₱120.00");
  });

  it("still asks for both when the sentence gave neither", () => {
    const intro = debtCardIntro({ ...emptyDraft("2026-09-10"), flow: "Debt", amount: 50000 }, false, [credit]);
    expect(intro).toContain("Pick which debt and what it does");
  });

  it("never writes an em dash", () => {
    const intro = debtCardIntro(payment({ interest: 12000 }), true, [credit]);
    expect(intro.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

describe("the previews beside the form, while a payment is corrected", () => {
  const saved = [...ledger, ...save(payment({ interest: 12000 }))];
  const reopened = payment({ id: "pay", interest: 12000 });

  /** Maya read ₱120.00 low on both sides of the arrow: the interest row was counted as well as the draft. */
  it("leaves the whole payment out of the wallet's balance before it", () => {
    const balance = runningBalance(reopened, saved, "pay");
    expect(balance?.before).toBe(600000);
    expect(balance?.after).toBe(500000);
  });

  /** Built without the split, the payment cost nothing and its interest never reached the budget. */
  it("counts the interest against the month's spending", () => {
    const impact = entryImpact(payment({ interest: 12000 }), ledger, {}, "2026-09-10");
    expect(impact?.cost).toBe(12000);
  });

  it("counts nothing when none of the payment was interest", () => {
    expect(entryImpact(payment(), ledger, {}, "2026-09-10")).toBeNull();
  });
});
