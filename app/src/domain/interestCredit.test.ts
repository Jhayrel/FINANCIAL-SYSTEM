/**
 * A bank's interest credit (`interestCredit.ts`, `proposal.ts` checkInterest).
 *
 * The owner, 28 September 2026, with a Maya "Net boosted interest" screen:
 * "make it able to read this". The readings below are what the device's
 * own reader made of that screen. Every interest row the owner has entered
 * is the net amount, Revenue, Bank interest, into Maya Bank (Personal
 * savings), and that is what the screen must become.
 */

import { describe, expect, it } from "vitest";

import { accountFor, interestNote, readInterestCredit } from "./interestCredit";
import { checkInterest, type Proposal } from "./proposal";
import { emptyDraft } from "./entry";
import type { ReferenceLists } from "./types";

const raised =
  "21:02 69%\nWet poostied INLerest X\n₱0.15\nMy Savings\nv Completed 28 Sep 2026, 09:53 am\nShare Get help\nTotal interest earned ₱0.19\nMaya XP Pro: Bonus 0.50%\np.a\nBonus 2% p.a.\nBonus 1% p.a.\nWithholding tax -₱0.04\n20% of total interest earned\nUpdated balance\nmaya";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: ["Allowance (Reserve)", "Extra Cash", "Maya Bank (Personal savings)"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Random", "Allowance", "Bank interest", "Framelink"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

describe("reading an interest credit", () => {
  const credit = readInterestCredit([raised]);

  it("finds what arrived: earned less the tax, as the screen prints it", () => {
    expect(credit).toMatchObject({ net: 15, gross: 19, tax: 4, date: "2026-09-28", bank: "Maya", account: "My Savings", confidence: "high" });
  });

  it("puts it in the owner's savings account at that bank", () => {
    expect(accountFor(credit!, reference.savings)).toBe("Maya Bank (Personal savings)");
  });

  it("tells the model it is one row, and what the other figures are", () => {
    const note = interestNote(credit!);
    expect(note).toContain("amountPesos 0.15");
    expect(note).toContain("item Bank interest");
    expect(note).toContain("PHP 0.04 is the withholding tax");
  });

  it("leaves a credit line's interest alone: that is owed, not earned", () => {
    expect(readInterestCredit(["Maya Credit\nTotal interest ₱188.79\nAmount due ₱2,688.79\nDue date 06 Oct 2026"])).toBeNull();
  });

  it("leaves a list of many movements to the list rules", () => {
    const list = Array.from({ length: 8 }, (_, i) => `Sep ${i + 1} Interest earned ₱0.${10 + i}`).join("\n");
    expect(readInterestCredit([list])).toBeNull();
  });
});

describe("holding the model's cards to it", () => {
  const credit = readInterestCredit([raised])!;
  const card = (over: Partial<Proposal["draft"]>): Proposal => ({
    draft: { ...emptyDraft("2026-09-28"), ...over },
    confidence: "medium",
    sourceRef: "Screenshot_Maya.jpg",
    adjustments: [],
  });

  it("makes the earned figure and the tax one Revenue of the net, into savings", () => {
    const out = checkInterest(
      [
        card({ flow: "Revenue", category: "Revenue", item: "Random", amount: 19, toWallet: "Maya", description: "Net boosted interest" }),
        card({ flow: "Spending", category: "Spending", item: "Food", amount: 4, fromWallet: "Maya", description: "Withholding tax" }),
      ],
      [credit],
      reference,
      "2026-09-28",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.draft).toMatchObject({ flow: "Revenue", category: "Revenue", item: "Bank interest", amount: 15, toWallet: "Maya Bank (Personal savings)", fromWallet: "", date: "2026-09-28" });
    expect(out[0]?.adjustments.join(" ")).toContain("Left out PHP 0.04");
  });

  it("makes the card itself when the model found nothing", () => {
    const out = checkInterest([], [credit], reference, "2026-09-28");
    expect(out[0]?.draft).toMatchObject({ flow: "Revenue", item: "Bank interest", amount: 15, toWallet: "Maya Bank (Personal savings)" });
  });

  it("leaves a right card as it is, and other rows alone", () => {
    const right = card({ flow: "Revenue", category: "Revenue", item: "Bank interest", amount: 15, toWallet: "Maya Bank (Personal savings)", description: "Interest earned" });
    const other = card({ flow: "Spending", category: "Spending", item: "Food", amount: 12_000, fromWallet: "Cash" });
    const out = checkInterest([right, other], [credit], reference, "2026-09-28");
    expect(out).toHaveLength(2);
    expect(out[0]?.draft.description).toBe("Interest earned");
    expect(out[0]?.adjustments).toEqual([]);
    expect(out[1]).toBe(other);
  });
});
