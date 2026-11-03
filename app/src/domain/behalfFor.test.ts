/**
 * A bill paid for someone else, known from the ledger.
 *
 * The owner, 27 September 2026: their father's Globe Postpaid is his, they
 * pay it and he gives them the money, "so its not technically my spending".
 * Once his payments were filed On behalf, the next one still read as their
 * own bill, and "paid my father's globe postpaid" as paying back a debt
 * they owe him. Figures and dates here are invented.
 */

import { describe, expect, it } from "vitest";

import { behalfFor, directionOf, namesPerson } from "./behalfFor";
import { fillDebt } from "./debtFill";
import type { Debt } from "./debt";
import { REFERENCE } from "./eval/corpus";
import { readEntry } from "./readEntry";
import type { BehalfPerson, ReferenceLists, Transaction } from "./types";

const TODAY = "2026-09-27";

const father: Debt = {
  id: "father",
  name: "Father",
  kind: "receivable",
  form: "pass-through",
  counterparty: "Father",
  counterpartyType: "person",
  openedDate: "2026-04-01",
  wallet: "Cash",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};
const people: BehalfPerson[] = [{ id: "father", name: "Father", side: "owed" }];

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `r${n}`,
    recordNumber: n,
    date: "2026-01-01",
    type: "Spending",
    fromWallet: "Gcash",
    toWallet: "",
    category: "Bills",
    item: "Globe Postpaid",
    description: "",
    amount: 45000,
    fee: 0,
    total: 45000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

/** Their own bill until last year, his since. */
const ledger: Transaction[] = [
  row({ date: "2025-06-05" }),
  row({ date: "2025-07-05" }),
  row({ date: "2025-10-05" }),
  row({ date: "2026-04-05", type: "Debt", category: "", item: "Father", description: "Pay my fathers Globe postpaid", debtId: "father", debtEffect: "lend" }),
  row({ date: "2026-04-09", type: "Debt", category: "", item: "Father", description: "Father's payment for his plan", fromWallet: "", toWallet: "Cash", debtId: "father", debtEffect: "collect", status: "Received" }),
  row({ date: "2026-08-05", type: "Debt", category: "", item: "Father", description: "Pay my father's postpaid plan", debtId: "father", debtEffect: "lend" }),
  row({ date: "2026-08-10", type: "Revenue", category: "Revenue", item: "Allowance", description: "Cash given by my father", fromWallet: "", toWallet: "Cash", amount: 100000, total: 100000, status: "Received" }),
  row({ date: "2026-09-01", item: "Load", category: "Spending", description: "Globe load", amount: 5000, total: 5000 }),
  row({ date: "2026-09-02", item: "Load", category: "Spending", description: "Globe load", amount: 5000, total: 5000 }),
];

const reference: ReferenceLists = {
  ...REFERENCE,
  bills: [...REFERENCE.bills, "Globe Postpaid"],
  revenueCategories: [...REFERENCE.revenueCategories, "Allowance"],
  credits: [...(REFERENCE.credits ?? []), "Father"],
  onBehalf: people,
};

const read = (said: string) => {
  const r = readEntry(said, ledger, reference, TODAY);
  return r.readsAsDebt ? fillDebt(r.draft, said, [father], ledger, [...reference.wallets, ...reference.savings], TODAY).draft : r.draft;
};

describe("who is named", () => {
  it("knows a parent by what the family calls them", () => {
    for (const said of ["my father's plan", "papa gave me", "dad sent", "tatay", "Pay my fathers Globe postpaid"]) {
      expect(namesPerson(said, "Father"), said).toBe(true);
    }
    expect(namesPerson("I ate 200 for lunch", "Sister")).toBe(false);
    expect(namesPerson("mama gave me 500", "Father")).toBe(false);
  });

  it("reads which way the money went", () => {
    expect(directionOf("papa gave me 450")).toBe("in");
    expect(directionOf("paid his postpaid 450")).toBe("out");
    expect(directionOf("postpaid 450")).toBeNull();
  });
});

