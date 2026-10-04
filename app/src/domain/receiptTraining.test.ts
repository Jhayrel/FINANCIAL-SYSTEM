/**
 * The kinds of paper the owner sent to train on, 4 October 2026: "Training
 * receipts. Dont add this just train".
 *
 * Fourteen pictures: a card slip and the shop's own receipt of the same
 * meal, a reed diffuser paid with cash and change, a 7-Eleven bottle of
 * water, a GCash bank transfer, a school's official receipt for tuition, an
 * LTO registration receipt, two cinema tickets, a dessert shop's receipt, a
 * supermarket tape, and four that record no payment at all: an electricity
 * bill, a school's assessment of fees and two online checkout screens.
 *
 * The texts here are shaped like what the phone's reader made of those
 * layouts, misreadings included (a total read as 2,600.00 in one reading
 * and 2,000.00 in the other; the LTO total missing from both readings, its
 * amount surviving only in words). Every name, number and figure is
 * invented: none of the owner's own is kept anywhere.
 */

import { describe, expect, it } from "vitest";

import { holdNotPaid, type ExtractResult } from "../data/aiClient";
import { emptyDraft, type Draft } from "./entry";
import { notPaidNote, notPaidWords, paidDraftFor, readNotPaid, saysItWasPaid } from "./notPaid";
import type { Proposal } from "./proposal";
import { amountInWords, readReceipt, receiptNote } from "./receipt";
import { readWalletReceipt } from "./walletReceipt";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: ["Riverside Power", "Globe at Home Wifi"],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [
    { name: "Food", remark: "" },
    { name: "Online Buy", remark: "Shopee, Lazada" },
    { name: "School", remark: "Tuition, projects" },
  ],
};

const ASOF = "2026-10-04";

const proposal = (over: Partial<Draft>): Proposal => ({
  draft: { ...emptyDraft(ASOF), flow: "Spending", category: "Spending", ...over },
  confidence: "high",
  sourceRef: "image 1",
  adjustments: [],
});

// ── An electricity bill ─────────────────────────────────────────────────────

const BILL = [
  "RIVERSIDE POWER COOPERATIVE, INC.",
  "BILLING INVOICE 0012345",
  "ACCT NAME DEMO ACCOUNT",
  "PERIOD COVERED 03/10/2025-04/10/2025",
  "GENERATION 250x7.0077 1751.93 210.23 1962.16",
  "TOTAL CURRENT BILL AMOUNT 2871.10 344.53 3215.63",
  "GRAND TOTAL / NETBILL 3215.63",
  "VAT Sales 2700.00",
  "Charges for this billing period 3215.63",
  "PLEASE PAY ON OR BEFORE Apr 22, 2025",
  "THIS IS NOT A RECEIPT UNLESS MACHINE VALIDATED",
  "REMINDER AND/OR DISCONNECTION NOTICE",
  "if your bill is not paid on or before the due date stated here",
].join("\n");

// ── A school's assessment of fees ───────────────────────────────────────────

const ASSESSMENT = [
  "Hillcrest College",
  "Assessment (First Term 2025)",
  "ASSESSMENT OF FEES: TOTAL TUITION AND FEES : ₱5,210.40",
  "Total Tuition Fees 3,400.00 DOWNPAYMENT 2,605.20",
  "Total Miscellaneous Fees 1,810.40 AMOUNT DUE ₱2,605.20",
  "GRAND TOTAL ₱5,210.40",
  "Enrollment is not yet validated!",
  "To validate your enrolment, please pay at least the down payment on or before",
  "July 3, 2025. Failure to do so means deletion of your reserved subjects",
].join("\n");

// ── An online shop's checkout, before Place Order ───────────────────────────

const CHECKOUT = [
  "Checkout",
  "Headset, Color Family:Black",
  "₱640.00",
  "1 Items, Total: ₱640.00",
  "Price dropped, Saved :₱560.00",
  "Package 2 of 2",
  "Choose your delivery option",
  "Drawing tablet",
  "₱1,250.00",
  "1 Items, Total: ₱1,250.00",
  "Subtotal (2 Items) ₱1,890.00",
  "Shipping Fee ₱75.00",
  "Enter Voucher Code APPLY",
  "Total: ₱1,965.00",
  "VAT included, where applicable Place Order",
].join("\n");

