/**
 * Lenders charge in different ways, and the ledger has to follow each one.
 *
 * The owner showed a credit line's transaction list where every draw came
 * with a service fee and documentary stamp tax added to the balance, and the
 * payment cleared the draws and the fees together. Another lender takes its
 * interest inside the payment. A friend charges nothing. No formula is
 * assumed for any of them: the fees are recorded as the lender shows them.
 *
 * Figures here are invented, in the same shape as that statement.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import {
  choicesFor,
  debtDue,
  movementsOf,
  outstandingOf,
  owedChange,
  parentOf,
  partOf,
  positionOf,
  type Debt,
} from "./debt";
import { readDebtSentence } from "./debtSentence";
import { effectLabel, effectMeaning } from "./debtWords";
import { checkDraft, draftToTransactions, emptyDraft, type Draft } from "./entry";
import { readMoney } from "./proposal";
import { readEntry } from "./readEntry";
import { costOf, totalsFor } from "./totals";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
  credits: ["Easy Credit", "Mama"],
};

const line: Debt = {
  id: "easy-credit",
  name: "Easy Credit",
  kind: "payable",
  counterparty: "Bank",
  openedDate: "2026-01-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
  form: "credit-line",
  creditLimit: 500000,
};

const mama: Debt = { ...line, id: "mama", name: "Mama", kind: "receivable", form: "pass-through", creditLimit: undefined };

const opening: Transaction = {
  id: "in",
  recordNumber: 1,
  date: "2026-07-01",
  type: "Revenue",
  fromWallet: "",
  toWallet: "Maya",
  category: "Revenue",
  item: "Allowance",
  description: "",
  amount: 1000000,
  fee: 0,
  total: 1000000,
  notes: "",
  status: "Received",
};

const draft = (over: Partial<Draft>): Draft => ({
  ...emptyDraft("2026-07-10"),
  flow: "Debt",
  debtId: "easy-credit",
  item: "Easy Credit",
  ...over,
});

let seq = 0;
/** Save a draft the way the form does, against what is already there. */
function save(ledger: Transaction[], d: Draft): Transaction[] {
  const check = checkDraft(d, ledger, reference, [line, mama], d.date);
  expect(check.errors).toEqual([]);
  seq += 1;
  return [...ledger, ...draftToTransactions(d, ledger.length + 1, `t${seq}`, check.repaymentSplit)];
}

