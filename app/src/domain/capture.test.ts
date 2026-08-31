import { describe, expect, it } from "vitest";

import { amend, applyReply, blanksIn, matchItem, nextQuestion } from "./capture";
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

describe("amend: correcting a card already on screen", () => {
  const card = spend({ amount: 34000, fromWallet: "Cash", item: "Food", date: "2022-10-07" });
  const ASOF = "2026-08-31";

  it("changes the amount", () => {
    const change = amend(card, "make it 300", reference, ASOF);
    expect(change?.draft.amount).toBe(30000);
  });

  it("changes the wallet", () => {
    expect(amend(card, "gcash", reference, ASOF)?.draft.fromWallet).toBe("Gcash");
  });

  it("changes the item, using the list's own spelling", () => {
    // The reference calls it "Food"; the reply says "food".
    const withItem = { ...card, item: "" };
    expect(amend(withItem, "food", reference, ASOF)?.draft.item).toBe("Food");
  });

  /**
   * A receipt read as 2022 when it was 2026. The model answered "I cannot
   * change entries here", and a four digit year would otherwise have been
   * read as an amount of PHP 2,026.00.
   */
  it("changes the year without reading it as an amount", () => {
    const change = amend(card, "2026 change the date", reference, ASOF);
    expect(change?.draft.date).toBe("2026-10-07");
    expect(change?.draft.amount).toBe(34000);
  });

  it("takes a whole date, written either way", () => {
    expect(amend(card, "2026-08-12", reference, ASOF)?.draft.date).toBe("2026-08-12");
    expect(amend(card, "8/12/2026", reference, ASOF)?.draft.date).toBe("2026-08-12");
  });

  it("takes a relative day", () => {
    expect(amend(card, "yesterday", reference, ASOF)?.draft.date).toBe("2026-08-30");
    expect(amend(card, "today", reference, ASOF)?.draft.date).toBe(ASOF);
  });

  it("does not treat a bare year as a date without being told it is one", () => {
    // Ambiguous with an amount, so this reads as PHP 2,026.00.
    expect(amend(card, "2026", reference, ASOF)?.draft.date).toBe("2022-10-07");
  });

  it("returns nothing for a message that corrects nothing", () => {
    expect(amend(card, "thanks", reference, ASOF)).toBeNull();
    expect(amend(card, "", reference, ASOF)).toBeNull();
  });

  it("ignores a message too long to be a correction", () => {
    expect(amend(card, "x".repeat(80) + " gcash", reference, ASOF)).toBeNull();
  });
});

describe("matchItem: sticking to the lists you already keep", () => {
  const withRemarks: ReferenceLists = {
    ...reference,
    spendingTypes: [
      { name: "Fun", remark: "Outings, parties, leisure" },
      { name: "Food", remark: "Meals, snacks, drinks" },
      { name: "Gas", remark: "Fuel for vehicle" },
    ],
  };

  /**
   * The reply that created a new spending type by typo. The ledger has Fun,
   * whose note reads "Outings, parties, leisure".
   */
  it('reads "outing fun" as Fun rather than inventing an item', () => {
    const found = matchItem("outing fun", "Spending", "Spending", withRemarks);
    expect(found).toEqual({ item: "Fun", matched: true });
  });

  it("matches on the note beside the type, which says what counts as it", () => {
    expect(matchItem("parties", "Spending", "Spending", withRemarks).item).toBe("Fun");
    expect(matchItem("snacks", "Spending", "Spending", withRemarks).item).toBe("Food");
    expect(matchItem("fuel", "Spending", "Spending", withRemarks).item).toBe("Gas");
  });

  it("matches the name however it was capitalised", () => {
    expect(matchItem("food", "Spending", "Spending", withRemarks).item).toBe("Food");
    expect(matchItem("  GAS  ", "Spending", "Spending", withRemarks).item).toBe("Gas");
  });

  it("does not match a name buried in a longer word", () => {
    // "funeral" contains "fun" but is not it.
    const found = matchItem("funeral", "Spending", "Spending", withRemarks);
    expect(found.matched).toBe(false);
    expect(found.item).toBe("funeral");
  });

  it("keeps a genuinely new item, and says it is new", () => {
    const found = matchItem("Scuba lessons", "Spending", "Spending", withRemarks);
    expect(found).toEqual({ item: "Scuba lessons", matched: false });
  });

  it("uses the bills list when the category is Bills", () => {
    expect(matchItem("electricity", "Spending", "Bills", withRemarks).item).toBe("Electricity");
  });

  it("caps a long reply so it fits the column", () => {
    expect(matchItem("z".repeat(200), "Spending", "Spending", withRemarks).item.length).toBe(80);
  });
});
