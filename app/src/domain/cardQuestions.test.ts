import { describe, expect, it } from "vitest";

import { alikeKey, answerCard, cardAnswerNote, cardQuestion, confirmsIncome, keepTheMoney, looksLikeAnswer, rowWords, SKIP_CARD, STOP_ASKING, whatChanged } from "./cardQuestions";
import { checkDraft, emptyDraft, type Draft } from "./entry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance", "Random"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "School", remark: "Tuition, school supplies" },
  ],
};

/** Rows as a Maya history reads them: invented, in the shape of the owner's list. */
const paid: Draft = {
  ...emptyDraft("2026-09-20"),
  flow: "Spending",
  category: "Spending",
  status: "Paid",
  fromWallet: "Maya",
  description: "TANQUI SFLU",
  amount: 101800,
};
const received: Draft = {
  ...emptyDraft("2026-09-15"),
  flow: "Revenue",
  category: "Revenue",
  status: "Received",
  toWallet: "Maya",
  description: "Received money from J. Cruz",
  amount: 72345,
};

describe("the question about one card", () => {
  it("names the row, so it is plain which one", () => {
    expect(rowWords(paid)).toBe("₱1,018.00 out, TANQUI SFLU, 20 Sep");
    const q = cardQuestion(paid, reference, 2, 5);
    expect(q?.blank).toBe("item");
    expect(q?.count).toBe("2 of 5");
    expect(q?.text).toBe("₱1,018.00 out, TANQUI SFLU, 20 Sep. What was it for?");
    expect(q?.choices).toEqual(expect.arrayContaining(["Food", "School", "Sent to someone"]));
  });

  it("offers income kinds, and 'my own', for money in", () => {
    const q = cardQuestion(received, reference, 1, 1);
    expect(q?.text).toContain("₱723.45 in, Received money from J. Cruz, 15 Sep.");
    expect(q?.count).toBe("");
    expect(q?.choices).toEqual(expect.arrayContaining(["Allowance", "Random", "From my own account"]));
  });

  /*
   * Every button is an answer the card takes, typed or tapped (27 September
   * 2026: the answers were a sentence of account names and "what to answer?").
   */
  it("takes each of its own buttons as the answer", () => {
    const spent = cardQuestion(paid, reference, 1, 1)!;
    for (const choice of spent.choices) {
      expect(looksLikeAnswer(choice, spent.blank), choice).toBe(true);
      expect(answerCard(paid, spent.blank, choice, reference), choice).not.toBeNull();
    }
    const out: Draft = { ...emptyDraft("2026-09-27"), flow: "Transfer", fromWallet: "Gcash", amount: 500000, fee: 1000, description: "to PNB (business)" };
    const where = cardQuestion(out, reference, 1, 1)!;
    expect(where.text).toBe("₱5,000.00 out, to PNB (business), 27 Sep. Where did it go?");
    expect(where.choices[0]).toBe("Someone else");
    expect(where.choices).not.toContain("Gcash");
    const gone = answerCard(out, "toWallet", "Someone else", reference);
    expect(gone).toMatchObject({ flow: "Transfer", sentOut: true, toWallet: "" });
    expect(answerCard(out, "toWallet", "Maya", reference)?.toWallet).toBe("Maya");
  });

  it("asks nothing about a card that is complete", () => {
    expect(cardQuestion({ ...paid, item: "School" }, reference, 1, 1)).toBeNull();
  });
});

