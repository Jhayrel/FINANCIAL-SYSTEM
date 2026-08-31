import { describe, expect, it } from "vitest";

import { readProposals } from "./proposal";
import { redact, hasSecret, REDACTED } from "./aiRedact";
import { checkDraft } from "./entry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: ["Electricity", "Water"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance", "Salary"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Transport", remark: "" }],
};

const ASOF = "2026-08-31";

const one = (over: Record<string, unknown>) =>
  readProposals(
    { proposals: [{ flow: "Spending", date: ASOF, fromWallet: "Cash", item: "Food", amountPesos: 100, ...over }] },
    reference,
    ASOF,
  );

describe("readProposals: the worked example", () => {
  it('turns "100 cash on food" into the fields in the guide', () => {
    const { proposals } = one({ description: "to buy food", status: "Paid", confidence: "high" });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.draft).toMatchObject({
      flow: "Spending",
      date: "2026-08-31",
      fromWallet: "Cash",
      category: "Spending",
      item: "Food",
      description: "to buy food",
      fee: 0,
      status: "Paid",
    });
  });

  it("carries the amount as integer centavos, never a float", () => {
    const { proposals } = one({ amountPesos: 100 });
    expect(proposals[0]?.draft.amount).toBe(10000);
    expect(Number.isInteger(proposals[0]?.draft.amount)).toBe(true);
  });

  it("reads an amount the model sent as a formatted string", () => {
    const { proposals } = one({ amountPesos: "PHP 1,234.56" });
    expect(proposals[0]?.draft.amount).toBe(123456);
  });

  it("produces a draft that passes the same check as a typed one", () => {
    const { proposals } = one({});
    const draft = proposals[0]?.draft;
    expect(draft).toBeDefined();
    if (draft) expect(checkDraft(draft, [], reference, []).ok).toBe(true);
  });
});

describe("readProposals never invents", () => {
  it("blanks a wallet that is not the owner's, rather than guessing the nearest", () => {
    const { proposals } = one({ fromWallet: "BPI Savings" });
    expect(proposals[0]?.draft.fromWallet).toBe("");
    expect(proposals[0]?.adjustments.join(" ")).toContain("not one of your accounts");
  });

  it("does not let a longer name match a shorter account", () => {
    const { proposals } = one({ fromWallet: "Cash Card" });
    expect(proposals[0]?.draft.fromWallet).toBe("");
  });

  it("matches an account typed in the wrong case", () => {
    const { proposals } = one({ fromWallet: "cash" });
    expect(proposals[0]?.draft.fromWallet).toBe("Cash");
  });

  it("leaves a blank wallet blank without complaining about it", () => {
    const { proposals } = one({ fromWallet: "" });
    expect(proposals[0]?.draft.fromWallet).toBe("");
    expect(proposals[0]?.adjustments).toHaveLength(0);
  });

  it("keeps an item that is new, and says it is new", () => {
    const { proposals } = one({ item: "Haircut" });
    expect(proposals[0]?.draft.item).toBe("Haircut");
    expect(proposals[0]?.adjustments.join(" ")).toContain("not on your list yet");
  });

  it("falls back to today when the date is unreadable, and says so", () => {
    const { proposals } = one({ date: "last Tuesday" });
    expect(proposals[0]?.draft.date).toBe(ASOF);
    expect(proposals[0]?.adjustments.join(" ")).toContain("set to today");
  });
});

describe("readProposals refuses rather than guesses", () => {
  it("refuses a debt row, because the credit line and effect cannot be read off a receipt", () => {
    const { proposals, refused } = readProposals(
      { proposals: [{ flow: "Debt", amountPesos: 500 }] },
      reference,
      ASOF,
    );
    expect(proposals).toHaveLength(0);
    expect(refused[0]?.reason).toContain("debt");
  });

  it("refuses a row with no readable amount", () => {
    const { proposals, refused } = one({ amountPesos: "unclear" });
    expect(proposals).toHaveLength(0);
    expect(refused[0]?.reason).toContain("amount");
  });

  it("refuses a zero and a negative amount", () => {
    expect(one({ amountPesos: 0 }).proposals).toHaveLength(0);
    expect(one({ amountPesos: -50 }).proposals).toHaveLength(0);
  });

  it("refuses a flow it does not recognise", () => {
    const { proposals, refused } = one({ flow: "Investment" });
    expect(proposals).toHaveLength(0);
    expect(refused[0]?.reason).toContain("Investment");
  });
});

