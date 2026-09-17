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

/**
 * A credit line's own transaction list, as the owner showed it: each borrowing
 * followed by a service fee and stamp tax at the same minute, a purchase made
 * on credit, and the payment that cleared it all. Figures invented.
 */
describe("a credit line's statement", () => {
  const credit: ReferenceLists = { ...reference, credits: ["Easy Credit"] };
  const rows = [
    { flow: "Debt", debt: "Easy Credit", debtEffect: "borrowed", toWallet: "Maya", date: "2026-08-13", time: "19:40", amountText: "1,050.00", description: "Transferred money to My Wallet" },
    { flow: "Debt", debt: "Easy Credit", debtEffect: "charge", date: "2026-08-13", time: "19:40", amountText: "78.64", description: "Service Fee" },
    { flow: "Debt", debt: "Easy Credit", debtEffect: "charge", date: "2026-08-13", time: "19:40", amountText: "0.65", description: "DST" },
    { flow: "Debt", debt: "Easy Credit", debtEffect: "bought", fromWallet: "Maya", date: "2026-08-14", time: "21:41", amountText: "789.00", item: "Food", description: "Purchased via Easy Credit" },
    { flow: "Debt", debt: "Easy Credit", debtEffect: "paid", fromWallet: "Maya", date: "2026-09-01", amountText: "1,918.29", description: "Paid amount due" },
    { flow: "Balance", fromWallet: "Maya", amountText: "5,795.74", date: "2026-09-01" },
  ];

  it("reads each movement with its line and effect, and folds the fees into their borrowing", () => {
    const { proposals, balances } = readProposals({ proposals: rows }, credit, ASOF);
    const debts = proposals.filter((p) => p.draft.flow === "Debt");
    expect(debts.map((p) => p.draft.debtEffect)).toEqual(["draw", "draw", "repay"]);
    expect(debts[0]?.draft).toMatchObject({ debtId: "easy-credit", toWallet: "Maya", amount: 105000, charges: 7929 });
    expect(debts[2]?.draft).toMatchObject({ fromWallet: "Maya", amount: 191829 });
    expect(balances).toEqual([{ account: "Maya", amount: 579574, date: "2026-09-01", sourceRef: "a screenshot" }]);
  });

  it("reads a purchase on credit as the borrowing and the purchase it paid for", () => {
    const { proposals } = readProposals({ proposals: [rows[3]] }, credit, ASOF);
    expect(proposals.map((p) => p.draft.flow)).toEqual(["Debt", "Spending"]);
    expect(proposals[1]?.draft).toMatchObject({ fromWallet: "Maya", item: "Food", amount: 78900 });
  });

  it("leaves fees apart when it cannot tell which borrowing they belong to", () => {
    const twoDraws = [
      { ...rows[0], time: "" },
      { ...rows[0], time: "", amountText: "500.00" },
      { ...rows[1], time: "" },
    ];
    const { proposals } = readProposals({ proposals: twoDraws }, credit, ASOF);
    expect(proposals.map((p) => p.draft.debtEffect)).toEqual(["draw", "draw", "charge"]);
  });

  it("never turns a balance into a movement", () => {
    const { proposals, balances } = readProposals({ proposals: [rows[5]] }, credit, ASOF);
    expect(proposals).toEqual([]);
    expect(balances).toHaveLength(1);
  });
});

