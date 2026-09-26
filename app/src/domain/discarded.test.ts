import { describe, expect, it } from "vitest";

import { discardedWords } from "./discarded";
import { emptyDraft, type Draft } from "./entry";

const card = (over: Partial<Draft>): Draft => ({ ...emptyDraft("2026-09-26"), ...over });

describe("a discarded card says what it was", () => {
  it("names the kind, the item, the amount, the wallet, the day and the description", () => {
    const words = discardedWords(card({ flow: "Spending", item: "Online Buy", amount: 72345, fromWallet: "Maya", date: "2026-09-15", description: "Online purchase" }));
    expect(words.what).toBe("Spending, Online Buy, ₱723.45");
    expect(words.detail).toBe('from Maya, 15 Sep 2026, "Online purchase"');
  });

  it("says where income went, and leaves out a description that only repeats the item", () => {
    const words = discardedWords(card({ flow: "Revenue", item: "Random", amount: 425, toWallet: "Maya", date: "2026-09-13", description: "random" }));
    expect(words).toEqual({ what: "Revenue, Random, ₱4.25", detail: "into Maya, 13 Sep 2026" });
  });

  it("counts the fee in the amount, and says when money left the accounts", () => {
    const words = discardedWords(card({ flow: "Transfer", amount: 200000, fee: 1500, fromWallet: "Gcash", toWallet: "", date: "2026-09-20" }));
    expect(words.what).toBe("Transfer, ₱2,015.00");
    expect(words.detail).toBe("from Gcash out of your accounts, 20 Sep 2026");
  });

  it("says no amount when there was none", () => {
    expect(discardedWords(card({ flow: "Debt", amount: null })).what).toBe("Debt, no amount");
  });
});
