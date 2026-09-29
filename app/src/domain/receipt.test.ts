import { describe, expect, it } from "vitest";

import { tidyReading } from "./ocrText";
import { readReceipt, receiptNote } from "./receipt";

/**
 * Receipts, one layout each.
 *
 * The first four are the owner's receipt of 28 September 2026 exactly as the
 * device read it in four different ways, curl, misreads and all. The rest
 * are invented receipts in the layouts a Philippine shopper meets: every
 * figure is made up, and each case exists because its layout puts a figure
 * that is not the total where a reader would expect the total.
 */

const TODAY = "2026-09-28";
const total = (text: string | string[]): number | undefined =>
  readReceipt(Array.isArray(text) ? text : [text], TODAY)?.total;

describe("the owner's receipt, as the phone read it", () => {
  /** Read at 1,240 pixels: 97.32 misread as 91.32, and CASH run into its figure. */
  const at1240 = [
    "{io DIFFUSER nOML OUD Woub ANG HANTAL®",
    "2304032 1 %109.00 109.00",
    "1tem(s) : 1",
    "Fs",
    "SUBTOTAL",
    "oo VATABLE SALES 91.32",
    "TT VAT AMT 11.68",
    "Cy VAT EXEWPT SALED 0.00",
    "JERD RATED SALES 0.00",
    "Total pHP 109.00",
    "CASH200.00",
    "CHANGE91.00",
    "CUST NAME: _--ee -",
    "TIN _- -",
  ].join("\n");

  /** Read at 1,600 pixels, whole: every figure right. */
  const at1600 = [
    "bY lt FUSER HOMI oun WOOD AND ANTAL",
    "3804032 } X 109.00 109.00",
    "item(s) : 1",
    "SUBTOTAL",
    "VATABLE SALES 97.32",
    "VAT AMT 11.68",
    "VAT EXEMPT SALES 0.00",
    "ERD RATED SALES 0.00",
    "Total ₱109.00",
    "CASH 200.00",
    "CHANGE 91.00",
    "TIN: -",
  ].join("\n");

  /** Read as scattered text: every figure on the line before its label. */
  const scattered = [
    "109.00",
    "SUBTOTAL",
    "97.32",
    "VATABLE SALES",
    "11.68",
    "td",
    "0.00",
    "aT BET SALES",
    "0.00",
    "JERO RATED SALES",
    "PHP",
    "109.00",
    "200.00",
    "Total",
    "CASH",
    "91.00",
    "CHANGE",
  ].join("\n");

  /** The curl moved every figure up a line: "Total 200.00", "CASH 91.00". */
  const slid = [
    "REED DIFFUSER 50ML OUD WOOD AND SANTAL",
    "8804032 1 X109.00 109.00",
    "109.00",
    "SUBTOTAL 97.32",
    "VATABLE SALES 11.68",
    "VAT AMT 0.00",
    "VAT EXEMPT SALES 0.00",
    "ZERO RATED SALES",
    "PHP 109.00",
    "Total 200.00",
    "CASH 91.00",
    "CHANGE",
  ].join("\n");

  it("is 109.00 however it was read, never the 200.00 handed over", () => {
    expect(total(at1240)).toBe(10900);
    expect(total(tidyReading(at1240))).toBe(10900);
    expect(total(at1600)).toBe(10900);
    expect(total(scattered)).toBe(10900);
    expect(total(slid)).toBe(10900);
  });

  it("is sure of it, and says why", () => {
    const check = readReceipt([at1600], TODAY);
    expect(check?.confidence).toBe("high");
    expect(check?.tendered).toBe(20000);
    expect(check?.change).toBe(9100);
    expect(check?.vatable).toBe(9732);
    expect(check?.vat).toBe(1168);
    expect(check?.paidWith).toBe("cash");
    expect(check?.evidence).toContain("200.00 paid less 91.00 change is 109.00");
    expect(check?.evidence).toContain("VATable 97.32 plus VAT 11.68 is 109.00");
  });

  it("finds the total in the reading that misread a figure, by the arithmetic that still holds", () => {
    const check = readReceipt([at1240], TODAY);
    expect(check?.total).toBe(10900);
    expect(check?.notTheTotal).toEqual(expect.arrayContaining([20000, 9100, 1168]));
  });

  it("pools two readings of one picture", () => {
    const garbled = "PEED DIFFUSER 50ML OUD F\n8804032 :\nItem(s) : 1\nSUBTOTAL\nVATABLE SALES\nVAT AMT";
    expect(readReceipt([garbled, at1240], TODAY)?.confidence).toBe("high");
  });

  it("says what was bought, as read, so the model can choose the item (28 September 2026)", () => {
    // The card came back asking "What was it for?": the product line reaches the model misread.
    const check = readReceipt([at1600], TODAY);
    expect(check?.bought).toEqual(["bY lt FUSER HOMI oun WOOD AND ANTAL"]);
    const note = check ? receiptNote(check) : "";
    expect(note).toContain('"bY lt FUSER HOMI oun WOOD AND ANTAL"');
    expect(note).toContain("Read through the misreadings");
    expect(note).toContain("leave item empty only when nothing on their list is that kind of thing");
  });

  it("lists each bought line once across two readings, with both readings of it", () => {
    const bought = readReceipt([at1240, at1600], TODAY)?.bought ?? [];
    expect(bought).toEqual(["io DIFFUSER nOML OUD Woub ANG HANTAL / bY lt FUSER HOMI oun WOOD AND ANTAL"]);
  });

  it("names every item on a longer tape, and no totals or tax lines", () => {
    const text = [
      "SAVEMORE MART",
      "BREAD LOAF 65.00",
      "FRESH MILK 1L 98.50",
      "EGGS 12PCS 115.00",
      "SUBTOTAL 278.50",
      "TOTAL 278.50",
      "CASH 300.00",
      "CHANGE 21.50",
      "VAT 29.84",
    ].join("\n");
    expect(readReceipt([text], TODAY)?.bought).toEqual(["BREAD LOAF", "FRESH MILK 1L", "EGGS 12PCS"]);
  });

  it("tells the model the total and what the other figures are", () => {
    const check = readReceipt([at1600], TODAY);
    const note = check ? receiptNote(check) : "";
    expect(note).toContain("the amount paid is 109.00");
    expect(note).toContain("200.00 is the money handed over");
    expect(note).toContain("91.00 is the change given back");
    expect(note).toContain("amountPesos 109");
    expect(note).toContain("paid in cash");
  });
});

