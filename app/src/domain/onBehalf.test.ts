/**
 * On behalf of someone: its own type, apart from Debt.
 *
 * The owner, 2026-09-17: paying for a friend's meal who repays later is not a
 * loan, nor is sending money a mother pays back, nor holding money for
 * someone. And a friend who never pays is spending from then on. Stored as
 * movements on a person whose form is `pass-through`, so balances follow the
 * tested debt rules; a write-off counts as spending and a retained amount as
 * income. Names and figures are invented.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { outstandingOf, type Debt } from "./debt";
import { personDebt } from "./debtFill";
import { effectLabel } from "./debtWords";
import { checkDraft, draftToTransactions, emptyDraft, type Draft } from "./entry";
import { REFERENCE, TODAY } from "./eval/corpus";
import { readProposals } from "./proposal";
import { readEntry } from "./readEntry";
import { costOf, incomeOf, totalsFor } from "./totals";
import type { Transaction } from "./types";

const read = (said: string) => readEntry(said, [], REFERENCE, TODAY).draft;

const friend: Debt = {
  id: "stephen",
  name: "Stephen",
  kind: "receivable",
  form: "pass-through",
  counterparty: "Stephen",
  counterpartyType: "person",
  openedDate: "2026-09-01",
  wallet: "Cash",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};
const boss: Debt = { ...friend, id: "boss", name: "Boss", kind: "payable" };

const opening: Transaction = {
  id: "in",
  recordNumber: 1,
  date: "2026-09-01",
  type: "Revenue",
  fromWallet: "",
  toWallet: "Cash",
  category: "Revenue",
  item: "Allowance",
  description: "",
  amount: 100000,
  fee: 0,
  total: 100000,
  notes: "",
  status: "Received",
};

const entry = (over: Partial<Draft>): Draft => ({ ...emptyDraft("2026-09-10"), flow: "Debt", ...over });

let n = 1;
function save(ledger: Transaction[], d: Draft): Transaction[] {
  const check = checkDraft(d, ledger, REFERENCE, [friend, boss], TODAY);
  expect(check.errors).toEqual([]);
  n += 1;
  return [...ledger, ...draftToTransactions(d, n, `t${n}`)];
}

describe("reading On behalf out of a sentence", () => {
  it("reads paying for a friend who repays later as an advance, from the wallet it left", () => {
    expect(read("i paid my freind food 180 cash and he will pay me back")).toMatchObject({ behalf: "owed", debtEffect: "lend", amount: 18000, fromWallet: "Cash" });
    expect(read("I used my 700 in maya to send to my tita, my mother will pay for it")).toMatchObject({ behalf: "owed", debtEffect: "lend", fromWallet: "Maya" });
  });

  it("reads holding, releasing and keeping someone's money", () => {
    expect(read("I hold 900 for my brother in cash")).toMatchObject({ behalf: "held", debtEffect: "draw", toWallet: "Cash" });
    expect(read("I gave my boss his 4000 from maya")).toMatchObject({ behalf: "held", debtEffect: "repay", fromWallet: "Maya" });
    expect(read("mama let me keep the 900")).toMatchObject({ behalf: "held", debtEffect: "writeoff" });
  });

  it("reads a friend who will never pay as a write off", () => {
    expect(read("Stephen will not pay the 45 anymore, write it off")).toMatchObject({ behalf: "owed", debtEffect: "writeoff", amount: 4500 });
  });

  it("leaves a gift and the owner's own promises alone", () => {
    expect(read("gave her 200 in cash").flow).toBe("Transfer");
    expect(read("I will pay my credit tomorrow").behalf).toBeUndefined();
  });
});

describe("what it does to the money", () => {
  it("moves the wallet and not spending, then counts a write off as spending under its item", () => {
    let ledger = [opening];
    ledger = save(ledger, entry({ behalf: "owed", debtId: "stephen", debtEffect: "lend", fromWallet: "Cash", amount: 6000 }));
    expect(walletBalance(ledger, "Cash")).toBe(94000);
    expect(outstandingOf(ledger, "stephen")).toBe(6000);
    expect(totalsFor(ledger).total).toBe(0);

    ledger = save(ledger, entry({ behalf: "owed", debtId: "stephen", debtEffect: "writeoff", item: "Treat", amount: 6000 }));
    const written = ledger[ledger.length - 1] as Transaction;
    expect(written).toMatchObject({ category: "Spending", item: "Treat", fromWallet: "", toWallet: "" });
    expect(outstandingOf(ledger, "stephen")).toBe(0);
    expect(walletBalance(ledger, "Cash")).toBe(94000);
    expect(costOf(written)).toBe(6000);
    expect(totalsFor(ledger)).toMatchObject({ spending: 6000, total: 6000 });
  });

  it("counts money held and retained as income, and money released as neither", () => {
    let ledger = [opening];
    ledger = save(ledger, entry({ behalf: "held", debtId: "boss", debtEffect: "draw", toWallet: "Cash", amount: 50000 }));
    expect(totalsFor(ledger).revenue).toBe(100000);
    ledger = save(ledger, entry({ behalf: "held", debtId: "boss", debtEffect: "writeoff", item: "Random", amount: 50000 }));
    const kept = ledger[ledger.length - 1] as Transaction;
    expect(kept.category).toBe("Revenue");
    expect(incomeOf(kept)).toBe(50000);
    expect(totalsFor(ledger).revenue).toBe(150000);
    expect(walletBalance(ledger, "Cash")).toBe(150000);
  });

  it("asks what a write off counts as, and keeps an ordinary debt's write off out of every total", () => {
    const check = checkDraft(entry({ behalf: "owed", debtId: "stephen", debtEffect: "writeoff", amount: 6000 }), [opening], REFERENCE, [friend], TODAY);
    expect(check.errors.map((e) => e.field)).toContain("item");
    const plain = draftToTransactions(entry({ debtId: "maya-credit", debtEffect: "writeoff", item: "Maya Credit", amount: 1000 }), 5, "w");
    expect(plain[0]?.category).toBe("");
    expect(costOf(plain[0] as Transaction)).toBe(0);
  });
});

describe("the words, the model and the people", () => {
  it("names each movement in accounting terms", () => {
    expect(["lend", "collect", "writeoff"].map((e) => effectLabel(e as "lend", friend))).toEqual(["Advance", "Reimbursed", "Write off"]);
    expect(["draw", "repay", "writeoff"].map((e) => effectLabel(e as "draw", boss))).toEqual(["Held", "Released", "Retained"]);
  });

  it("reads the model's OnBehalf rows onto the right side and wallet", () => {
    const { proposals } = readProposals(
      {
        proposals: [
          { flow: "OnBehalf", debtEffect: "advance", debt: "Pedro", fromWallet: "Gcash", amountPesos: 250 },
          { flow: "OnBehalf", debtEffect: "held", toWallet: "Maya", amountPesos: 5000 },
        ],
      },
      REFERENCE,
      TODAY,
    );
    expect(proposals[0]?.draft).toMatchObject({ flow: "Debt", behalf: "owed", debtEffect: "lend", fromWallet: "Gcash", amount: 25000 });
    expect(proposals[1]?.draft).toMatchObject({ behalf: "held", debtEffect: "draw", toWallet: "Maya" });
  });

  it("adds a new person on the side they are on", () => {
    expect(personDebt("Pedro", entry({ behalf: "owed", debtEffect: "writeoff" }), [], "Cash")).toMatchObject({ kind: "receivable", form: "pass-through" });
    expect(personDebt("Ana", entry({ behalf: "held", debtEffect: "draw" }), [], "Cash")).toMatchObject({ kind: "payable", form: "pass-through" });
    expect(personDebt("Juan", entry({ debtEffect: "lend" }), [], "Cash").form).toBe("informal");
  });
});
