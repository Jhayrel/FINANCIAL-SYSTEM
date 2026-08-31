import { describe, expect, it } from "vitest";

import { inferFromHistory, itemFromHistory } from "./infer";
import { emptyDraft, type Draft } from "./entry";
import { blanksIn, nextQuestion } from "./capture";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: ["Electricity"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Load", remark: "" }, { name: "Food", remark: "" }],
};

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: "2026-07-01",
    type: "Spending",
    fromWallet: "Gcash",
    toWallet: "",
    category: "Spending",
    item: "Load",
    description: "",
    amount: 5000,
    fee: 0,
    total: 5000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const spend = (over: Partial<Draft> = {}): Draft => ({
  ...emptyDraft("2026-08-31"),
  flow: "Spending",
  category: "Spending",
  ...over,
});

describe("itemFromHistory: the sentence names it", () => {
  const ledger = [row(), row(), row({ item: "Food", description: "lunch" })];

  it('finds "Load" in "buying load using maya"', () => {
    const match = itemFromHistory("I spent 100 today buying load using maya", ledger);
    expect(match?.item).toBe("Load");
    expect(match?.how).toBe("named");
    expect(match?.seen).toBe(2);
  });

  it("does not match a name buried in a longer word", () => {
    expect(itemFromHistory("I downloaded a game", ledger)).toBeNull();
  });

  it("prefers the longer item name when one contains the other", () => {
    const both = [...ledger, row({ item: "Cellphone Load" }), row({ item: "Cellphone Load" })];
    expect(itemFromHistory("bought cellphone load", both)?.item).toBe("Cellphone Load");
  });

  it("finds nothing in a ledger with no items", () => {
    expect(itemFromHistory("buying load", [])).toBeNull();
  });
});

describe("itemFromHistory: the words have gone with it before", () => {
  /**
   * The owner's own example: the ledger has no item called "Load", it has
   * "Online buy", and the description is where the word lives.
   */
  const ledger = [
    row({ item: "Online buy", description: "load for maya" }),
    row({ item: "Online buy", description: "gcash load" }),
    row({ item: "Food", description: "lunch" }),
  ];

  it('reads "buying load" as the item those rows actually use', () => {
    const match = itemFromHistory("I spent 100 today buying load using maya", ledger);
    expect(match?.item).toBe("Online buy");
    expect(match?.how).toBe("pattern");
  });

  it("will not decide off a single row, which is a coincidence", () => {
    const once = [row({ item: "Online buy", description: "load" }), row({ item: "Food" })];
    expect(itemFromHistory("buying load", once)).toBeNull();
  });

  it("ignores the words that carry no meaning", () => {
    // "today" and "spent" appear in half the descriptions and mean nothing.
    const noisy = [
      row({ item: "Food", description: "spent today" }),
      row({ item: "Food", description: "spent today" }),
    ];
    expect(itemFromHistory("I spent today", noisy)).toBeNull();
  });
});

describe("inferFromHistory fills the blanks and says why", () => {
  const ledger = [
    row({ item: "Load", fromWallet: "Gcash", category: "Spending", status: "Paid" }),
    row({ item: "Load", fromWallet: "Gcash", category: "Spending", status: "Paid" }),
    row({ item: "Load", fromWallet: "Cash", category: "Spending", status: "Paid" }),
  ];

  it("answers the question it used to ask", () => {
    // What the model reads off the sentence: spending, 100, Maya, no item.
    const draft = spend({ amount: 10000, fromWallet: "Maya" });
    expect(blanksIn(draft, [...reference.wallets, ...reference.savings])).toContain("item");

    const { draft: filled, because } = inferFromHistory(
      draft,
      ledger,
      reference,
      "I spent 100 today buying load using maya",
    );

    expect(filled.item).toBe("Load");
    expect(because.join(" ")).toContain("3 times");
    expect(nextQuestion(filled, reference)).toBeNull();
  });

  it("does not overrule a wallet the sentence named", () => {
    const { draft: filled } = inferFromHistory(
      spend({ amount: 10000, fromWallet: "Maya" }),
      ledger,
      reference,
      "buying load using maya",
    );
    // Gcash is the commonest, and Maya is what was said.
    expect(filled.fromWallet).toBe("Maya");
  });

  it("fills the wallet when the sentence named none", () => {
    const { draft: filled, because } = inferFromHistory(
      spend({ amount: 10000 }),
      ledger,
      reference,
      "bought load",
    );
    expect(filled.fromWallet).toBe("Gcash");
    expect(because.join(" ")).toContain("Gcash");
  });

  it("takes the category and status these rows usually carry", () => {
    const bills = [
      row({ item: "Electricity", category: "Bills", status: "Paid", fromWallet: "Maya" }),
      row({ item: "Electricity", category: "Bills", status: "Paid", fromWallet: "Maya" }),
    ];
    const { draft: filled } = inferFromHistory(
      spend({ amount: 100000 }),
      bills,
      reference,
      "paid electricity",
    );
    expect(filled.category).toBe("Bills");
    expect(filled.status).toBe("Paid");
  });

  it("never invents an amount", () => {
    const { draft: filled } = inferFromHistory(spend(), ledger, reference, "bought load");
    expect(filled.amount).toBeNull();
    expect(nextQuestion(filled, reference)?.blank).toBe("amount");
  });

  it("never puts a wallet that is not the owner's into the draft", () => {
    const foreign = [row({ item: "Load", fromWallet: "BPI" }), row({ item: "Load", fromWallet: "BPI" })];
    const { draft: filled } = inferFromHistory(
      spend({ amount: 10000 }),
      foreign,
      reference,
      "bought load",
    );
    expect(filled.fromWallet).toBe("");
  });

  it("leaves a draft alone when the ledger has nothing to say", () => {
    const { draft: filled, because } = inferFromHistory(
      spend({ amount: 10000 }),
      [],
      reference,
      "bought something unheard of",
    );
    expect(filled.item).toBe("");
    expect(because).toEqual([]);
  });

  it("does nothing to a debt draft, where guessing is not acceptable", () => {
    const debt: Draft = { ...emptyDraft("2026-08-31"), flow: "Debt", amount: 10000 };
    const { draft: filled, because } = inferFromHistory(debt, ledger, reference, "load");
    expect(filled).toEqual(debt);
    expect(because).toEqual([]);
  });

  it("only looks at rows of the same flow", () => {
    const income = [
      row({ type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Maya", status: "Received" }),
      row({ type: "Revenue", category: "Revenue", item: "Allowance", fromWallet: "", toWallet: "Maya", status: "Received" }),
    ];
    const draft: Draft = { ...emptyDraft("2026-08-31"), flow: "Revenue", category: "Revenue", amount: 50000 };
    const { draft: filled } = inferFromHistory(draft, [...ledger, ...income], reference, "got my allowance");
    expect(filled.item).toBe("Allowance");
    expect(filled.toWallet).toBe("Maya");
    expect(filled.status).toBe("Received");
  });
});