describe("receipts in other layouts", () => {
  it("a supermarket tape: many items, a subtotal, cash and change", () => {
    const text = [
      "SAVEMORE MART",
      "BREAD LOAF 65.00",
      "FRESH MILK 1L 98.50",
      "EGGS 12PCS 115.00",
      "2 X 23.75 47.50",
      "SUBTOTAL 326.00",
      "TOTAL 326.00",
      "CASH 1,000.00",
      "CHANGE 674.00",
      "VATable Sales 291.07",
      "VAT Amount 34.93",
      "Thank you for shopping",
    ].join("\n");
    const check = readReceipt([text], TODAY);
    expect(check?.total).toBe(32600);
    expect(check?.confidence).toBe("high");
    expect(check?.notTheTotal).toContain(100000);
  });

  it("fast food: Total Due, and a change larger than the meal", () => {
    const text = [
      "BURGER HUT #0123",
      "1 C1 CHICKEN MEAL 99.00",
      "1 REG ICED TEA 45.00",
      "Total Due 144.00",
      "Cash 500.00",
      "Change 356.00",
      "VATable 128.57",
      "VAT 15.43",
    ].join("\n");
    expect(total(text)).toBe(14400);
  });

  it("a pharmacy with a senior citizen's discount: the amount due, after it", () => {
    const text = [
      "CORNER DRUG",
      "PARACETAMOL 500MG 10S 120.00",
      "VITAMIN C 500MG 30S 380.00",
      "SUBTOTAL 500.00",
      "LESS: VAT 53.57",
      "SC DISC 20% 89.29",
      "AMOUNT DUE 357.14",
      "CASH 400.00",
      "CHANGE 42.86",
      "VAT EXEMPT SALES 446.43",
      "OR# 0001234",
    ].join("\n");
    const check = readReceipt([text], TODAY);
    expect(check?.total).toBe(35714);
    expect(check?.confidence).toBe("high");
  });

  it("a restaurant bill with a service charge, paid by card with no change", () => {
    const text = [
      "LA CUCINA",
      "Pasta Carbonara 450.00",
      "Four Cheese Pizza 800.00",
      "Subtotal 1,250.00",
      "Service Charge 10% 125.00",
      "Grand Total 1,375.00",
      "VISA 1,375.00",
      "VATable Sales 1,227.68",
      "VAT 12% 147.32",
    ].join("\n");
    const check = readReceipt([text], TODAY);
    expect(check?.total).toBe(137500);
    expect(check?.paidWith).toBe("card");
    expect(check?.confidence).toBe("high");
  });

  it("a fuel receipt: litres and the price a litre are not money spent", () => {
    const text = [
      "FUEL STOP CORP",
      "DIESEL 10.500 L @ 62.50",
      "656.25",
      "TOTAL 656.25",
      "CASH 700.00",
      "CHANGE 43.75",
      "VATable 585.94",
      "VAT 70.31",
    ].join("\n");
    expect(total(text)).toBe(65625);
  });

  it("a delivery app: subtotal, fees and a voucher", () => {
    const text = [
      "Your order from Noodle House",
      "Subtotal ₱350.00",
      "Delivery fee ₱49.00",
      "Platform fee ₱5.00",
      "Discount -₱50.00",
      "Total ₱354.00",
      "Paid by GCash",
    ].join("\n");
    const check = readReceipt([text], TODAY);
    expect(check?.total).toBe(35400);
    expect(check?.paidWith).toBe("gcash");
  });

  it("an online order: merchandise subtotal, shipping and vouchers", () => {
    const text = [
      "Order Summary",
      "Merchandise Subtotal ₱1,299.00",
      "Shipping Fee ₱45.00",
      "Shipping Discount -₱45.00",
      "Voucher -₱100.00",
      "Order Total ₱1,199.00",
      "Payment Method: Maya",
    ].join("\n");
    const check = readReceipt([text], TODAY);
    expect(check?.total).toBe(119900);
    expect(check?.paidWith).toBe("maya");
  });

  it("a BIR sales invoice: total amount due, amount tendered, change due", () => {
    const text = [
      "SALES INVOICE No. 004512",
      "VAT REG TIN 123-456-789-000",
      "Printing service 2 @ 150.00 300.00",
      "TOTAL SALES (VAT INCLUSIVE) 300.00",
      "TOTAL AMOUNT DUE 300.00",
      "AMOUNT TENDERED 500.00",
      "CHANGE DUE 200.00",
      "VATABLE SALES 267.86",
      "VAT AMOUNT 32.14",
    ].join("\n");
    expect(total(text)).toBe(30000);
  });

  it("a convenience store paid with an e-wallet, exactly", () => {
    const text = [
      "QUICKSTOP 24/7",
      "Siopao Asado 55.00",
      "Bottled Water 32.00",
      "TOTAL 87.00",
      "MAYA 87.00",
      "VATable 77.68",
      "VAT 9.32",
    ].join("\n");
    const check = readReceipt([text], TODAY);
    expect(check?.total).toBe(8700);
    expect(check?.paidWith).toBe("maya");
    expect(check?.tendered).toBeUndefined();
  });

  it("exact cash with a change of nothing", () => {
    const text = ["CANTEEN", "Rice meal 85.00", "TOTAL 85.00", "CASH 85.00", "CHANGE 0.00", "VAT 9.11"].join("\n");
    expect(total(text)).toBe(8500);
  });

  it("the cashier's line is not a cash payment", () => {
    const text = ["STORE", "Soap 45.00", "SUBTOTAL 45.00", "TOTAL 45.00", "CASHIER: ANA", "VAT 4.82"].join("\n");
    expect(readReceipt([text], TODAY)?.paidWith).toBeUndefined();
  });
});