describe("paper that asks for money, not paid", () => {
  it("a bill: what it asks for, by when, and who from", () => {
    expect(readNotPaid([BILL])).toMatchObject({ kind: "bill", from: "RIVERSIDE POWER COOPERATIVE, INC", amount: 321563, due: "Apr 22, 2025", period: "03/10/2025 to 04/10/2025" });
  });

  it("a fee assessment: the amount due now, and the whole", () => {
    expect(readNotPaid([ASSESSMENT])).toMatchObject({ kind: "assessment", from: "Hillcrest College", amount: 260520, whole: 521040, due: "July 3, 2025" });
  });

  it("a checkout: the grand total, never a package's own total", () => {
    const doc = readNotPaid([CHECKOUT]);
    expect(doc).toMatchObject({ kind: "checkout", amount: 196500 });
    expect(notPaidWords(doc!)).toBe(
      'That is a checkout screen with Place Order still on it, so the order was not placed when it was taken: ₱1,965.00 (₱1,890.00 for the items, ₱75.00 shipping). Nothing is added. If you placed it, say how you paid ("placed it, paid with gcash") and I will make the card.',
    );
  });

  it("says what it is, and that nothing is added", () => {
    expect(notPaidWords(readNotPaid([BILL])!)).toBe(
      'That is a bill from RIVERSIDE POWER COOPERATIVE, INC, not a receipt, so it records no payment. It asks for ₱3,215.63, due Apr 22, 2025. Nothing is added. When you pay it, send the receipt, or say "paid it from cash".',
    );
    expect(notPaidWords(readNotPaid([ASSESSMENT])!)).toContain("It asks for ₱2,605.20 (₱5,210.40 in all), due July 3, 2025.");
  });

  it("tells the model to propose nothing, or one row when it was paid", () => {
    const bill = readNotPaid([BILL])!;
    expect(notPaidNote(bill, false)).toContain("Propose nothing from it: nothing was paid.");
    expect(notPaidNote(bill, true)).toContain("They say it was paid, so propose one row of PHP 3,215.63: category Bills");
  });

  it("is not a receipt, a confirmation of an order placed, or a payment made", () => {
    expect(readNotPaid(["Thank you for your order\nOrder placed\nTotal ₱1,965.00\nPaid with GCash"])).toBeNull();
    expect(readNotPaid(["REED DIFFUSER 109.00\nTotal PHP 109.00\nCASH 200.00\nCHANGE 91.00\nVATABLE SALES 97.32\nVAT AMT 11.68"])).toBeNull();
    expect(readNotPaid(["OFFICIAL RECEIPT\nTOTAL AMOUNT PAID: 412.50\nMODE OF PAYMENT: CASH"])).toBeNull();
  });

  it("knows the owner saying it was paid from saying it was not", () => {
    for (const said of ["paid this from cash", "I paid it already", "placed it, paid with gcash", "bayad na"]) expect(saysItWasPaid(said), said).toBe(true);
    for (const said of ["Dont add this just train", "not yet paid", "how much is this bill?", undefined]) expect(saysItWasPaid(said), String(said)).toBe(false);
  });
});

describe("a card made on one of them anyway", () => {
  const result = (proposals: Proposal[], readings: string[]): ExtractResult => ({ proposals, refused: [], source: "model", readings });

  it("is held back, and the owner told why", () => {
    const held = holdNotPaid(result([proposal({ amount: 321563, item: "Electricity" })], [BILL, BILL]), "Dont add this just train");
    expect(held.proposals).toEqual([]);
    expect(held.refused[0]?.reason).toMatch(/^That is a bill from RIVERSIDE POWER COOPERATIVE, INC, not a receipt/);
  });

  it("is kept when they say it was paid", () => {
    const kept = holdNotPaid(result([proposal({ amount: 321563 })], [BILL, BILL]), "paid this from cash");
    expect(kept.proposals).toHaveLength(1);
    expect(kept.refused).toEqual([]);
  });

  it("leaves a real receipt beside it alone", () => {
    const receipt = "REED DIFFUSER 109.00\nTotal PHP 109.00\nCASH 200.00\nCHANGE 91.00";
    const both = holdNotPaid(result([proposal({ amount: 10900 }), proposal({ amount: 196500 })], [receipt, receipt, CHECKOUT, CHECKOUT]), "");
    expect(both.proposals.map((p) => p.draft.amount)).toEqual([10900]);
  });
});

describe("an amount written in words", () => {
  it("is read whole", () => {
    expect(amountInWords("THE TOTAL SUM OF (in pesos)\nFour Hundred Twelve And 50/100 Pesos Only")).toEqual({ exact: 41250 });
    expect(amountInWords("Two thousand only")).toEqual({ exact: 200000 });
    expect(amountInWords("One Thousand Two Hundred Fifty Pesos Only")).toEqual({ exact: 125000 });
  });

  it("says whole thousands when only its end was read", () => {
    expect(amountInWords("; Pr Chdco thousand only")).toEqual({ scale: 100000 });
  });

  it("is nothing in a line with no amount in words", () => {
    expect(amountInWords("THANK YOU, PLEASE COME AGAIN")).toEqual({});
  });
});