describe("readProposals: shape tolerance and bounds", () => {
  it("accepts a bare array, which is what a model often sends instead", () => {
    const { proposals } = readProposals(
      [{ flow: "Spending", fromWallet: "Cash", item: "Food", amountPesos: 10 }],
      reference,
      ASOF,
    );
    expect(proposals).toHaveLength(1);
  });

  it("returns nothing for a reply that is not a list at all", () => {
    expect(readProposals("sorry, I cannot", reference, ASOF).proposals).toHaveLength(0);
    expect(readProposals(null, reference, ASOF).proposals).toHaveLength(0);
    expect(readProposals({ summary: "hello" }, reference, ASOF).proposals).toHaveLength(0);
  });

  it("caps how many rows one reply can produce", () => {
    const many = Array.from({ length: 60 }, () => ({
      flow: "Spending",
      fromWallet: "Cash",
      item: "Food",
      amountPesos: 10,
    }));
    const { proposals } = readProposals({ proposals: many }, reference, ASOF);
    expect(proposals.length).toBeLessThanOrEqual(20);
  });

  it("treats a missing or odd confidence as the weakest, never the strongest", () => {
    expect(one({}).proposals[0]?.confidence).toBe("low");
    expect(one({ confidence: "certain" }).proposals[0]?.confidence).toBe("low");
    expect(one({ confidence: "HIGH" }).proposals[0]?.confidence).toBe("high");
  });
});

describe("readProposals: flow decides the category", () => {
  it("gives Revenue its only category and no source wallet", () => {
    const { proposals } = readProposals(
      { proposals: [{ flow: "Revenue", toWallet: "Maya", item: "Allowance", amountPesos: 500, category: "Spending" }] },
      reference,
      ASOF,
    );
    expect(proposals[0]?.draft.category).toBe("Revenue");
    expect(proposals[0]?.draft.fromWallet).toBe("");
    expect(proposals[0]?.draft.toWallet).toBe("Maya");
  });

  it("keeps Bills and Subscriptions when the flow is Spending", () => {
    expect(one({ category: "Bills", item: "Electricity" }).proposals[0]?.draft.category).toBe("Bills");
    expect(one({ category: "Subscriptions", item: "Spotify" }).proposals[0]?.draft.category).toBe(
      "Subscriptions",
    );
  });

  it("defaults an unknown category to plain Spending", () => {
    expect(one({ category: "Groceries" }).proposals[0]?.draft.category).toBe("Spending");
  });

  it("gives a transfer both ends and the Transfer category", () => {
    const { proposals } = readProposals(
      { proposals: [{ flow: "Transfer", fromWallet: "Cash", toWallet: "Gcash", amountPesos: 200 }] },
      reference,
      ASOF,
    );
    expect(proposals[0]?.draft).toMatchObject({
      category: "Transfer",
      fromWallet: "Cash",
      toWallet: "Gcash",
      status: "Transferred",
    });
  });
});

describe("redact", () => {
  it("replaces each provider key format", () => {
    const cases = [
      "sk-abcdefghijklmnop1234",
      "gsk_abcdefghijklmnop1234",
      "sk-ant-abcdefghijklmnop1234",
    ];
    for (const key of cases) {
      expect(redact(`my key is ${key} ok`)).toBe(`my key is ${REDACTED} ok`);
      expect(hasSecret(key)).toBe(true);
    }
  });

  it("replaces every occurrence, not only the first", () => {
    const text = "sk-aaaaaaaaaaaaaaaaaa and sk-bbbbbbbbbbbbbbbbbb";
    expect(redact(text)).toBe(`${REDACTED} and ${REDACTED}`);
  });

  it("leaves ordinary text and figures alone", () => {
    const text = "I spent PHP 1,234.56 on food at sk-mart";
    expect(redact(text)).toBe(text);
    expect(hasSecret(text)).toBe(false);
  });

  it("is stable when called twice, so state on a global regex cannot skip a match", () => {
    const text = "gsk_abcdefghijklmnop1234";
    expect(redact(text)).toBe(REDACTED);
    expect(redact(text)).toBe(REDACTED);
    expect(hasSecret(text)).toBe(true);
    expect(hasSecret(text)).toBe(true);
  });
});