describe("what is not a shop receipt", () => {
  it("a wallet's own history is left to its own rules", () => {
    const text = [
      "September 24, 2026",
      "Received money from Maya",
      "₱5.00",
      "Purchased on Globe",
      "-₱1,299.00",
      "Transferred money to My Wallet",
      "₱2,000.00",
    ].join("\n");
    expect(readReceipt([text], TODAY)).toBeNull();
  });

  it("a GCash send confirmation, with its fee, is left to its own rules", () => {
    const text = ["Express Send", "Amount 1,000.00", "Fee 15.00", "Total Amount Sent ₱1,015.00", "Ref No. 1234 567 890123"].join("\n");
    expect(readReceipt([text], TODAY)).toBeNull();
  });

  it("text with no figures", () => {
    expect(readReceipt(["hello", ""], TODAY)).toBeNull();
    expect(readReceipt([], TODAY)).toBeNull();
  });
});

describe("the date and time printed on a receipt", () => {
  const withDate = (line: string) =>
    readReceipt([["STORE", "Item 50.00", "TOTAL 50.00", "CASH 100.00", "CHANGE 50.00", line].join("\n")], TODAY);

  it("month first, as Philippine receipts print it", () => {
    expect(withDate("09/28/2026 09:53 SH01 II008 T03")?.date).toBe("2026-09-28");
    expect(withDate("09/28/2026 09:53 SH01 II008 T03")?.time).toBe("09:53");
    expect(withDate("09/28/2026")?.dateAmbiguous).toBeUndefined();
  });

  it("says so when the day and month could be swapped", () => {
    const check = withDate("09/08/2026");
    expect(check?.date).toBe("2026-09-08");
    expect(check?.dateAmbiguous).toBe(true);
  });

  it("day first when the month first cannot be a date", () => {
    expect(withDate("25/09/2026")?.date).toBe("2026-09-25");
  });

  it("written months and year first", () => {
    expect(withDate("28-Sep-2026 1:05 PM")?.date).toBe("2026-09-28");
    expect(withDate("28-Sep-2026 1:05 PM")?.time).toBe("13:05");
    expect(withDate("Sep 27, 2026")?.date).toBe("2026-09-27");
    expect(withDate("2026-09-26 18:40")?.date).toBe("2026-09-26");
  });

  it("never a date in the future or years back", () => {
    expect(withDate("12/30/2026")?.date).toBeUndefined();
    expect(withDate("01/02/2019")?.date).toBeUndefined();
  });

  it("a date written with points is not a figure", () => {
    expect(withDate("28.09.2026")?.total).toBe(5000);
  });
});

