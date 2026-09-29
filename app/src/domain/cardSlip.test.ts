/**
 * A card terminal's slip, and the shop's receipt for the same payment
 * (`cardSlip.ts`).
 *
 * 29 September 2026: a Maya Business terminal's slip ("PAYMENT CHANNEL
 * Credit Card", "APP. LABEL Visa Credit", ₱2,082.00) sent with the
 * restaurant's receipt for the same meal. The readings below are this
 * device's own, errors and all; the terminal's numbers, the card's digits
 * and the approval code are changed.
 */

import { describe, expect, it } from "vitest";

import { cardAccount, cardSlipNote, cardSlipsIn, readCardSlip, samePayment } from "./cardSlip";
import { emptyDraft } from "./entry";
import { checkCardSlips, type Proposal } from "./proposal";
import { readReceipt } from "./receipt";
import type { ReferenceLists, Transaction } from "./types";

const SLIP = [
  "MANG INAGAL M3523",
  "LG SM CITY BIDAY SAN FERNANDO",
  "MERCHANT ID EF80000000000",
  "TERMINAL ID 20000000",
  "CARD TYPE VISA - -",
  "PAYMENT CHANNEL Cedi Card 7",
  "CARD NO. seven en (1234 (C) =",
  "TRANS. TYPE SALE SR",
  "BATCH NO..000001 TRACE NO..000001 iy",
  "REF NO..600000000000 APPR. CODE654321 et A",
  "DATE/TIME 2026/09/29 191647 ’",
  "me APPROVED -----",
  "AMOUNT #2,082.00 SRE",
  "APP LABEL: Visa Credit",
  "AlD: AG000000031010",
  "PROMISE TU PAY THE TOTAL AMOUNT ABOVE AND",
].join("\n");

const RECEIPT = [
  "sales TNUALCE",
  "09/29/2026 19:16 #02",
  "1 PAA LRG UR UM 214.00",
  "1 UPSTZE COKE 20.00V",
  "7 PECHD LRG UR UM 244 1,708.00V",
  "7 UPSIZE COKE @20 140.00V",
  "8 Item(s) bp 2,062.00",
  "TOTAL DUE ₱2,082.00",
  "PAYMAYA CREDIT CARD 2,082.00",
  "ppprCode: 654321",
  "UATable Sales 1,858.93",
  "UAT Amount 223.07",
  "Zero-Rated Sales 0.00",
].join("\n");

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Treat", remark: "" }],
  credits: ["Maya Credit"],
};

describe("the slip", () => {
  const slip = readCardSlip([SLIP]);

  it("is one card payment at the merchant", () => {
    expect(slip).toMatchObject({ amount: 208_200, merchant: "MANG INAGAL M3523", date: "2026-09-29", time: "19:16", approval: "654321", last4: "1234", network: "Visa", kind: "sale" });
  });

  it("tells the model it is spending, never borrowing because of the card's label", () => {
    const note = slip ? cardSlipNote(slip) : "";
    expect(note).toContain("one card payment of PHP 2,082.00 at MANG INAGAL M3523 on 2026-09-29 at 19:16, approval code 654321");
    expect(note).toContain("flow Spending");
    expect(note).toContain("never a Debt");
  });

  it("is not an ATM withdrawal or a shop receipt", () => {
    expect(readCardSlip(["CASH WITHDRAWAL 1,000.00\nAPPROVED\nCARD NO 1234\nAPPR CODE 111111\nSALE"])).toBeNull();
    expect(readCardSlip([RECEIPT])).toBeNull();
  });
});

describe("the restaurant's receipt", () => {
  const receipt = readReceipt([RECEIPT, RECEIPT], "2026-09-29");

  it("is read though the printer's V came out as U", () => {
    expect(receipt?.total).toBe(208_200);
    expect(receipt?.confidence).toBe("high");
    expect(receipt?.vatable).toBe(185_893);
    expect(receipt?.vat).toBe(22_307);
  });

  it("says card, not Maya: PAYMAYA is the terminal's company", () => {
    expect(receipt?.paidWith).toBe("card");
    expect(receipt?.approval).toBe("654321");
  });

  it("is the same payment as the slip", () => {
    const slip = readCardSlip([SLIP]);
    expect(slip && receipt ? samePayment(slip, receipt) : false).toBe(true);
    expect(slip && receipt ? samePayment(slip, { ...receipt, approval: "999999" }) : true).toBe(false);
    expect(slip ? samePayment(slip, { total: 208_200, date: "2026-09-29", time: "19:20" }) : false).toBe(true);
    expect(slip ? samePayment(slip, { total: 208_200, date: "2026-09-29", time: "21:00" }) : true).toBe(false);
  });
});

