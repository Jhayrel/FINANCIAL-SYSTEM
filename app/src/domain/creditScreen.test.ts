/**
 * The owner's Maya Credit screenshot, 26 September 2026, 23:53.
 *
 * Two borrowings of ₱2,000.00 into Maya, each with a ₱149.80 service fee and
 * a ₱1.23 documentary stamp tax. The model returned six rows: the borrowings
 * as transfers out of Maya to nowhere, one DST as ₱123.00, and a charge with
 * no credit line. What the owner wanted was two entries: borrowed ₱2,000.00
 * with the fees added.
 */
import { describe, expect, it } from "vitest";

import { readProposals } from "./proposal";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Maya Bank (Personal savings)"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
  credits: ["Maya Credit"],
};

const readings = [
  "Transactions\nSeptember 20, 2026\nFee applied 07:57 PM\nDST -₱1.23\nFee applied 07:57 PM\nService Fee - ₱149.80\nTransferred money to 07:57 PM\nMy Wallet - ₱2,000.00\nSeptember 18, 2026\nFee applied 06:11 PM\nDST -₱1.23\nFee applied 06:11 PM\nService Fee -₱149.80\nTransferred money to 06:11 PM\nMy Wallet - ₱2,000.00",
];

// What came back, as the cards showed it.
const fromModel = [
  { flow: "Debt", debt: "Maya", debtEffect: "charge", amountPesos: 123, date: "2026-09-20", time: "19:57", description: "DST", sourceRef: "maya.jpg line DST 07:57" },
  { flow: "Debt", debt: "Maya Credit", debtEffect: "charge", amountPesos: 149.8, date: "2026-09-20", time: "19:57", description: "Service Fee" },
  { flow: "Transfer", fromWallet: "Maya", toWallet: "", amountPesos: 2000, date: "2026-09-20", description: "Transfer to My Wallet", status: "Transferred", sourceRef: "maya.jpg line My Wallet 07:57" },
  { flow: "Debt", debt: "Maya Credit", debtEffect: "charge", amountPesos: 1.23, date: "2026-09-18", time: "18:11", description: "DST" },
  { flow: "Debt", debt: "Maya Credit", debtEffect: "charge", amountPesos: 149.8, date: "2026-09-18", time: "18:11", description: "Service Fee" },
  { flow: "Transfer", fromWallet: "Maya", toWallet: "", amountPesos: 2000, date: "2026-09-18", description: "Transfer to My Wallet", status: "Transferred", sourceRef: "Screenshot_20260926_234601_Chrome.jpg line My Wallet 06:11" },
];

describe("a credit line's own screen", () => {
  const read = readProposals({ proposals: fromModel }, reference, "2026-09-26", { note: "Maya credit", readings });

  it("becomes one borrowing per day, with its fees added, not six cards", () => {
    expect(read.proposals).toHaveLength(2);
    for (const p of read.proposals) {
      expect(p.draft).toMatchObject({ flow: "Debt", debtEffect: "draw", item: "Maya Credit", toWallet: "Maya", amount: 200000, charges: 15103 });
    }
    expect(read.proposals.map((p) => p.draft.date).sort()).toEqual(["2026-09-18", "2026-09-20"]);
  });

  it("puts the ₱123.00 back to the ₱1.23 the picture shows, and says so", () => {
    const sept20 = read.proposals.find((p) => p.draft.date === "2026-09-20")!;
    expect(sept20.adjustments.join(" ")).toContain("Read as PHP 123.00, but the picture shows PHP 1.23");
    expect(sept20.confidence).toBe("low");
  });

  it("files a fee with no line on the line the owner named", () => {
    const loose = readProposals(
      { proposals: [{ flow: "Spending", item: "", description: "Service Fee", amountPesos: 149.8, date: "2026-09-20", fromWallet: "Maya" }] },
      reference,
      "2026-09-26",
      { note: "this is my maya credit" },
    );
    expect(loose.proposals[0]!.draft).toMatchObject({ flow: "Debt", debtEffect: "charge", item: "Maya Credit", fromWallet: "" });
  });

  it("leaves an ordinary transfer alone when no credit line is named", () => {
    const plain = readProposals(
      { proposals: [{ flow: "Transfer", fromWallet: "Maya", toWallet: "Gcash", amountPesos: 500, date: "2026-09-20", description: "Sent to my Gcash" }] },
      reference,
      "2026-09-26",
      { note: "moved money" },
    );
    expect(plain.proposals[0]!.draft).toMatchObject({ flow: "Transfer", fromWallet: "Maya", toWallet: "Gcash" });
  });

  it("never changes an amount the picture does show, or one with no near match", () => {
    const fine = readProposals({ proposals: [fromModel[1]] }, reference, "2026-09-26", { note: "", readings });
    expect(fine.proposals[0]!.draft.amount).toBe(14980);
    const odd = readProposals({ proposals: [{ ...fromModel[1], amountPesos: 77 }] }, reference, "2026-09-26", { note: "", readings });
    expect(odd.proposals[0]!.draft.amount).toBe(7700);
  });
});