describe("a 7-Eleven receipt, photographed tilted (29 September 2026)", () => {
  // What this device read once the photo was straightened (data/ocr.ts, `skewAngle`).
  const read = [
    "GREATER HEIGHTS 7-11",
    "Owned & Operated by: GREATER -",
    "HEIGHTS GROUP OF COMPANIES INC.",
    "UATREGTIN #417-523-391-000",
    "09/29/2026 (Tue) 11:07:40",
    "{ INVOICE #200506419 RESET _CNT#00D",
    "STORE#1020 SN# :NTM33522",
    "NatureSprigPur iDHIL 25.00U",
    "wad Total Amount Due (1 25.00",
    "CASH 25.00",
    "CHANGE 0.00",
    "Uatable 22.32",
    "UAT Amt 2.68",
    "UpT Exempt Sales 0.00",
    "zero Rated Sales 0.00",
  ].join("\n");
  const check = readReceipt([read, read], "2026-09-29");

  it("finds what was paid, and that it was cash", () => {
    expect(check?.total).toBe(2_500);
    expect(check?.confidence).toBe("high");
    expect(check?.paidWith).toBe("cash");
  });

  it("reads the day and time printed on it", () => {
    expect(check?.date).toBe("2026-09-29");
    expect(check?.time).toBe("11:07");
  });

  it("keeps the shop's tax mark out of what was bought", () => {
    expect(check?.bought).toEqual(["NatureSprigPur iDHIL"]);
  });

  it("tells the model how to read a shop's shortened names", () => {
    expect(check ? receiptNote(check) : "").toContain("NatureSpngPuriDW1L is Nature Spring purified drinking water, 1 litre");
  });
});
