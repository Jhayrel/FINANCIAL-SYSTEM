import { describe, expect, it } from "vitest";

import { applyReply, blanksIn, nextQuestion } from "./capture";
import { checkDraft, emptyDraft, type Draft } from "./entry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: ["Electricity"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

const accounts = [...reference.wallets, ...reference.savings];

const spend = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft("2026-08-31"),
  flow: "Spending",
  category: "Spending",
  status: "Paid",
  ...over,
});

describe("blanksIn", () => {
  it("asks about the amount first, because it is the one that blocks saving", () => {
    expect(blanksIn(spend({ fromWallet: "Cash", item: "Food" }), accounts)).toEqual(["amount"]);
  });

  it("lists them in the order they are worth asking about", () => {
    expect(blanksIn(spend(), accounts)).toEqual(["amount", "fromWallet", "item"]);
  });

  it("does not ask a Spending row where the money went", () => {
    expect(blanksIn(spend({ amount: 100, fromWallet: "Cash", item: "Food" }), accounts)).toEqual([]);
  });

  it("asks a Transfer for both ends", () => {
    const draft = { ...emptyDraft("2026-08-31"), flow: "Transfer" as const, amount: 100 };
    expect(blanksIn(draft, accounts)).toEqual(["fromWallet", "toWallet"]);
  });

  it("treats a wallet that is not the owner's as missing", () => {
    expect(blanksIn(spend({ amount: 100, fromWallet: "BPI", item: "Food" }), accounts)).toEqual([
      "fromWallet",
    ]);
  });

  it("never asks about a fee, a description, or a note", () => {
    const blanks = blanksIn(spend(), accounts);
    expect(blanks).not.toContain("fee");
    expect(blanks).not.toContain("description");
  });

  it("has nothing to ask when there is no flow yet", () => {
    expect(blanksIn(emptyDraft("2026-08-31"), accounts)).toEqual([]);
  });
});

describe("nextQuestion", () => {
  it("asks how much, in words a person would use", () => {
    expect(nextQuestion(spend({ fromWallet: "Cash", item: "Food" }), reference)?.question).toBe(
      "How much was it?",
    );
  });

  it("names the wallets in the question, so the answer can be one word", () => {
    const asked = nextQuestion(spend({ amount: 100, item: "Food" }), reference);
    expect(asked?.blank).toBe("fromWallet");
    expect(asked?.question).toContain("Cash, Gcash, Maya");
  });

  it("stops asking once the row is complete", () => {
    expect(nextQuestion(spend({ amount: 100, fromWallet: "Cash", item: "Food" }), reference)).toBeNull();
  });
});

describe("applyReply", () => {
  it('reads "500" as five hundred pesos in centavos', () => {
    expect(applyReply(spend(), "amount", "500", reference)?.amount).toBe(50000);
  });

  it("finds the figure inside a sentence, because that is how people answer", () => {
    expect(applyReply(spend(), "amount", "about 500 I think", reference)?.amount).toBe(50000);
    expect(applyReply(spend(), "amount", "it was 1,234.56", reference)?.amount).toBe(123456);
    expect(applyReply(spend(), "amount", "PHP 250", reference)?.amount).toBe(25000);
  });

  it("refuses a reply with no figure in it, rather than writing a wrong one", () => {
    expect(applyReply(spend(), "amount", "not sure", reference)).toBeNull();
    expect(applyReply(spend(), "amount", "", reference)).toBeNull();
  });

  it("refuses zero and negative, which checkDraft would refuse anyway", () => {
    expect(applyReply(spend(), "amount", "0", reference)).toBeNull();
  });

  it("matches a wallet named on its own or inside a sentence", () => {
    expect(applyReply(spend(), "fromWallet", "cash", reference)?.fromWallet).toBe("Cash");
    expect(applyReply(spend(), "fromWallet", "it came out of Gcash", reference)?.fromWallet).toBe(
      "Gcash",
    );
  });

  it("prefers the longer account name when one contains the other", () => {
    expect(
      applyReply(spend(), "fromWallet", "Maya Bank (Personal savings)", reference)?.fromWallet,
    ).toBe("Maya Bank (Personal savings)");
  });

  it("does not match a wallet name inside a longer word", () => {
    expect(applyReply(spend(), "fromWallet", "the cashier gave it to me", reference)).toBeNull();
  });

  it("refuses a wallet that is not the owner's", () => {
    expect(applyReply(spend(), "fromWallet", "BPI", reference)).toBeNull();
  });

  it("takes an item as written, capped so it fits the column", () => {
    expect(applyReply(spend(), "item", "Load", reference)?.item).toBe("Load");
    expect(applyReply(spend(), "item", "x".repeat(200), reference)?.item.length).toBe(80);
  });
});

describe("the whole loop", () => {
  it('turns "I paid my load today" into a saveable row in two answers', () => {
    // What the model reads off that sentence: a flow, a date, an item, no amount.
    let draft = spend({ item: "Load" });

    expect(checkDraft(draft, [], reference, []).ok).toBe(false);

    const first = nextQuestion(draft, reference);
    expect(first?.question).toBe("How much was it?");
    draft = applyReply(draft, first!.blank, "500", reference)!;

    const second = nextQuestion(draft, reference);
    expect(second?.blank).toBe("fromWallet");
    draft = applyReply(draft, second!.blank, "gcash", reference)!;

    expect(nextQuestion(draft, reference)).toBeNull();
    expect(checkDraft(draft, [], reference, []).ok).toBe(true);
    expect(draft).toMatchObject({
      flow: "Spending",
      item: "Load",
      amount: 50000,
      fromWallet: "Gcash",
    });
  });
});
