/**
 * Money sent to a person, which is not a wallet.
 *
 * "I sent 130 via instapay from maya" is money leaving the accounts, which
 * this ledger books as a Money Send: the whole amount counts as spending
 * rather than only the fee. The conversation offered the owner's eight
 * accounts and nothing else, so the true answer was not among the options,
 * and the same question came back however it was answered. The owner wrote:
 * "I dont have an option to have a transaction to send to my self or send to
 * others".
 */

import { describe, expect, it } from "vitest";

import { applyReply, blanksIn, nextQuestion } from "./capture";
import { checkDraft, emptyDraft, type Draft } from "./entry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Gcash", "Maya", "Cash"],
  savings: ["Maya Bank (Personal savings)"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

const accounts = [...reference.wallets, ...reference.savings];

const transfer = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft("2026-09-05"),
  flow: "Transfer",
  fromWallet: "Maya",
  amount: 13000,
  status: "Transferred",
  ...over,
});

describe("the question offers the answer", () => {
  it("says so, rather than listing only accounts", () => {
    const asked = nextQuestion(transfer(), reference);
    expect(asked?.blank).toBe("toWallet");
    expect(asked?.question).toContain("someone else");
  });
});

describe("the answer is accepted", () => {
  it("reads 'someone else' as leaving the accounts", () => {
    const done = applyReply(transfer(), "toWallet", "someone else", reference);
    expect(done?.sentOut).toBe(true);
    expect(done?.toWallet).toBe("");
  });

  it("reads the ordinary ways a person says it", () => {
    for (const said of ["my mom", "a friend", "nobody", "it left my accounts", "somebody else"]) {
      expect(applyReply(transfer(), "toWallet", said, reference)?.sentOut).toBe(true);
    }
  });

  it("still reads a real wallet as a real wallet", () => {
    const done = applyReply(transfer(), "toWallet", "gcash", reference);
    expect(done?.toWallet).toBe("Gcash");
    expect(done?.sentOut).toBe(false);
  });

  it("refuses an answer that is neither", () => {
    expect(applyReply(transfer(), "toWallet", "the blue one", reference)).toBeNull();
  });
});

describe("and the question stops being asked", () => {
  /**
   * The loop. The answer was accepted and set the flag, then nothing read the
   * flag, so the same question came back. The owner could answer correctly
   * forever.
   */
  it("does not ask again once it has been answered", () => {
    const done = applyReply(transfer(), "toWallet", "someone else", reference)!;
    expect(blanksIn(done, accounts)).not.toContain("toWallet");
    expect(nextQuestion(done, reference)).toBeNull();
  });

  it("lets the row save, which is the whole point", () => {
    const done = applyReply(transfer(), "toWallet", "someone else", reference)!;
    expect(checkDraft(done, [], reference, []).ok).toBe(true);
  });

  it("still asks when the destination is genuinely missing", () => {
    expect(blanksIn(transfer(), accounts)).toContain("toWallet");
  });

  /**
   * Choosing an account after saying "someone else" has to clear the flag, or
   * the row would claim both that it went to Gcash and that it left the
   * accounts, and the spending total would count it twice over.
   */
  it("clears the flag when a wallet is chosen after all", () => {
    const away = applyReply(transfer(), "toWallet", "someone else", reference)!;
    const back = applyReply(away, "toWallet", "Gcash", reference)!;
    expect(back.sentOut).toBe(false);
    expect(back.toWallet).toBe("Gcash");
  });
});
