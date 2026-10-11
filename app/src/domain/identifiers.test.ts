import { describe, expect, it } from "vitest";

import { carriesIdentifier, withoutIdentifiers } from "./identifiers";
import { readEntry, splitEntries } from "./readEntry";

const RECEIPT = "Success! You paid PHP199.00 at DITO Tech-Mobil. Maya account: 512345******0001. Ref. No. 700012345678";
const reference = { wallets: ["Cash", "Maya", "Gcash"], savings: [], bills: [], subscriptions: [], revenueCategories: ["Allowance"], spendingTypes: [{ name: "Food", remark: "" }] };

describe("a pasted confirmation (7 October 2026)", () => {
  it("is one entry, not one per sentence", () => {
    expect(splitEntries(RECEIPT)).toHaveLength(1);
  });

  it("reads the payment and nothing from the account or reference number", () => {
    const read = readEntry(RECEIPT, [], reference as never, "2026-10-07");
    expect(read.draft.amount).toBe(19900);
  });

  it("blanks every kind of identifier", () => {
    for (const said of ["Ref. No. 700012345678", "Reference #A1B2C3D4", "Txn ID: 00123456", "Maya account: 512345******0001", "card ending in 1234", "mobile no. 0917 123 4567", "09171234567", "0917XXX4567", "****1234"]) {
      expect(withoutIdentifiers(said).replace(/[a-z.:#\s]/gi, ""), said).toBe("");
    }
  });

  it("leaves money and ordinary words alone", () => {
    for (const said of ["paid 1,500.00 for food", "order 2 pizzas 500", "paid via card 1500", "PHP199.00 at DITO", "100k from work", "account for 300 food"]) {
      expect(withoutIdentifiers(said), said).toBe(said);
      expect(carriesIdentifier(said), said).toBe(false);
    }
  });
});

describe("a confirmation pasted line by line", () => {
  it("is one entry when it says one amount, even twice", () => {
    const parts = splitEntries("Sent GCash\nAmount 500.00\nTotal Amount Sent 500.00\nRef No. 1234 567 890123\nOct 7, 2026 3:41 PM");
    expect(parts).toHaveLength(1);
    expect(parts[0]).not.toMatch(/890123|1234/);
  });

  it("a list with reference numbers on it is still a list", () => {
    expect(splitEntries("Aug 25 Food 150 cash Ref No. 1111\nAug 26 Gas 200 cash Ref No. 2222")).toHaveLength(2);
  });
});