describe("an answer into its card", () => {
  it("takes a kind of spending", () => {
    const done = answerCard(paid, "item", "school", reference);
    expect(done?.item).toBe("School");
    expect(done?.flow).toBe("Spending");
  });

  it("turns money sent to a person into money that left the accounts", () => {
    const done = answerCard(paid, "item", "I sent it to my friend", reference);
    expect(done).toMatchObject({ flow: "Transfer", toWallet: "", sentOut: true, fromWallet: "Maya", item: "" });
    expect(checkDraft(done!, [], reference, [], "2026-09-27").errors).toEqual([]);
  });

  it("turns money sent to their own wallet into a transfer between their accounts", () => {
    const done = answerCard(paid, "item", "sent to my gcash", reference);
    expect(done).toMatchObject({ flow: "Transfer", toWallet: "Gcash", sentOut: false });
  });

  it("does not take a treat for a friend as money sent", () => {
    const done = answerCard(paid, "item", "food for my friend", reference);
    expect(done?.flow).toBe("Spending");
    expect(done?.item).toBe("Food");
  });

  it("turns money in from their own account into a transfer, not income", () => {
    const own = answerCard(received, "item", "from my gcash", reference);
    expect(own).toMatchObject({ flow: "Transfer", fromWallet: "Gcash", toWallet: "Maya" });
    const mine = answerCard(received, "item", "that is my own", reference);
    expect(mine).toMatchObject({ flow: "Transfer", fromWallet: "", toWallet: "Maya" });
  });

  it("keeps income as income when the wallet named is where it landed", () => {
    const done = answerCard(received, "item", "allowance into maya", reference);
    expect(done).toMatchObject({ flow: "Revenue", item: "Allowance", toWallet: "Maya" });
  });

  it("knows skip and stop", () => {
    expect(SKIP_CARD.test("skip")).toBe(true);
    expect(SKIP_CARD.test("next one")).toBe(true);
    expect(STOP_ASKING.test("stop asking")).toBe(true);
    expect(SKIP_CARD.test("school")).toBe(false);
  });
});

describe("what counts as the answer", () => {
  it("takes a word or a short phrase", () => {
    expect(looksLikeAnswer("school", "item")).toBe(true);
    expect(looksLikeAnswer("I sent it to my friend", "item")).toBe(true);
    expect(looksLikeAnswer("skip", "item")).toBe(true);
  });

  it("leaves a question, an instruction or a new entry alone", () => {
    expect(looksLikeAnswer("how much did I spend this week", "item")).toBe(false);
    expect(looksLikeAnswer("is this right?", "item")).toBe(false);
    expect(looksLikeAnswer("delete the last one", "item")).toBe(false);
    expect(looksLikeAnswer("I paid 300 for food cash", "item")).toBe(false);
  });

  it("never takes a note to the developer as an answer (27 September 2026)", () => {
    expect(looksLikeAnswer("//fix this", "item")).toBe(false);
    expect(looksLikeAnswer("// the question are off", "item")).toBe(false);
  });

  it("takes a figure when the question was how much", () => {
    expect(looksLikeAnswer("about 500", "amount")).toBe(true);
  });
});

describe("rows one answer covers", () => {
  it("groups the same kind with the same words, whatever the amount or day", () => {
    expect(alikeKey({ ...paid, amount: 5000, date: "2026-09-18" })).toBe(alikeKey(paid));
    expect(alikeKey({ ...paid, description: "JOLLIBEE" })).not.toBe(alikeKey(paid));
    expect(alikeKey({ ...paid, description: "" })).toBe("");
  });
});

describe("the line that says what changed", () => {
  it("says a transfer is neither spending nor income", () => {
    const after = answerCard(paid, "item", "sent to my gcash", reference)!;
    expect(whatChanged(paid, after)).toContain("transfer from Maya to Gcash");
  });
  it("names the kind booked", () => {
    const after = answerCard(paid, "item", "school", reference)!;
    expect(whatChanged(paid, after)).toBe("Booked as School.");
  });
});

describe("a row that became a transfer in", () => {
  it("still reads as money in while it waits for the account it came from", () => {
    const mine = answerCard(received, "item", "that is my own", reference)!;
    expect(rowWords(mine)).toBe("₱723.45 in, Received money from J. Cruz, 15 Sep");
    expect(cardQuestion(mine, reference, 1, 1)?.blank).toBe("fromWallet");
    const from = answerCard(mine, "fromWallet", "gcash", reference);
    expect(from).toMatchObject({ flow: "Transfer", fromWallet: "Gcash", toWallet: "Maya" });
  });
});