describe("the model's cards, held to the slip", () => {
  const slip = readCardSlip([SLIP]);
  if (!slip) throw new Error("slip not read");
  const card = (over: Partial<Proposal["draft"]>): Proposal => ({
    draft: { ...emptyDraft("2026-09-29"), ...over },
    confidence: "high",
    sourceRef: "the picture",
    adjustments: [],
  });

  it("makes a borrowing, the slip's card and the receipt's card one spending", () => {
    const out = checkCardSlips(
      [
        card({ flow: "Debt", debtEffect: "draw", amount: 208_200, toWallet: "Maya", description: "Bought on credit" }),
        card({ flow: "Spending", category: "Spending", item: "", amount: 208_200, description: "MANG INASAL" }),
        card({ flow: "Spending", category: "Spending", item: "Food", amount: 208_200, description: "Mang Inasal, 8 meals" }),
      ],
      [slip],
      reference,
      "2026-09-29",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.draft).toMatchObject({ flow: "Spending", item: "Food", amount: 208_200, description: "Mang Inasal, 8 meals", date: "2026-09-29", notes: "19:16" });
    expect(out[0]?.draft.debtEffect).toBeUndefined();
    const said = out[0]?.adjustments.join(" ") ?? "";
    expect(said).toContain("A card payment, not borrowing");
    expect(said).toContain("the same PHP 2,082.00 payment (approval code 654321), so one entry");
  });

  it("makes the card from the slip when the model found nothing", () => {
    const out = checkCardSlips([], [slip], reference, "2026-09-29");
    expect(out[0]?.draft).toMatchObject({ flow: "Spending", amount: 208_200, description: "Card payment at MANG INAGAL M3523" });
  });

  it("leaves other cards alone", () => {
    const other = card({ flow: "Spending", category: "Spending", item: "Food", amount: 9_500 });
    expect(checkCardSlips([other], [slip], reference, "2026-09-29")).toContainEqual(other);
  });
});

describe("which account a card payment came out of", () => {
  let n = 0;
  const row = (over: Partial<Transaction>): Transaction => {
    n += 1;
    return { id: `c${n}`, recordNumber: n, date: `2026-09-${String(10 + n).padStart(2, "0")}`, type: "Spending", fromWallet: "Maya", toWallet: "", category: "Spending", item: "Food", description: "", amount: 40_000, fee: 0, total: 40_000, notes: "", status: "Paid", ...over };
  };
  const accounts = [...reference.wallets, ...reference.savings];

  it("is where the owner's card purchases come from", () => {
    const ledger = [
      row({ description: "Purchase at MCDO 878 BAUANG" }),
      row({ description: "JOLLIBEE JB3829" }),
      row({ description: "Jollibee JB0892" }),
      // Borrowing into the wallet is not a card payment on the line.
      row({ type: "Debt", debtEffect: "draw", debtId: "maya-credit", fromWallet: "", toWallet: "Maya", description: "Borrowed from Maya Credit" }),
      row({ fromWallet: "Cash", description: "lunch" }),
    ];
    expect(cardAccount(ledger, accounts)).toEqual({ account: "Maya", count: 3 });
  });

  it("is a credit line when the owner files card purchases as bought on one", () => {
    const ledger = [1, 2, 3].map(() => row({ type: "Debt", debtEffect: "draw", debtId: "bdo-card", fromWallet: "", toWallet: "Gcash", description: "Bought on credit" }));
    expect(cardAccount(ledger, accounts)).toEqual({ account: "", line: "bdo-card", count: 3 });
  });

  it("is not known when the ledger does not say, or says two things equally", () => {
    expect(cardAccount([row({ fromWallet: "Cash", description: "lunch" })], accounts)).toBeNull();
    expect(cardAccount([row({ description: "Purchase at A1234" }), row({ fromWallet: "Gcash", description: "Purchase at B5678" })], accounts)).toBeNull();
  });
});

describe("one slip read two ways", () => {
  it("is one slip, with the approval code whichever reading caught it", () => {
    const garbled = SLIP.replace("APPR. CODE654321", "APPR. CODEBO0OG0O4").replace("2026/09/29 191647", "2020/09/29 19 16:47");
    const slips = cardSlipsIn([garbled, SLIP]);
    expect(slips).toHaveLength(1);
    expect(slips[0]?.approval).toBe("654321");
    expect(slips[0]?.date).toBe("2026-09-29");
    expect(slips[0]?.time).toBe("19:16");
  });

  it("reads a time with a colon lost as hours and minutes", () => {
    expect(readCardSlip([SLIP.replace("2026/09/29 191647", "2026/09/29 19 16:47")])?.time).toBe("19:16");
  });
});
