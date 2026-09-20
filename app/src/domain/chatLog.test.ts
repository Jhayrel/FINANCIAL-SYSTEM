/**
 * Sentences from the owner's own chat record, 2026-09-13 to 2026-09-16, that
 * came back wrong or came back with nothing.
 *
 * The spelling is kept, because the spelling is what broke them. Every figure
 * and name is changed: the repository is public and the record is not.
 */

import { describe, expect, it } from "vitest";

import { readBudgetAsk } from "./budgetAsk";
import { applyReply, nextQuestion } from "./capture";
import type { Debt } from "./debt";
import { fillDebt, personDebt, personIn } from "./debtFill";
import { readPassThrough } from "./debtSentence";
import { emptyDraft, withDebtEffect, type Draft } from "./entry";
import { REFERENCE, TODAY } from "./eval/corpus";
import { detectIntent } from "./intent";
import { readEntry } from "./readEntry";
import { detectRecall, saysLatestIsWrong, wantsDiscardOpen } from "./recall";
import type { Transaction } from "./types";

const read = (said: string) => readEntry(said, [], REFERENCE, TODAY);

describe("interest a bank pays you", () => {
  it("reads daily savings interest as income into the savings account, not as debt", () => {
    const r = read("my maya savings earned 0.31 interest today");
    expect(r.readsAsDebt).toBe(false);
    expect(r.draft).toMatchObject({ flow: "Revenue", amount: 31, toWallet: "Maya Bank (Personal savings)", item: "Bank interest" });
  });

  it("reads the figure first, the way the bank's list shows it", () => {
    const r = read("interest 1.37 on maya bank savings");
    expect(r.readsAsDebt).toBe(false);
    expect(r.draft).toMatchObject({ flow: "Revenue", amount: 137, toWallet: "Maya Bank (Personal savings)" });
  });

  it("keeps interest credited to a wallet in that wallet", () => {
    const r = read("bank interest credited to maya 4.02");
    expect(r.draft).toMatchObject({ flow: "Revenue", toWallet: "Maya", amount: 402 });
  });

  it("still reads interest paid on a credit line as debt", () => {
    expect(read("I paid the interest on maya credit").readsAsDebt).toBe(true);
    expect(read("paid 120 interest on my loan").readsAsDebt).toBe(true);
  });
});

describe("lending and being paid back", () => {
  it("reads money lent as lending, from the wallet named", () => {
    const r = read("I lent 500 to Juan from gcash");
    expect(r.readsAsDebt).toBe(true);
    expect(r.draft).toMatchObject({ debtEffect: "lend", amount: 50000, fromWallet: "Gcash" });
  });

  it("reads a payment back as a collection into the wallet named, never as lending", () => {
    const r = read("Juan paid me back 200 in cash");
    expect(r.draft).toMatchObject({ debtEffect: "collect", amount: 20000, toWallet: "Cash" });
    expect(readPassThrough("Juan paid me back 200 in cash")).toBeNull();
  });

  it("still reads a promise to pay back as money passing through", () => {
    expect(readPassThrough("sent 1000 for mama, she will pay me back in cash")).toBe("fronted");
  });

  it("reads borrowing from a person as borrowing", () => {
    expect(read("I borrowed 1000 from kuya in cash").draft).toMatchObject({ debtEffect: "draw", amount: 100000, toWallet: "Cash" });
  });

  it("reads 'my credit' as the credit line, not as spending", () => {
    const r = read("I paid my credit");
    expect(r.readsAsDebt).toBe(true);
    expect(r.draft.debtEffect).toBe("repay");
  });
});

describe("wallets and people in ordinary entries", () => {
  it("takes the wallet after 'to' as where a purchase was paid from", () => {
    expect(read("I spend 350 today to my maya food").draft).toMatchObject({ flow: "Spending", fromWallet: "Maya", amount: 35000 });
  });

  it("reads money sent to a misspelt friend as money that left", () => {
    const r = read("i transfered 2500 to my freind I used my gcash");
    expect(r.draft).toMatchObject({ flow: "Transfer", fromWallet: "Gcash", amount: 250000, sentOut: true });
  });
});