describe("an official receipt for tuition", () => {
  // The two readings of one picture disagree: 3,000.00 and 3,800.00.
  const plain = [
    "Hillcrest College",
    "VAT REG. TIN 000-000-000-00000",
    "Name CASH INVOICE # 1000001 2026-07-20 10:15:00",
    "In payment of Amount",
    "DEFERRED INCOME-TUITION 3,000.00",
    "Vatable Sales",
    "TOTAL",
    "Form of Payment",
    "Cash",
    "; Pr Thxee thousand only",
  ].join("\n");
  const raised = plain.replace("3,000.00", "3,800.00").replace("Thxee", "Thre3");

  it("is the figure its words agree with", () => {
    expect(readReceipt([plain, raised], ASOF)).toMatchObject({ total: 300000, date: "2026-07-20", paidWith: "cash" });
  });

  it("tells the model the income printed on it is not theirs", () => {
    expect(receiptNote(readReceipt([plain, raised], ASOF)!)).toContain("INCOME, DEFERRED INCOME or REVENUE printed on it is the issuer's own bookkeeping, never income to them");
  });
});

describe("a government official receipt with a breakdown", () => {
  // The total's own line was not read at all: the words and the breakdown say it.
  const reading = [
    "LAND TRANSPORT OFFICE",
    "OFFICIAL RECEIPT",
    "RECEIVED FROM DEMO, PERSON",
    "PAYMENT DETAILS BREAKDOWN OF PAYMENT",
    "Transaction: RENEW Legal Research Fund 10.00",
    "Motor vehicle user charge 250.00",
    "Posted: Aug 3 2025 Sc Tax 12.00",
    "Comp Fee 140.50",
    "NEXT REG RENEWAL JUL 1 2026 to SEP 7 2026",
    "THE TOTAL SUM OF TOTAL AMOUNT PAI",
    "Four Hundred Twelve And 50/100 Pesos Onl",
    "MODE OF PAYMENT: CASH",
  ].join("\n");

  it("is the total in words and the sum of its lines, on the day it was posted", () => {
    const read = readReceipt([reading], "2026-08-20");
    expect(read).toMatchObject({ total: 41250, confidence: "high", paidWith: "cash", date: "2025-08-03" });
    expect(read?.evidence).toEqual(["written in words as 412.50", "the lines of the breakdown add up to 412.50"]);
  });
});

describe("a bank transfer's receipt", () => {
  it("is to the account's name, never the address the receipt was e-mailed to", () => {
    const read = readWalletReceipt([
      "Bank Transfer Complete\nSent via GCash\nBank Demo Savings Bank\nAccount No. 000000000000\nAccount Name Ana Reyes\nTransfer Method Instapay\nReceipt sent to ana.reyes@example.com\nTransfer Amount 5,000.00\n+Fee 10.00\nTotal ₱5,010.00\nDate Sep 27,2026 12:51 PM\nRef No. 1234567890123",
    ]);
    expect(read).toMatchObject({ kind: "bank", amount: 500000, fee: 1000, party: "Ana Reyes" });
  });
});

describe("once they say it was paid", () => {
  it("a checkout is an online purchase of its total, from the account they name", () => {
    expect(paidDraftFor(readNotPaid([CHECKOUT])!, "placed it, paid with gcash", reference, ASOF)).toMatchObject({
      flow: "Spending", category: "Spending", item: "Online Buy", amount: 196500, fromWallet: "Gcash", status: "Paid", description: "Online order (₱1,890.00 for the items, ₱75.00 shipping)",
    });
  });

  it("a bill is on the bills list, at what it asked for or what they say", () => {
    const bill = readNotPaid([BILL])!;
    expect(paidDraftFor(bill, "paid it from cash", reference, ASOF)).toMatchObject({ category: "Bills", item: "Riverside Power", amount: 321563, fromWallet: "Cash" });
    expect(paidDraftFor(bill, "paid 3000 from maya", reference, ASOF)).toMatchObject({ amount: 300000, fromWallet: "Maya" });
  });

  it("fees are school", () => {
    expect(paidDraftFor(readNotPaid([ASSESSMENT])!, "paid the downpayment cash", reference, ASOF)).toMatchObject({ item: "School", amount: 260520, fromWallet: "Cash" });
  });
});