describe("fees the lender adds to what is owed", () => {
  it("saves a borrowing and its fees as two linked rows, the fees with no wallet", () => {
    const rows = draftToTransactions(draft({ debtEffect: "draw", toWallet: "Maya", amount: 300000, charges: 22655 }), 2, "b1");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "b1", debtEffect: "draw", amount: 300000, toWallet: "Maya" });
    expect(rows[1]).toMatchObject({ id: "b1-charge", debtEffect: "charge", amount: 22655, fromWallet: "", toWallet: "", partOf: "b1" });
    expect(partOf(rows[0] as Transaction, rows)?.id).toBe("b1-charge");
    expect(parentOf(rows[1] as Transaction, rows)?.id).toBe("b1");
  });

  it("owes the fees, counts them as spending on the day, and moves no wallet for them", () => {
    let ledger = [opening];
    ledger = save(ledger, draft({ debtEffect: "draw", toWallet: "Maya", amount: 300000, charges: 22655 }));
    expect(outstandingOf(ledger, "easy-credit")).toBe(322655);
    expect(walletBalance(ledger, "Maya")).toBe(1000000 + 300000);
    expect(ledger.reduce((sum, t) => sum + costOf(t), 0)).toBe(22655);
    expect(totalsFor(ledger).interest).toBe(22655);
  });

  it("clears to nothing when the payment matches the lender's balance, and counts nothing twice", () => {
    let ledger = [opening];
    ledger = save(ledger, draft({ date: "2026-07-10", debtEffect: "draw", toWallet: "Maya", amount: 300000, charges: 22655 }));
    ledger = save(ledger, draft({ date: "2026-08-02", debtEffect: "draw", toWallet: "Maya", amount: 120000, charges: 9062 }));
    ledger = save(ledger, draft({ date: "2026-08-05", debtEffect: "draw", toWallet: "Maya", amount: 50000, charges: 3789 }));
    const owed = outstandingOf(ledger, "easy-credit");
    expect(owed).toBe(300000 + 22655 + 120000 + 9062 + 50000 + 3789);

    ledger = save(ledger, draft({ date: "2026-09-01", debtEffect: "repay", fromWallet: "Maya", amount: owed }));
    expect(outstandingOf(ledger, "easy-credit")).toBe(0);
    // The payment is not spending: only the fees ever were.
    expect(ledger.reduce((sum, t) => sum + costOf(t), 0)).toBe(22655 + 9062 + 3789);
    expect(walletBalance(ledger, "Maya")).toBe(1000000 + 470000 - owed);
    // Nothing was split off the payment as interest.
    expect(ledger.filter((t) => t.debtEffect === "interest")).toEqual([]);
  });

  it("records a charge on its own, like a late fee, with no wallet", () => {
    let ledger = [opening];
    ledger = save(ledger, draft({ debtEffect: "draw", toWallet: "Maya", amount: 100000 }));
    ledger = save(ledger, draft({ debtEffect: "charge", amount: 15000 }));
    expect(outstandingOf(ledger, "easy-credit")).toBe(115000);
    expect(walletBalance(ledger, "Maya")).toBe(1100000);
    expect(positionOf(line, ledger, "2026-07-10").charged).toBe(15000);
  });

  it("counts the fees against the credit limit", () => {
    const ledger = save([opening], draft({ debtEffect: "draw", toWallet: "Maya", amount: 480000 }));
    const check = checkDraft(draft({ debtEffect: "draw", toWallet: "Maya", amount: 15000, charges: 10000 }), ledger, reference, [line]);
    expect(check.warnings.map((w) => w.message).join(" ")).toContain("over the ₱5,000.00 limit");
  });

  it("warns when interest is stated on a payment that already has its charges recorded", () => {
    const ledger = save([opening], draft({ debtEffect: "draw", toWallet: "Maya", amount: 100000, charges: 7000 }));
    const check = checkDraft(draft({ debtEffect: "repay", fromWallet: "Maya", amount: 107000, interest: 7000 }), ledger, reference, [line]);
    expect(check.warnings.some((w) => w.field === "interest")).toBe(true);
  });

  it("shows a borrowing and its fees as one movement in the history", () => {
    const ledger = save([opening], draft({ debtEffect: "draw", toWallet: "Maya", amount: 300000, charges: 22655 }));
    const moves = movementsOf(ledger.filter((t) => t.debtId === "easy-credit"));
    expect(moves).toHaveLength(1);
    expect(moves[0]?.total).toBe(322655);
    const owedAfter = moves.reduce((sum, m) => sum + owedChange(m.row) + (m.part ? owedChange(m.part) : 0), 0);
    expect(owedAfter).toBe(322655);
  });

  it("says when the next payment is due and how much, fees included", () => {
    const ledger = save([opening], draft({ date: "2026-07-10", debtEffect: "draw", toWallet: "Maya", amount: 300000, charges: 22655 }));
    const due = debtDue(positionOf({ ...line, dueDay: 5 }, ledger, "2026-07-20"), ledger, "2026-07-20");
    expect(due.amountDue).toBe(322655);
    expect(due.nextDue).toBe("2026-08-05");
  });
});

describe("the choices, in plain words", () => {
  it("offers Borrowed, Charge added, Paid and Waived for money owed", () => {
    expect(choicesFor("payable").map((e) => effectLabel(e, line))).toEqual(["Borrowed", "Charge added", "Paid", "Waived"]);
  });

  it("says what a charge does without jargon", () => {
    expect(effectMeaning("charge", line)).toContain("No money moves now");
  });

  it("names money passing through by what happened", () => {
    expect(choicesFor("receivable", undefined, "pass-through").map((e) => effectLabel(e, mama))).toEqual([
      "Sent for them",
      "Paid back to you",
      "Given up",
    ]);
    const held = { ...mama, kind: "payable" as const };
    expect(choicesFor("payable", undefined, "pass-through").map((e) => effectLabel(e, held))).toEqual([
      "Received for them",
      "Passed on",
      "Kept",
    ]);
  });
});