describe("readProposals refuses rather than guesses", () => {
  /**
   * A debt row with nothing said about it still becomes a debt card, where
   * the line and the effect are picked. A debt row with no amount is not a
   * row at all.
   */
  it("sends a debt row to its card with the line and effect left to pick, and refuses one with no amount", () => {
    const { proposals } = readProposals({ proposals: [{ flow: "Debt", amountPesos: 500 }] }, reference, ASOF);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.draft).toMatchObject({ flow: "Debt", amount: 50000 });
    expect(proposals[0]?.draft.debtId).toBeUndefined();
    expect(proposals[0]?.draft.debtEffect).toBeUndefined();

    const { refused } = readProposals({ proposals: [{ flow: "Debt" }] }, reference, ASOF);
    expect(refused[0]?.reason).toContain("debt");
  });

  /**
   * An unreadable amount is a question, not a refusal.
   *
   * "I paid my load today" is a real entry with one detail missing, and
   * throwing it away wastes everything that was read. It comes through with a
   * null amount and `domain/capture.ts` asks for it. `checkDraft` still
   * refuses to save it, which is the part that matters.
   */
  it("lets a row with no readable amount through, for the question to be asked", () => {
    const { proposals, refused } = one({ amountPesos: "unclear" });
    expect(refused).toHaveLength(0);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.draft.amount).toBeNull();
    expect(checkDraft(proposals[0]!.draft, [], reference, []).ok).toBe(false);
  });

  /**
   * Zero is not an answer, it is the model shrugging.
   *
   * This used to refuse both, on the reasoning that a figure is a figure. It
   * cost the owner the case this app is best at: "I paid my spotify from
   * gcash" names no amount, the model returns a zero, and the whole proposal
   * was thrown away, item and wallet and date with it. They asked three times
   * across two sessions, and there are nine Spotify rows at PHP 85.00 sitting
   * in the ledger, one a month, which `inferFromHistory` fills from. It never
   * ran, because the refusal came first.
   *
   * No transaction is worth zero pesos and none is worth a negative one, so
   * neither is ever a reading of a receipt. Both now mean the same as a blank,
   * and `checkDraft` still refuses to save one, which is the part that
   * protects the ledger.
   */
  it("treats zero and negative as no amount read, keeping the rest of the row", () => {
    for (const amountPesos of [0, -50]) {
      const { proposals, refused } = one({ amountPesos });
      expect(refused).toHaveLength(0);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.draft.amount).toBeNull();
      // Everything else the model read survives.
      expect(proposals[0]?.draft.flow).toBe("Spending");
      // And it still cannot be saved until someone supplies one.
      expect(checkDraft(proposals[0]!.draft, [], reference, []).ok).toBe(false);
    }
  });

  it("refuses a flow it does not recognise, without quoting the model at you", () => {
    const { proposals, refused } = one({ flow: "Investment" });
    expect(proposals).toHaveLength(0);
    expect(refused[0]?.reason).toContain("nowhere to put it");
  });

  /**
   * A model that understood nothing copies the shape back, placeholders and
   * all. Quoting this app's own prompt at the owner explains nothing.
   */
  it("does not read back the schema placeholder as a failed field", () => {
    const { refused } = one({ flow: "Spending or Revenue or Transfer" });
    expect(refused[0]?.reason).toBe("Nothing in that looked like a transaction.");
  });
});

describe("readProposals checks the amount against itself", () => {
  it("prefers the printed characters when the two disagree, and says so", () => {
    const { proposals } = one({ amountPesos: 123.456, amountText: "1,234.56" });
    expect(proposals[0]?.draft.amount).toBe(123456);
    expect(proposals[0]?.confidence).toBe("low");
    expect(proposals[0]?.adjustments.join(" ")).toContain("Check the picture");
  });

  it("leaves a matching pair alone, and keeps the stated confidence", () => {
    const { proposals } = one({ amountPesos: 100, amountText: "100.00", confidence: "high" });
    expect(proposals[0]?.draft.amount).toBe(10000);
    expect(proposals[0]?.confidence).toBe("high");
    expect(proposals[0]?.adjustments).toHaveLength(0);
  });

  it("falls back to the printed characters when only they are readable", () => {
    const { proposals } = one({ amountPesos: "n/a", amountText: "PHP 75.50" });
    expect(proposals[0]?.draft.amount).toBe(7550);
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

/**
 * A subscription is not a transfer, whatever the model said.
 *
 * "I paid my spotify from gcash" came back as a Transfer carrying Spotify as
 * its item. Everything else on that card followed from the one wrong word:
 * it asked which wallet the money landed in, refused to save without one, and
 * could not fill the amount either, because the fixed-cost lookup only runs
 * for Bills and Subscriptions.
 */
describe("a thing you pay is never a wallet you pay into", () => {
  it("reads a named subscription as spending", () => {
    const { proposals } = one({ flow: "Transfer", item: "Spotify", toWallet: "" });
    expect(proposals[0]?.draft.flow).toBe("Spending");
  });

  it("files it under Subscriptions, which is what fills the amount", () => {
    const { proposals } = one({ flow: "Transfer", item: "Spotify" });
    expect(proposals[0]?.draft.category).toBe("Subscriptions");
  });

  it("files a named bill under Bills", () => {
    const { proposals } = one({ flow: "Transfer", item: "Electricity" });
    expect(proposals[0]?.draft.category).toBe("Bills");
  });

  it("says what it changed rather than changing it quietly", () => {
    const { proposals } = one({ flow: "Transfer", item: "Spotify" });
    expect(proposals[0]?.adjustments.join(" ")).toContain("subscriptions or bills");
  });

  it("recognises the name in the description when the item is blank", () => {
    const { proposals } = one({
      flow: "Transfer",
      item: "",
      description: "Spotify subscription payment",
    });
    expect(proposals[0]?.draft.flow).toBe("Spending");
  });

  /** A real transfer must stay a transfer. This only fires on a named thing. */
  it("leaves an ordinary transfer alone", () => {
    const { proposals } = one({ flow: "Transfer", item: "", description: "Maya to Gcash" });
    expect(proposals[0]?.draft.flow).toBe("Transfer");
  });

  it("does not touch a subscription that was already read as spending", () => {
    const { proposals } = one({ flow: "Spending", item: "Spotify", category: "Subscriptions" });
    expect(proposals[0]?.draft.flow).toBe("Spending");
    expect(proposals[0]?.adjustments.join(" ")).not.toContain("rather than a transfer");
  });
});