describe("cancelling and correcting from the chat", () => {
  it("reads cancel as throwing the open card away", () => {
    expect(wantsDiscardOpen("cancel")).toBe(true);
    expect(wantsDiscardOpen("cancel this")).toBe(true);
    // A named subscription is a row to find, not the card.
    expect(wantsDiscardOpen("cancel my netflix")).toBe(false);
    expect(detectRecall("cancel my netflix")?.action).toBe("bin");
  });

  it("recognises an entry said to be wrong, with nothing to change named", () => {
    expect(saysLatestIsWrong("Theinput earlier is wrong")).toBe(true);
    expect(saysLatestIsWrong("that last transaction is a mistake")).toBe(true);
    expect(saysLatestIsWrong("the last one is wrong, it was 300")).toBe(false);
    expect(saysLatestIsWrong("what is wrong with my budget")).toBe(false);
  });

  /**
   * With a card open, a message that is not an entry is read as a correction
   * to it. "I earn 1000" was not recognised as an entry, so a snack on the
   * open card became ₱1,000.00 and the next reply moved it to Maya.
   */
  it("reads earning as an entry, never as a correction to the card on screen", () => {
    expect(detectIntent("I earn 1700")).toBe("log");
    expect(detectIntent("recieved 500 from client")).toBe("log");
    expect(detectIntent("make it 300")).toBe("ask");
  });

  it("splits an answer holding a wallet and what it was for, and does not ask again", () => {
    const earned = read("I earn 1700").draft;
    const filled = applyReply(earned, "item", "maya and income from my business", REFERENCE, []);
    expect(filled).toMatchObject({ toWallet: "Maya", item: "", description: "income from my business", amount: 170000 });
    expect(filled && nextQuestion(filled, REFERENCE, ["item"])).toBeNull();
    // A short answer is still the item.
    expect(applyReply(earned, "item", "allowance", REFERENCE, [])?.item).toBe("Allowance");
  });

  it("reads a misspelt budget request", () => {
    expect(readBudgetAsk("add buget same as last month", REFERENCE, TODAY)?.kind).toBe("copy");
  });
});

const credit: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  form: "credit-line",
  counterparty: "Maya",
  counterpartyType: "institution",
  openedDate: "2026-01-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  dueDay: 20,
  notes: "",
  archived: false,
};
const juan: Debt = { ...credit, id: "juan", name: "Juan", kind: "receivable", form: "informal", counterparty: "Juan", counterpartyType: "person", dueDay: undefined };

const row = (over: Partial<Transaction>): Transaction => ({
  id: "r1",
  recordNumber: 1,
  date: "2026-08-10",
  type: "Debt",
  fromWallet: "",
  toWallet: "Maya",
  category: "",
  item: "Maya Credit",
  description: "",
  amount: 295000,
  fee: 0,
  total: 295000,
  notes: "",
  status: "Done",
  debtId: "maya-credit",
  debtEffect: "draw",
  ...over,
});

const debtDraft = (over: Partial<Draft>): Draft => ({ ...emptyDraft(TODAY), flow: "Debt", ...over });
const wallets = [...REFERENCE.wallets, ...REFERENCE.savings];

describe("filling a debt card from the owner's own debts", () => {
  it("files 'my credit' against the only credit line, with what is due on it", () => {
    const fill = fillDebt(withDebtEffect(debtDraft({}), "repay"), "I paid my credit", [credit, juan], [row({})], wallets, TODAY);
    expect(fill.draft.debtId).toBe("maya-credit");
    expect(fill.draft.amount).toBe(295000);
    expect(fill.notes.join(" ")).toContain("what is due");
  });

  it("leaves the line for the owner when two could be meant", () => {
    const other: Debt = { ...credit, id: "gloan", name: "GLoan" };
    const fill = fillDebt(withDebtEffect(debtDraft({}), "repay"), "I paid my credit", [credit, other], [], wallets, TODAY);
    expect(fill.draft.debtId).toBeUndefined();
    expect(fill.draft.amount).toBeNull();
  });

  it("never replaces a figure the sentence gave", () => {
    const fill = fillDebt(withDebtEffect(debtDraft({ amount: 100000 }), "repay"), "I paid 1000 on my credit", [credit], [row({})], wallets, TODAY);
    expect(fill.draft.amount).toBe(100000);
  });

  it("finds a person already on the list", () => {
    const fill = fillDebt(withDebtEffect(debtDraft({ amount: 20000, toWallet: "Cash" }), "collect"), "Juan paid me back 200 in cash", [credit, juan], [], wallets, TODAY);
    expect(fill.draft.debtId).toBe("juan");
    expect(fill.newPerson).toBeUndefined();
  });

  it("offers to add a person who is not on the list, and adds them the right way round", () => {
    const d = withDebtEffect(debtDraft({ amount: 50000, fromWallet: "Gcash" }), "lend");
    const fill = fillDebt(d, "I lent 500 to Pedro from gcash", [credit], [], wallets, TODAY);
    expect(fill.draft.debtId).toBeUndefined();
    expect(fill.newPerson).toBe("Pedro");
    const person = personDebt("Pedro", d, [credit], "Cash");
    expect(person).toMatchObject({ id: "pedro", kind: "receivable", form: "informal", counterpartyType: "person" });

    const borrowed = withDebtEffect(debtDraft({ amount: 100000, toWallet: "Cash" }), "draw");
    expect(personDebt("Kuya", borrowed, [], "Cash").kind).toBe("payable");
  });

  it("reads names from where they sit, and not wallets or filler", () => {
    expect(personIn("I lent 500 to Juan from gcash", wallets)).toBe("Juan");
    expect(personIn("Juan paid me back 200 in cash", wallets)).toBe("Juan");
    expect(personIn("I borrowed 1000 from kuya in cash", wallets)).toBe("Kuya");
    expect(personIn("I paid 500 from maya", wallets)).toBeNull();
    expect(personIn("i paid my freind Carlo food 180 cash and he will pay me back", wallets)).toBe("Carlo");
  });
});