describe("a bill that is now someone else's", () => {
  it("files his plan paid from a wallet as an advance to him", () => {
    for (const said of ["paid globe postpaid 450 gcash", "paid my father's globe postpaid 450 from gcash"]) {
      expect(read(said), said).toMatchObject({ flow: "Debt", behalf: "owed", debtId: "father", debtEffect: "lend", fromWallet: "Gcash", amount: 45000 });
    }
  });

  it("files his money for it as paid back, not income", () => {
    expect(read("papa gave me 450 for his globe postpaid in gcash")).toMatchObject({
      flow: "Debt",
      behalf: "owed",
      debtId: "father",
      debtEffect: "collect",
      toWallet: "Gcash",
      fromWallet: "",
    });
  });

  it("keeps what the payment was on the row, so the next one is known too", () => {
    expect(read("paid globe postpaid 450 gcash").description).toBe("Globe Postpaid");
  });

  it("never reads paying for him as paying back a debt you owe him", () => {
    expect(read("paid my father's globe postpaid 450 from gcash").debtEffect).not.toBe("repay");
    expect(read("paid my father's globe postpaid 450 from gcash").debtEffect).not.toBe("collect");
  });
});

describe("what stays the owner's own", () => {
  it("keeps money from him that is not for his plan as income", () => {
    expect(read("papa gave me 1000 allowance gcash")).toMatchObject({ flow: "Revenue", toWallet: "Gcash" });
    expect(read("Father give me 1000 for the car jump starter cash")).toMatchObject({ flow: "Revenue", toWallet: "Cash" });
  });

  it("keeps a thing mostly bought for themselves as theirs", () => {
    expect(read("bought globe load 50 gcash").flow).toBe("Spending");
  });

  it("keeps a plan of their own at a different price as theirs", () => {
    expect(read("paid my own postpaid 1299 gcash").flow).toBe("Spending");
  });

  it("does nothing with nobody on the list", () => {
    expect(behalfFor("paid globe postpaid 450 gcash", ledger, [], TODAY, 45000)).toBeNull();
    expect(readEntry("paid globe postpaid 450 gcash", ledger, { ...reference, onBehalf: [] }, TODAY).draft.flow).not.toBe("Debt");
  });
});

/*
 * The 3 November 2026 process test: the owner's own Globe at Home bill made
 * "paid 599 for my father's globe" ask what it was for, and "father gave me
 * 1000 for his bill" was booked as PHP 1,000.00 of income.
 */
describe("said outright whose it is", () => {
  const withOwn = [...ledger, row({ date: "2026-10-20", category: "Bills", item: "Globe at Home Wifi", description: "Globe at home", amount: 99900, total: 99900 })];
  const readOwn = (said: string) => {
    const r = readEntry(said, withOwn, reference, TODAY);
    return r.readsAsDebt ? fillDebt(r.draft, said, [father], withOwn, [...reference.wallets, ...reference.savings], TODAY).draft : r.draft;
  };

  it("their bill, paid: an advance to them, whatever the owner's own rows say", () => {
    expect(behalfFor("paid 599 for my father's globe", withOwn, people, TODAY, 59900)).toMatchObject({ person: { id: "father" }, effect: "lend" });
    expect(behalfFor("paid for my father globe bill 599", withOwn, people, TODAY, 59900)).toMatchObject({ person: { id: "father" }, effect: "lend" });
    expect(readOwn("paid 599 for my father's globe gcash")).toMatchObject({ flow: "Debt", debtId: "father", debtEffect: "lend", amount: 59900 });
  });

  it("a present for them stays the owner's spending", () => {
    expect(behalfFor("bought a birthday gift for my father 599", withOwn, people, TODAY, 59900)).toBeNull();
    expect(behalfFor("bought a gift for papa's birthday 599", withOwn, people, TODAY, 59900)).toBeNull();
  });

  it("their money for their own bill is theirs, not income", () => {
    expect(behalfFor("father gave me 1000 for his bill", withOwn, people, TODAY, 100000)).toMatchObject({ person: { id: "father" }, effect: "collect" });
    expect(readOwn("father gave me 1000 for his bill cash")).toMatchObject({ flow: "Debt", debtId: "father", debtEffect: "collect", toWallet: "Cash" });
  });

  it("money for the owner stays income", () => {
    expect(behalfFor("papa gave me 500 for my birthday", withOwn, people, TODAY, 50000)).toBeNull();
    expect(readOwn("papa gave me 500 for my birthday gcash").flow).not.toBe("Debt");
  });
});
