/**
 * What went wrong on 18 and 19 September, read out of the owner's record.
 *
 * A borrowing, a withdrawal with its fee and a treat, said in one message:
 * the fee became a charge on the credit line, the day became yesterday, the
 * treat's figure had to be asked for four times, "change the description"
 * changed nothing, and the saves the database refused vanished. The figures
 * here are changed from the owner's own; the shape is theirs.
 */

import { describe, expect, it } from "vitest";

import { amend, leftoverFigure } from "./capture";
import { readEditAsk } from "./chatChanges";
import { emptyDraft, type Draft } from "./entry";
import { REFERENCE, TODAY } from "./eval/corpus";
import { foldTransferFees, type Proposal } from "./proposal";
import type { Transaction } from "./types";
import { mergeUnsaved, unsavedLine, withoutSaved } from "./unsaved";
import { readEntry } from "./readEntry";
import { verifyReading } from "./verify";
import { saysWhen } from "./when";

const card = (over: Partial<Draft>): Proposal => ({
  draft: { ...emptyDraft("2026-09-18"), amount: 10000, ...over },
  confidence: "high",
  sourceRef: "the message",
  adjustments: [],
});

describe("a fee said with a withdrawal", () => {
  it("goes on the withdrawal, not on the credit line", () => {
    const withdrawal = card({ flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 120000, status: "Withdrawn", description: "withdraw 1200" });
    const fee = card({ flow: "Debt", debtId: "maya-credit", debtEffect: "charge", amount: 1500, description: "withdrawal fee" });
    const borrowed = card({ flow: "Debt", debtId: "maya-credit", debtEffect: "draw", amount: 250000, toWallet: "Maya" });
    const out = foldTransferFees([borrowed, withdrawal, fee]);
    expect(out).toHaveLength(2);
    expect(out[1]?.draft).toMatchObject({ flow: "Transfer", amount: 120000, fee: 1500 });
    expect(out[1]?.adjustments.join(" ")).toContain("fee on this withdrawal");
  });

  it("leaves the lender's own fees on the credit line", () => {
    const withdrawal = card({ flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 120000 });
    const lender = card({ flow: "Debt", debtId: "maya-credit", debtEffect: "charge", amount: 2265, description: "service fee" });
    expect(foldTransferFees([withdrawal, lender])).toHaveLength(2);
  });
});

describe("the day a message names", () => {
  it("knows a message that names no day, which is today's", () => {
    expect(saysWhen("I received 2500 from maya credit and I withdraw 1200 and 15 fee")).toBe(false);
    expect(saysWhen("I paid 300 yesterday")).toBe(true);
    expect(saysWhen("bayad kahapon 200")).toBe(true);
    expect(saysWhen("groceries on sep 12")).toBe(true);
    expect(saysWhen("paid rent 9/1")).toBe(true);
    expect(saysWhen("I may pay 300")).toBe(false);
  });
});

describe("the figure left in the message", () => {
  const said = "I received 2500 from maya credit and I withdraw 1200 and 15 fee then I spend 750 in treating my friend";

  it("answers the question from the message when one figure is left and the fee is not it", () => {
    expect(leftoverFigure(said, [250000, 120000, 1500])).toBe(75000);
    // Before the fee was on the withdrawal, the fee is still never the answer.
    expect(leftoverFigure(said, [250000, 120000, 0])).toBe(75000);
  });

  it("asks when two could be meant, or none is left", () => {
    expect(leftoverFigure(said, [250000])).toBeNull();
    expect(leftoverFigure("add it", [])).toBeNull();
  });
});

describe("changing the description", () => {
  const open = { ...emptyDraft(TODAY), flow: "Spending" as const, category: "Spending" as const, item: "Food", description: "pagkain sa 711", amount: 50000, fromWallet: "Cash" };

  it("changes the card's description, and leaves the item alone", () => {
    expect(amend(open, "change the description to Buy food", REFERENCE, TODAY)?.draft).toMatchObject({ description: "Buy food", item: "Food" });
    expect(amend(open, "description: lunch with Ana on Monday", REFERENCE, TODAY)?.draft.description).toBe("lunch with Ana on Monday");
  });

  it("reads the same words as a change to a saved entry's description, not its item", () => {
    expect(readEditAsk("change the description of #0532 to Buy food", REFERENCE, TODAY)?.change).toEqual({ description: "Buy food" });
  });
});

describe("a number that names a shop or a product", () => {
  it("is not the amount, and is not flagged as one", () => {
    const read = readEntry("bumili ako ng pagkain 500 cash sa 711", [], REFERENCE, TODAY);
    expect(read.draft.amount).toBe(50000);
    const checked = verifyReading(read.draft, "bumili ako ng pagkain 500 cash sa 711", REFERENCE, TODAY);
    expect(checked.notes.join(" ")).not.toContain("711");

    // The owner's own item with a number in it: "Microsoft Office 365" is not ₱365.00.
    const subs = { ...REFERENCE, subscriptions: [...REFERENCE.subscriptions, "Microsoft Office 365"] };
    const paid = readEntry("I paid my microsoft office 365 from gcash 249", [], subs, TODAY);
    expect(paid.draft.amount).toBe(24900);
    expect(verifyReading(paid.draft, "I paid my microsoft office 365 from gcash 249", subs, TODAY).notes.join(" ")).not.toContain("365");
  });
});

describe("entries the database refused", () => {
  const row = (id: string, amount: number): Transaction => ({
    id,
    recordNumber: 1,
    date: "2026-09-19",
    type: "Debt",
    fromWallet: "",
    toWallet: "Maya",
    category: "",
    item: "Maya Credit",
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Received",
    debtId: "maya-credit",
    debtEffect: "draw",
  });

  it("keeps each refused row once, and lets go of what the database now has", () => {
    const kept = mergeUnsaved([row("a", 100)], [row("a", 100), row("b", 200)]);
    expect(kept.map((t) => t.id)).toEqual(["a", "b"]);
    expect(withoutSaved(kept, [row("a", 100)]).map((t) => t.id)).toEqual(["b"]);
    expect(unsavedLine(row("b", 250000))).toBe("September 19, 2026, Debt, Maya Credit, ₱2,500.00");
  });
});
