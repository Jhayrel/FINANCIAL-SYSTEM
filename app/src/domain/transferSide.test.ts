/**
 * Whose pocket the money landed in.
 *
 * ── Why this file exists on its own ───────────────────────────────────────
 *
 * CLAUDE.md's transfer rule turns on one field. A named destination means
 * the money is still yours and only the fee counts as spending. A blank one
 * means it left your accounts and the whole amount does. So reading the
 * destination wrong does not misfile a row into the wrong column, it
 * misstates what you spent, by the size of the transfer.
 *
 * PHP 13,000.00 into "Hidden cash (fieldtrip)" is the example CLAUDE.md
 * gives: read as given away, it is PHP 13,000.00 of spending that never
 * happened. The same mistake in the other direction hides real spending.
 *
 * Every case below is a sentence shape, not a phrasing. The point is the
 * rule, and the rule is that the words after "to" decide, and nothing else
 * in the sentence has an opinion about it.
 */

import { describe, expect, it } from "vitest";

import { readEntry } from "./readEntry";
import { checkDraft } from "./entry";
import { costOf } from "./totals";
import { draftToTransactions } from "./entry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)", "Reserved Fund"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "Meals, snacks, drinks" }],
};

const ASOF = "2026-08-29";
const ledger: Transaction[] = [];

const read = (text: string) => readEntry(text, ledger, reference, ASOF);

/** What the ledger would actually book, which is the thing that matters. */
const spending = (text: string): number => {
  const { draft } = read(text);
  return draftToTransactions(draft, 1, "x").reduce((sum, t) => sum + costOf(t), 0);
};

describe("somebody else's account is not yours, even when it has a name you know", () => {
  /**
   * The mistake this file was written for.
   *
   * "to my mom's gcash" names Gcash exactly the way "to gcash" does. The
   * reader took the name and booked the row as a move between your own
   * pockets, so PHP 500 given away counted as PHP 0 of spending and Gcash
   * gained 500 it never received.
   */
  it("reads a relative's wallet as money leaving", () => {
    const { draft } = read("I sent 500 to my mom's gcash");
    expect(draft.flow).toBe("Transfer");
    expect(draft.toWallet).toBe("");
    expect(draft.sentOut).toBe(true);
  });

  it("counts the whole amount as spending, not nothing", () => {
    expect(spending("I sent 500 to my mom's gcash")).toBe(50000);
  });

  it("reads a pronoun the same way", () => {
    for (const text of [
      "sent 300 to her gcash",
      "transferred 300 to his maya",
      "moved 300 to their cash",
    ]) {
      expect(read(text).draft.toWallet, text).toBe("");
      expect(read(text).draft.sentOut, text).toBe(true);
    }
  });

  /** A name with an apostrophe is somebody, whoever they are. */
  it("reads any possessive that is not yours as somebody else", () => {
    const { draft } = read("transferred 1000 to Jhayrel's maya");
    expect(draft.toWallet).toBe("");
    expect(draft.sentOut).toBe(true);
  });

  it("still saves, rather than asking for a wallet that does not exist", () => {
    const { draft } = read("I sent money to my friend gotyme 1000 using my gcash");
    expect(draft.fromWallet).toBe("Gcash");
    expect(checkDraft(draft, ledger, reference, []).ok).toBe(true);
  });

  /**
   * Gcash to Gcash, which used to be refused outright.
   *
   * Source and destination came back the same, `checkDraft` said a transfer
   * needs two different wallets, and there was no way to answer it: the
   * second Gcash was somebody else's.
   */
  it("handles your wallet to their wallet of the same name", () => {
    const { draft } = read("I sent 500 from my gcash to my friend's gcash");
    expect(draft.fromWallet).toBe("Gcash");
    expect(draft.toWallet).toBe("");
    expect(checkDraft(draft, ledger, reference, []).ok).toBe(true);
  });
});

describe("your own account stays yours", () => {
  it("reads a plain wallet name as your own", () => {
    const { draft } = read("moved 1000 from cash to gcash");
    expect(draft.toWallet).toBe("Gcash");
    expect(draft.sentOut).toBeFalsy();
  });

  it("counts a move between your own pockets as its fee only", () => {
    expect(spending("moved 1000 from cash to gcash")).toBe(0);
    expect(spending("moved 1000 from cash to gcash, fee 15")).toBe(1500);
  });

  /**
   * "my" is not "my mom's".
   *
   * A first-person possessive says the destination is yours even when the
   * name is one this app does not hold. "to my savings" is not a wallet in
   * the list, and treating an unmatched name as money given away booked
   * PHP 2,000 of saving as PHP 2,000 of spending.
   */
  it("does not give away money sent to a pocket it cannot name", () => {
    const { draft } = read("I moved 2000 to my savings");
    expect(draft.sentOut).toBeFalsy();
  });

  it("asks which wallet instead of guessing", () => {
    const { settled } = read("I moved 2000 to my savings");
    expect(settled).not.toContain("toWallet");
  });

  /** The word "store" in a sentence says nothing about where the money went. */
  it("ignores people words outside the destination clause", () => {
    const { draft } = read("I moved 500 from cash to gcash for the store");
    expect(draft.toWallet).toBe("Gcash");
    expect(draft.sentOut).toBeFalsy();
  });
});

describe("a reason is not a recipient", () => {
  /**
   * "I withdrew 5000 to buy food" is a withdrawal with an explanation.
   *
   * Read as a recipient, the whole 5,000 counted as spent on the day it came
   * out of the bank, and the cash in your hand disappeared from the ledger.
   */
  it("does not treat an infinitive as a destination", () => {
    for (const text of [
      "I withdrew 5000 to buy food",
      "cashed out 2000 to pay the rent",
      "moved 1000 to cover the bills",
    ]) {
      expect(read(text).draft.sentOut, text).toBeFalsy();
    }
  });

  it("asks where it landed rather than assuming it is gone", () => {
    expect(read("I withdrew 5000 to buy food").settled).not.toContain("toWallet");
  });

  it("still reads the wallet the money came out of", () => {
    expect(read("I withdrew 5000 from maya to buy food").draft.fromWallet).toBe("Maya");
  });
});

describe("giving money away is a transfer, not a purchase", () => {
  /** "gave" named no flow at all, so the sentence was answered, not entered. */
  it("reads giving as a transfer out", () => {
    const { draft } = read("I gave 500 to my friend");
    expect(draft.flow).toBe("Transfer");
    expect(draft.sentOut).toBe(true);
    expect(draft.amount).toBe(50000);
  });

  it("reads padala the same way", () => {
    expect(read("padala 1000 to my mother").draft.flow).toBe("Transfer");
  });

  /** Income still wins: "gave me" is money coming in, whatever else it says. */
  it("does not turn money given to you into money you gave", () => {
    expect(read("my mom gave me 500 in gcash").draft.flow).toBe("Revenue");
  });
});

describe("the fee still reads correctly on both sides", () => {
  it("keeps the fee separate when the money left", () => {
    const { draft } = read("sent 1000 to my friend's gcash, fee 15");
    expect(draft.amount).toBe(100000);
    expect(draft.fee).toBe(1500);
  });

  /** Left your accounts: amount plus fee. Still yours: the fee alone. */
  it("counts amount plus fee when it left, and the fee alone when it did not", () => {
    expect(spending("sent 1000 to my friend's gcash, fee 15")).toBe(101500);
    expect(spending("sent 1000 from cash to gcash, fee 15")).toBe(1500);
  });
});
