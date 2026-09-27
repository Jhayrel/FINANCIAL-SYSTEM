/**
 * Money passed on for someone, the fee to send it, and the messages about it.
 *
 * The owner, 27 September 2026: ₱40,000 arrived in their GCash from their
 * mother, ₱25,000 of it their aunt's for a funeral. Then ₱30,010 left for a
 * bank that is not one of their accounts (the aunt's ₱25,000, ₱5,000 of
 * their own, a ₱10 fee) and ₱9,990 went to their own Maya. They asked how
 * to log it, and what happens to a fee paid with their own money. The same
 * day the chat read "interest added" to their savings as credit line debt,
 * and a long message about the ₱40,000 as a balance check. Names and
 * figures here are invented, in the same shape.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { behalfFor, namesPerson, splitsWhose } from "./behalfFor";
import { cardQuestion } from "./cardQuestions";
import { outstandingOf } from "./debt";
import { draftToTransactions, emptyDraft, type Draft } from "./entry";
import { REFERENCE } from "./eval/corpus";
import { entryLineIn, isEssay, meantInstead, notMeantIn, sayInstead } from "./intent";
import { readInvestigateAsk } from "./investigateAsk";
import { kindOf } from "./kinds";
import { readProposals } from "./proposal";
import { readEntry } from "./readEntry";
import { costOf, totalsFor } from "./totals";
import type { BehalfPerson, ReferenceLists, Transaction } from "./types";

const TODAY = "2026-09-27";
const aunt: BehalfPerson = { id: "tita-ana-s-money", name: "Tita Ana's money", side: "held" };
const reference: ReferenceLists = { ...REFERENCE, credits: [...(REFERENCE.credits ?? []), aunt.name], onBehalf: [aunt] };

const row = (over: Partial<Transaction>): Transaction => ({
  id: "r",
  recordNumber: 1,
  date: TODAY,
  type: "Revenue",
  fromWallet: "",
  toWallet: "Gcash",
  category: "Revenue",
  item: "Allowance",
  description: "",
  amount: 1500000,
  fee: 0,
  total: 1500000,
  notes: "",
  status: "Received",
  ...over,
});

const arrived: Transaction[] = [
  row({ id: "a", recordNumber: 1 }),
  row({ id: "h", recordNumber: 2, type: "Debt", category: "", item: "", amount: 2500000, total: 2500000, debtId: aunt.id, debtEffect: "draw" }),
];

const passOn = (over: Partial<Draft>): Draft => ({
  ...emptyDraft(TODAY),
  flow: "Debt",
  behalf: "held",
  debtId: aunt.id,
  debtEffect: "repay",
  fromWallet: "Gcash",
  amount: 2500000,
  ...over,
});

describe("a fee paid with your own money", () => {
  it("leaves the wallet with the money, counts as your transfer fee, and never touches what is held", () => {
    const rows = [...arrived, ...draftToTransactions(passOn({ fee: 1000 }), 3, "p")];
    expect(walletBalance(rows, "Gcash")).toBe(4000000 - 2500000 - 1000);
    expect(outstandingOf(rows, aunt.id)).toBe(0);
    const released = rows[2]!;
    expect(costOf(released)).toBe(1000);
    expect(kindOf(released)).toBe("Transaction Fee");
    expect(totalsFor(rows)).toMatchObject({ fees: 1000, spending: 0, interest: 0 });
  });

  it("stays on a debt payment split into principal and interest, as a fee and not interest", () => {
    const d: Draft = { ...emptyDraft(TODAY), flow: "Debt", debtId: "maya-credit", debtEffect: "repay", fromWallet: "Gcash", amount: 300000, fee: 1500 };
    const [paid, interest] = draftToTransactions(d, 5, "q", { principal: 280000, interest: 20000 });
    expect(paid).toMatchObject({ amount: 280000, fee: 1500, total: 281500 });
    expect(interest).toMatchObject({ amount: 20000, fee: 0 });
    expect(totalsFor([paid!, interest!])).toMatchObject({ fees: 1500, interest: 20000 });
  });

  it("is dropped where no money left a wallet", () => {
    const [held] = draftToTransactions(passOn({ debtEffect: "draw", toWallet: "Gcash", fromWallet: "", fee: 1000 }), 6, "r");
    expect(held).toMatchObject({ fee: 0, total: 2500000 });
  });
});

describe("reading money passed on", () => {
  it("does not take 'money' for the aunt whose entry is called her money", () => {
    expect(namesPerson("my money is in gcash", aunt.name)).toBe(false);
    expect(namesPerson("sent it to tita ana", aunt.name)).toBe(true);
  });

  it("reads giving her money out of a wallet as passing it on, with the fee", () => {
    for (const said of ["I gave tita ana her 25000 from gcash with 10 fee", "sent 25000 to tita ana from gcash 10 fee"]) {
      const d = readEntry(said, arrived, reference, TODAY).draft;
      expect(d, said).toMatchObject({ flow: "Debt", behalf: "held", debtEffect: "repay", debtId: aunt.id, fromWallet: "Gcash", amount: 2500000, fee: 1000 });
    }
  });

  it("does not read sending to her as passing on when nothing of hers is held", () => {
    expect(behalfFor("sent 500 to tita ana from maya", [], [aunt], TODAY, 50000)).toBeNull();
  });

  it("knows one transfer that is part hers and part yours is two entries", () => {
    expect(splitsWhose("sent 30000 to the bank from gcash with 10 fee, 25000 is tita ana's money and 5000 is my allowance")).toBe(true);
    expect(splitsWhose("sent 30k to the bank, 25k is tita ana's and 5k is mine, 10 fee")).toBe(true);
    expect(splitsWhose("sent 25000 to tita ana from gcash with 10 fee")).toBe(false);
  });

  it("takes the model's fee onto the row that moved the money", () => {
    const { proposals } = readProposals(
      { proposals: [{ flow: "OnBehalf", debtEffect: "released", debt: aunt.name, fromWallet: "Gcash", amountPesos: 25000, feePesos: 10 }] },
      reference,
      TODAY,
    );
    expect(proposals[0]?.draft).toMatchObject({ behalf: "held", debtEffect: "repay", fee: 1000 });
  });

  it("knows her by what the model calls her, not only by her full entry", () => {
    const { proposals } = readProposals(
      { proposals: [{ flow: "OnBehalf", debtEffect: "released", debt: "Tita Ana", fromWallet: "Gcash", amountPesos: 25000 }] },
      reference,
      TODAY,
    );
    expect(proposals[0]?.draft.debtId).toBe(aunt.id);
  });

  it("reads a transfer to a place that is not one of your accounts as sent out, and asks nothing", () => {
    for (const row of [
      { flow: "Transfer", fromWallet: "Gcash", toWallet: "PNB", amountPesos: 5000, feePesos: 10 },
      { flow: "Transfer", fromWallet: "Gcash", toWallet: "", amountPesos: 5000, feePesos: 10, description: "to PNB (business)" },
    ]) {
      const { proposals } = readProposals({ proposals: [row] }, reference, TODAY);
      const d = proposals[0]!.draft;
      expect(d).toMatchObject({ flow: "Transfer", sentOut: true, toWallet: "", fromWallet: "Gcash", amount: 500000, fee: 1000 });
      expect(cardQuestion(d, reference, 1, 1)).toBeNull();
    }
    // One of their own accounts stays theirs.
    const own = readProposals({ proposals: [{ flow: "Transfer", fromWallet: "Gcash", toWallet: "Maya", amountPesos: 9980, feePesos: 10 }] }, reference, TODAY);
    expect(own.proposals[0]?.draft).toMatchObject({ toWallet: "Maya" });
    expect(own.proposals[0]?.draft.sentOut).toBeUndefined();
  });

  it("never files income under a credit line's name", () => {
    const { proposals } = readProposals({ proposals: [{ flow: "Revenue", item: "Maya Credit", toWallet: "Gcash", amountPesos: 40000 }] }, reference, TODAY);
    expect(proposals[0]?.draft.item).toBe("");
  });
});

describe("interest on savings, said the owner's way", () => {
  it("names the savings account by its name without brackets", () => {
    const d = readEntry("Add the interest to my maya bank", [], reference, TODAY).draft;
    expect(d).toMatchObject({ flow: "Revenue", item: "Bank interest", toWallet: "Maya Bank (Personal savings)" });
    expect(readEntry("its revenue interest", [], reference, TODAY).readsAsDebt).toBe(false);
  });

  it("keeps interest on a credit line as debt", () => {
    expect(readEntry("paid the interest on maya credit 150 from maya", [], reference, TODAY).readsAsDebt).toBe(true);
  });

  it("reads a savings balance as a request to compare it", () => {
    const ask = readInvestigateAsk(
      "My new balance in maya bank is 1533.83 can you look because there's some interest added.",
      [...reference.wallets, ...reference.savings],
      () => 152758,
      TODAY,
    );
    expect(ask).toMatchObject({ account: "Maya Bank (Personal savings)", actual: 153383 });
  });

  it("takes the figure nearest the ledger as the balance, not the difference", () => {
    const ask = readInvestigateAsk(
      "6.25 interest was added (1,533.83 - 1,527.58) but this app says maya bank has 1,527.58",
      [...reference.wallets, ...reference.savings],
      () => 152758,
      TODAY,
    );
    expect(ask?.actual).toBe(153383);
  });
});

describe("the chat, around those", () => {
  it("offers the entry an answer worked out", () => {
    expect(entryLineIn("That is **PHP 6.25** of interest.\n\nEntry: Revenue PHP 6.25, Bank interest, into Maya Bank (Personal savings)")).toBe(
      "Revenue PHP 6.25, Bank interest, into Maya Bank (Personal savings)",
    );
    const d = readEntry("Revenue PHP 6.25, Bank interest, into Maya Bank (Personal savings)", [], reference, TODAY).draft;
    expect(d).toMatchObject({ flow: "Revenue", amount: 625, item: "Bank interest", toWallet: "Maya Bank (Personal savings)" });
  });

  it("sends a long message whole to the model", () => {
    const long = ["My mom sent me 40,000 through GCash.", "25,000 is for my tita.", "3,000 is our fare.", "12,000 is my allowance.", "5,000 goes to the bank."].join("\n\n");
    expect(isEssay(long)).toBe(true);
    expect(isEssay("sent 9980 to maya from gcash 10 fee")).toBe(false);
  });

  it("reads 'I am referring to X not Y' as a correction of the last message", () => {
    const said = "I am referring to maya bank not maya";
    expect(meantInstead(said)).toBe("maya bank");
    expect(notMeantIn(said)).toBe("maya");
    expect(sayInstead("my balance in maya is 1533.83", "maya bank", "maya")).toBe("my balance in maya bank is 1533.83");
  });
});