describe("money in that was borrowed (27 September 2026)", () => {
  // The owner's two Maya Credit borrowings, read off the Maya history as income with a name that did not read.
  const misread: Draft = { ...received, date: "2026-09-20", item: "Allowance", description: "Received money from \\viavag creqiy", amount: 200000 };
  const lines = [{ id: "maya-credit", name: "Maya Credit", wallet: "Maya" }];

  it("is asked about even with its kind filled in, and offers the borrowing", () => {
    expect(confirmsIncome(misread)).toBe(true);
    expect(cardQuestion(misread, reference, 1, 2)).toBeNull();
    const q = cardQuestion(misread, reference, 1, 2, { lines: ["Maya Credit"] });
    expect(q?.text).toContain("Filed as Allowance for now");
    expect(q?.choices).toContain("Borrowed on Maya Credit");
    expect(answerCard(misread, "item", "Borrowed on Maya Credit", reference, [], [{ id: "maya-credit", name: "Maya Credit", wallet: "Maya" }])).toMatchObject({
      flow: "Debt",
      debtEffect: "draw",
    });
  });

  it("small cash backs are not asked about", () => {
    expect(confirmsIncome({ ...misread, amount: 425 })).toBe(false);
  });

  it("becomes a draw on the line, into the wallet it landed in", () => {
    for (const reply of ["borrowed on maya credit", "maya credit", "utang yan"]) {
      const done = answerCard(misread, "item", reply, reference, [], lines);
      expect(done, reply).toMatchObject({ flow: "Debt", debtEffect: "draw", debtId: "maya-credit", item: "Maya Credit", toWallet: "Maya", fromWallet: "", status: "Received" });
    }
    expect(whatChanged(misread, answerCard(misread, "item", "maya credit", reference, [], lines)!)).toContain("borrowing on Maya Credit into Maya");
  });

  it("stays income when it was", () => {
    expect(answerCard(misread, "item", "allowance", reference, [], lines)).toMatchObject({ flow: "Revenue", item: "Allowance" });
  });
});

describe("an answer, read by the model and held to its row", () => {
  it("tells the model the row, the question and the answer", () => {
    const note = cardAnswerNote(received, '(2 of 7) ₱723.45 in, Received money from J. Cruz, 15 Sep. What was it? Allowance, or say "my own". Say skip to leave one for its card, or stop.', "I credit it");
    expect(note).toContain("₱723.45 in, Received money from J. Cruz, 15 Sep, read as Revenue.");
    expect(note).toContain("It came into Maya.");
    expect(note).toContain('The owner answered: "I credit it"');
    expect(note).not.toContain("Say skip");
  });

  it("never lets an answer move the amount or the day", () => {
    const model: Draft = { ...received, flow: "Debt", debtEffect: "draw", item: "Maya Credit", amount: 999, date: "2026-09-27", toWallet: "" };
    expect(keepTheMoney(received, model)).toMatchObject({ amount: 72345, date: "2026-09-15", toWallet: "Maya", flow: "Debt" });
  });

  it("keeps the wallet a payment left, and books a transfer to nobody as money sent out", () => {
    const model: Draft = { ...paid, flow: "Transfer", category: "Transfer", fromWallet: "", toWallet: "" };
    expect(keepTheMoney(paid, model)).toMatchObject({ fromWallet: "Maya", toWallet: "", sentOut: true });
  });

  it("does not make a transfer from Maya into Maya", () => {
    const model: Draft = { ...received, flow: "Transfer", category: "Transfer", fromWallet: "Maya", toWallet: "Maya" };
    expect(keepTheMoney(received, model)).toMatchObject({ fromWallet: "", toWallet: "Maya" });
  });
});
