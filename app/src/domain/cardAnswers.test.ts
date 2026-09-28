import { describe, expect, it } from "vitest";

import { applyReply, POINTS_ELSEWHERE } from "./capture";
import { looksLikeAnswer } from "./cardQuestions";
import { emptyDraft, type Draft } from "./entry";
import type { ReferenceLists } from "./types";

/**
 * Replies to a card's own question, as the owner typed them on 28 September
 * 2026 while a receipt's card asked "What was it for?".
 */

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Random"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Home Needs", remark: "Groceries, home items, small tools" },
  ],
};

const card: Draft = {
  ...emptyDraft("2026-09-28"),
  flow: "Spending",
  category: "Spending",
  fromWallet: "Cash",
  amount: 10900,
  description: "Reed diffuser, oud wood and santal",
};

describe("a reply goes to the card that asked", () => {
  it("every reply the owner gave is taken as an answer, not a new message", () => {
    for (const reply of [
      "Cash, i purchase it for my room",
      "Read it",
      "Look at the product name, i purchase it for my room",
      "Reed defuser wood and santal",
      "cash",
    ]) {
      expect(looksLikeAnswer(reply, "item"), reply).toBe(true);
    }
  });

  it("a question is still a question", () => {
    expect(looksLikeAnswer("how much is in my cash?", "item")).toBe(false);
    expect(looksLikeAnswer("show me a chart of this month", "item")).toBe(false);
  });
});

describe("a reply that points is never an item's name", () => {
  it("knows pointing when it sees it", () => {
    for (const reply of ["Read it", "read the receipt", "Look at the product name, i purchase it for my room", "you know it", "idk", "check the picture"]) {
      expect(POINTS_ELSEWHERE.test(reply), reply).toBe(true);
    }
    for (const reply of ["Home Needs", "air freshener", "for my room", "food"]) {
      expect(POINTS_ELSEWHERE.test(reply), reply).toBe(false);
    }
  });

  it("'Read it' leaves the item open instead of naming a new type 'Read it'", () => {
    const next = applyReply(card, "item", "Read it", reference);
    expect(next?.item).toBe("");
  });

  it("a wallet and a purpose in one reply fill the wallet and keep the purpose", () => {
    const blank = { ...card, fromWallet: "", description: "" };
    const next = applyReply(blank, "item", "Cash, i purchase it for my room", reference);
    expect(next?.fromWallet).toBe("Cash");
    expect(next?.description).toContain("for my room");
    expect(next?.item).toBe("");
  });

  it("an item's own name still answers it", () => {
    expect(applyReply(card, "item", "home needs", reference)?.item).toBe("Home Needs");
  });
});

describe("asking for the last picture again", () => {
  it("hears the owner's own words", async () => {
    const { asksToReadAgain } = await import("./capture");
    for (const said of ["Read it", "Read the receipt", "Fucking look at the receipt", "Look at the product name, i purchase it for my room", "Again", "read it again"]) {
      expect(asksToReadAgain(said), said).toBe(true);
    }
    for (const said of ["how much did I spend on food?", "I purchased a scented air freshener today 109 cash", "show me trend this year"]) {
      expect(asksToReadAgain(said), said).toBe(false);
    }
  });
});
