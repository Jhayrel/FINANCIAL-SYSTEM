import { describe, expect, it } from "vitest";

import { readProposals } from "./proposal";
import { readReceipt } from "./receipt";
import type { ReferenceLists } from "./types";

/**
 * A receipt's card, held to the receipt.
 *
 * The model is told the total, and these are the ways it has been seen to
 * answer anyway: the cash handed over, the change, the tax parts as rows of
 * their own. Each is put right from the receipt's own arithmetic, and says
 * so on the card. Figures are the owner's receipt of 28 September 2026.
 */

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Home", remark: "" }, { name: "Food", remark: "" }],
};

const TODAY = "2026-09-28";

const reading = [
  "REED DIFFUSER 50ML OUD WOOD AND SANTAL",
  "8804032 1 X 109.00 109.00",
  "SUBTOTAL",
  "VATABLE SALES 97.32",
  "VAT AMT 11.68",
  "Total ₱109.00",
  "CASH 200.00",
  "CHANGE 91.00",
  "09/27/2026 09:53",
].join("\n");

const receipts = [readReceipt([reading], TODAY)].filter((r) => r !== null);

const read = (rows: Record<string, unknown>[]) =>
  readProposals({ proposals: rows }, reference, TODAY, { readings: [reading], receipts }).proposals;

const row = (over: Record<string, unknown>): Record<string, unknown> => ({
  flow: "Spending",
  date: TODAY,
  fromWallet: "Cash",
  item: "Home",
  description: "Reed diffuser",
  confidence: "high",
  ...over,
});

describe("a receipt's card is the receipt's total", () => {
  it("the cash handed over becomes the total, and the card says why", () => {
    const [card] = read([row({ amountPesos: 200 })]);
    expect(card?.draft.amount).toBe(10900);
    expect(card?.confidence).toBe("medium");
    expect(card?.adjustments.join(" ")).toContain("the money handed over");
    expect(card?.adjustments.join(" ")).toContain("200.00 paid less 91.00 change is 109.00");
  });

  it("the change becomes the total", () => {
    const [card] = read([row({ amountPesos: 91 })]);
    expect(card?.draft.amount).toBe(10900);
  });

  it("VATable sales and VAT as two rows become one row of the total", () => {
    const cards = read([row({ amountPesos: 97.32 }), row({ amountPesos: 11.68, description: "VAT" })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.draft.amount).toBe(10900);
    expect(cards[0]?.adjustments.join(" ")).toContain("Left out PHP 11.68, the VAT");
  });

  it("a card already on the total is left as the model read it", () => {
    const [card] = read([row({ amountPesos: 109 })]);
    expect(card?.draft.amount).toBe(10900);
    expect(card?.confidence).toBe("high");
  });

  it("takes the wallet and the day from the receipt when the model left them open", () => {
    const [card] = read([row({ amountPesos: 109, fromWallet: "" })]);
    expect(card?.draft.fromWallet).toBe("Cash");
    expect(card?.draft.date).toBe("2026-09-27");
  });

  it("never overrides a wallet or a day the model gave", () => {
    const [card] = read([row({ amountPesos: 109, fromWallet: "Gcash", date: "2026-09-26" })]);
    expect(card?.draft.fromWallet).toBe("Gcash");
    expect(card?.draft.date).toBe("2026-09-26");
  });

  it("leaves income and transfers alone", () => {
    const [card] = read([{ flow: "Revenue", date: TODAY, toWallet: "Cash", item: "Allowance", amountPesos: 200 }]);
    expect(card?.draft.amount).toBe(20000);
  });

  it("does nothing without a receipt", () => {
    const cards = readProposals({ proposals: [row({ amountPesos: 200 })] }, reference, TODAY, { readings: ["hello"] }).proposals;
    expect(cards[0]?.draft.amount).toBe(20000);
  });
});
