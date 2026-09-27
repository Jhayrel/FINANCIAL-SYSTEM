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

describe("a borrowing with nowhere to land", () => {
  it("lands in the credit line's own wallet when the screen said My Wallet", () => {
    const read = readProposals(
      { proposals: [{ flow: "Debt", debt: "Maya Credit", debtEffect: "borrowed", toWallet: "My Wallet", amountPesos: 2000, date: "2026-09-20", time: "19:57" }] },
      reference,
      "2026-09-26",
      { note: "This is maya credit all in maya with fees" },
    );
    expect(read.proposals[0]!.draft).toMatchObject({ flow: "Debt", debtEffect: "draw", toWallet: "Maya", item: "Maya Credit" });
  });
});

/**
 * The same two borrowings in Maya's own history, sent with the credit screen
 * (27 September 2026): "Received money from Maya Credit" read as
 * "\viavag creqiy" and came back as income, PHP 4,000.00 of it.
 */
describe("a borrowing seen on both screens is one borrowing", () => {
  const walletSide = [
    { flow: "Revenue", item: "Random", toWallet: "Maya", amountPesos: 2000, date: "2026-09-20", description: "Reimbursed from work" },
    { flow: "Revenue", item: "Random", toWallet: "Maya", amountPesos: 2000, date: "2026-09-18", description: "Received money from \\viavag creqiy" },
    { flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amountPesos: 516, date: "2026-09-24", description: "Withdrawal from St.Louis College" },
  ];
  const read = readProposals({ proposals: [...fromModel, ...walletSide] }, reference, "2026-09-26", { note: "Maya credit", readings });

  it("keeps the two draws and drops the income they were read as", () => {
    const debt = read.proposals.filter((p) => p.draft.flow === "Debt");
    expect(debt).toHaveLength(2);
    expect(read.proposals.filter((p) => p.draft.flow === "Revenue")).toHaveLength(0);
    expect(debt.every((p) => p.adjustments.some((a) => a.includes("booked once, as borrowing")))).toBe(true);
  });

  it("leaves the withdrawal alone, with no lender fee on it", () => {
    const out = read.proposals.find((p) => p.draft.description.includes("St.Louis"));
    expect(out?.draft.fee).toBe(0);
    expect(out?.draft.amount).toBe(51600);
  });
});

describe("a receipt in another currency (21 September 2026)", () => {
  it("is never booked as pesos, and the card asks what it cost", () => {
    const read = readProposals(
      { proposals: [{ flow: "Spending", item: "Food", fromWallet: "Cash", amountText: "$154.06", amountPesos: 154.06, date: "2026-09-21", description: "East Repair Inc." }] },
      reference,
      "2026-09-26",
    );
    const card = read.proposals[0];
    expect(card?.draft.amount).toBeNull();
    expect(card?.confidence).toBe("low");
    expect(card?.adjustments.join(" ")).toContain("Say what it cost in pesos");
  });

  it("leaves a peso receipt alone", () => {
    const read = readProposals(
      { proposals: [{ flow: "Spending", item: "Food", fromWallet: "Cash", amountText: "₱154.06", amountPesos: 154.06, date: "2026-09-21" }] },
      reference,
      "2026-09-26",
    );
    expect(read.proposals[0]?.draft.amount).toBe(15406);
  });
});

describe("a category's name given as the item (27 September 2026)", () => {
  const withSubs: ReferenceLists = { ...reference, subscriptions: ["Spotify", "Microsoft Office 365"], bills: ["Globe at Home Wifi"] };

  it("files Microsoft 365 as the subscription it is", () => {
    const read = readProposals(
      { proposals: [{ flow: "Spending", category: "Spending", item: "Subscriptions", fromWallet: "Maya", amountPesos: 239, date: "2026-09-21", description: "Microsoft*Microsoft 365 P" }] },
      withSubs,
      "2026-09-27",
    );
    expect(read.proposals[0]?.draft).toMatchObject({ category: "Subscriptions", item: "Microsoft Office 365" });
  });

  it("leaves the item for the owner when the words name none on the list", () => {
    const read = readProposals(
      { proposals: [{ flow: "Spending", category: "Spending", item: "Bills", fromWallet: "Maya", amountPesos: 50, date: "2026-09-11", description: "Payment" }] },
      withSubs,
      "2026-09-27",
    );
    expect(read.proposals[0]?.draft).toMatchObject({ category: "Bills", item: "" });
  });
});