describe("money passing through for someone else", () => {
  /**
   * The owner's example: their mother asks them to send ₱1,000 to family and
   * gives it back in cash. The bank records ₱1,000 leaving, then cash arrives.
   * None of it is spending and none of it is income. The ₱15.00 fee to send
   * it is spending, because the owner paid it.
   */
  it("keeps sending money for someone out of spending, and their payment out of income", () => {
    let ledger = [opening];
    ledger = save(ledger, draft({ debtId: "mama", item: "Mama", debtEffect: "lend", fromWallet: "Maya", amount: 100000 }));
    ledger = [
      ...ledger,
      {
        ...opening,
        id: "fee",
        recordNumber: 9,
        type: "Spending",
        fromWallet: "Maya",
        toWallet: "",
        category: "Spending",
        item: "Transaction Fee",
        amount: 1500,
        total: 1500,
        status: "Paid",
      },
    ];
    expect(outstandingOf(ledger, "mama")).toBe(100000);
    ledger = save(ledger, draft({ date: "2026-07-12", debtId: "mama", item: "Mama", debtEffect: "collect", toWallet: "Cash", amount: 100000 }));

    expect(outstandingOf(ledger, "mama")).toBe(0);
    expect(walletBalance(ledger, "Maya")).toBe(1000000 - 100000 - 1500);
    expect(walletBalance(ledger, "Cash")).toBe(100000);
    const totals = totalsFor(ledger.filter((t) => t.id !== "in"));
    expect(totals.total).toBe(1500);
    expect(totals.revenue).toBe(0);
  });
});

describe("money passing through, said in a sentence", () => {
  it("reads money sent for someone who pays it back as lending to them, from the wallet it left", () => {
    const got = readEntry("my mother asked me to send 1000 to tita from maya, she will pay me back in cash", [], reference, "2026-09-10");
    expect(got.readsAsDebt).toBe(true);
    expect(got.passThrough).toBe("fronted");
    expect(got.draft).toMatchObject({ flow: "Debt", debtEffect: "lend", fromWallet: "Maya", amount: 100000 });
  });

  it("names the person when they are already kept", () => {
    const got = readEntry("sent 500 from gcash for mama, she will pay me back", [], reference, "2026-09-10");
    expect(got.draft).toMatchObject({ debtId: "mama", debtEffect: "lend", fromWallet: "Gcash" });
  });

  it("reads a client's money received for someone else as held for them", () => {
    const got = readEntry("received 5000 in maya for the company, I will pass it on", [], reference, "2026-09-10");
    expect(got.passThrough).toBe("held");
    expect(got.draft).toMatchObject({ debtEffect: "draw", toWallet: "Maya", amount: 500000 });
  });

  it("leaves an ordinary payment and an ordinary income alone", () => {
    expect(readEntry("I paid 500 for food from maya", [], reference, "2026-09-10").passThrough ?? null).toBeNull();
    expect(readEntry("received 5000 salary in maya", [], reference, "2026-09-10").passThrough ?? null).toBeNull();
  });
});

describe("reading the lender's words", () => {
  const figure = (t: string) => {
    const m = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{1,2}|\d{2,})/.exec(t);
    return m?.[1] ? readMoney(m[1]) : null;
  };
  const read = (text: string) => readDebtSentence(text, figure, readMoney);

  it("adds up every fee named on a borrowing", () => {
    expect(read("borrowed 1050 from easy credit into maya, service fee 78.64 and dst 0.65")).toMatchObject({
      effect: "draw",
      amount: 105000,
      charges: 7929,
    });
  });

  it("reads interest added when the money was taken as a charge on it", () => {
    expect(read("nangutang 5000 sa easy credit, tubo 250")).toMatchObject({ effect: "draw", amount: 500000, charges: 25000 });
  });

  it("reads fees with no payment and no borrowing as a charge added", () => {
    expect(read("easy credit late fee 150")).toMatchObject({ effect: "charge", amount: 15000 });
    expect(read("easy credit service fee 29.96 dst 0.25")).toMatchObject({ effect: "charge", amount: 3021 });
  });

  it("never takes a fee figure for the amount of a payment", () => {
    expect(read("paid easy credit 4021.36 with 282.36 fees")).toMatchObject({ effect: "repay", amount: 402136, interest: 28236 });
  });

  it("fills the chat's card from the words, fees and all", () => {
    const got = readEntry("borrowed 1050 from easy credit into maya, service fee 78.64 and dst 0.65", [], reference, "2026-08-13");
    expect(got.readsAsDebt).toBe(true);
    expect(got.draft).toMatchObject({ debtId: "easy-credit", debtEffect: "draw", toWallet: "Maya", amount: 105000, charges: 7929 });
  });
});
