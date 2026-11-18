/**
 * The Add form's suggestions (owner, 18 November 2026: "the autofill in
 * entry is always innacurate"). Invented ledger.
 */

import { describe, expect, it } from "vitest";

import { emptyDraft, type Draft } from "./entry";
import { formSuggest } from "./formSuggest";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Savings"],
  bills: ["Phone Plan"],
  subscriptions: ["Music"],
  revenueCategories: ["Allowance", "Freelance"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Gas", remark: "" },
    { name: "Fun", remark: "Outings, parties, leisure" },
    { name: "School", remark: "" },
  ],
};

let n = 0;
const row = (over: Partial<Transaction>): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: `2026-10-${String((n % 28) + 1).padStart(2, "0")}`,
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "lunch",
    amount: 10000,
    fee: 0,
    total: 10000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

// Mostly cash food, so the old count offered Food and Cash for everything.
const ledger: Transaction[] = [
  ...Array.from({ length: 20 }, () => row({})),
  ...Array.from({ length: 4 }, () => row({ item: "Gas", description: "gas at the station", amount: 20000, total: 20000, fromWallet: "Gcash" })),
  ...Array.from({ length: 3 }, () => row({ item: "Fun", description: "jollibee with friends", amount: 35000, total: 35000, fromWallet: "Maya" })),
  ...Array.from({ length: 3 }, () => row({ category: "Bills", item: "Phone Plan", description: "postpaid", amount: 59900, total: 59900, fromWallet: "Gcash" })),
];

const spend = (over: Partial<Draft> = {}): Draft => ({ ...emptyDraft("2026-11-18"), flow: "Spending", ...over });

describe("the kind, read from what was typed", () => {
  it("takes it from the words, not the commonest kind", () => {
    const s = formSuggest(spend({ description: "jollibee", amount: 30000 }), ledger, reference);
    expect(s.item?.value).toBe("Fun");
    expect(s.item?.why).toContain("Fun");
  });

  it("names the kind when the words say it", () => {
    expect(formSuggest(spend({ description: "gas", amount: 15000 }), ledger, reference).item?.value).toBe("Gas");
  });

  it("knows a bill by its amount, and gives its category", () => {
    const s = formSuggest(spend({ amount: 59900 }), ledger, reference);
    expect(s.item).toMatchObject({ value: "Phone Plan", category: "Bills" });
    expect(s.item?.why).toContain("3 of 3");
  });

  it("does not let an amount overrule words that say something else", () => {
    expect(formSuggest(spend({ amount: 59900, description: "ream of paper" }), ledger, reference).item?.value).not.toBe("Phone Plan");
  });

  it("offers no kind when nothing points at one", () => {
    expect(formSuggest(spend({ amount: 12345 }), ledger, reference).item).toBeUndefined();
  });

  it("never offers over a kind already picked", () => {
    expect(formSuggest(spend({ item: "School", description: "gas" }), ledger, reference).item).toBeUndefined();
  });
});

describe("the wallet", () => {
  it("is where that kind is paid from, not the commonest wallet", () => {
    const s = formSuggest(spend({ item: "Gas", amount: 20000 }), ledger, reference);
    expect(s.fromWallet?.value).toBe("Gcash");
    expect(s.fromWallet?.why).toContain("Gas");
  });

  it("skips a wallet that cannot cover the amount", () => {
    const balances: Record<string, number> = { Gcash: 5000, Cash: 90000, Maya: 90000 };
    const s = formSuggest(spend({ item: "Gas", amount: 20000 }), ledger, reference, { balanceOf: (w) => balances[w] ?? 0 });
    expect(s.fromWallet?.value).not.toBe("Gcash");
  });

  it("follows the words to the shop's wallet", () => {
    expect(formSuggest(spend({ description: "jollibee", amount: 30000 }), ledger, reference).fromWallet?.value).toBe("Maya");
  });

  it("never offers over a wallet already picked", () => {
    expect(formSuggest(spend({ item: "Gas", fromWallet: "Cash" }), ledger, reference).fromWallet).toBeUndefined();
  });
});

describe("a transfer", () => {
  const moves = [
    ...Array.from({ length: 3 }, () => row({ type: "Transfer", category: "Transfer", item: "", description: "", fromWallet: "Maya", toWallet: "Cash", fee: 1500, total: 11500, status: "Withdrawn" })),
  ];
  it("offers where money from this wallet usually goes, and its fee", () => {
    const s = formSuggest({ ...emptyDraft("2026-11-18"), flow: "Transfer", fromWallet: "Maya", amount: 50000 }, moves, reference);
    expect(s.toWallet?.value).toBe("Cash");
    expect(s.fee?.value).toBe(1500);
  });
});
