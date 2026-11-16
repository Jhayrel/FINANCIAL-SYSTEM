/**
 * An open card changed by saying it (owner, 27 October 2026, "Its struggling
 * in editing"): "Thats online buy load" with a Random necessities card open.
 */
import { describe, expect, it } from "vitest";
import { amend, kindLeading } from "./capture";
import { currentNotes } from "./cardNotes";
import { emptyDraft } from "./entry";

const reference = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: [],
  spendingTypes: [{ name: "Online Buy", remark: "" }, { name: "Online", remark: "" }, { name: "Random necessities", remark: "" }, { name: "Food", remark: "" }],
} as never;
const card = { ...emptyDraft("2026-10-27"), flow: "Spending" as const, category: "Spending" as const, item: "Random necessities", fromWallet: "Maya", amount: 1530, description: "TM 15" };

describe("the kind said with a word after it", () => {
  it("is the longest kind that starts the words", () => {
    expect(kindLeading("online buy load", ["Online", "Online Buy"])).toEqual({ item: "Online Buy", rest: "load" });
    expect(kindLeading("food", ["Food"])).toEqual({ item: "Food", rest: "" });
    expect(kindLeading("online buy load for my sister and mom", ["Online Buy"])).toBeNull();
  });

  it("changes the card's kind and keeps what was bought in the description", () => {
    const changed = amend(card as never, "Thats online buy load", reference, "2026-10-27");
    expect(changed?.draft.item).toBe("Online Buy");
    expect(changed?.draft.description).toBe("TM 15 load");
    expect(amend(card as never, "that's food", reference, "2026-10-27")?.draft.item).toBe("Food");
  });
});

describe("a card's notes, as the card reads now", () => {
  it("drops a Booked as note for a kind the card no longer has", () => {
    const notes = ["Booked as Random necessities, which you have used 767 times.", "From Maya, as the screen says.", "Booked as borrowing on Maya Credit, which is owed."];
    expect(currentNotes(notes, { item: "Online Buy" })).toEqual(["From Maya, as the screen says.", "Booked as borrowing on Maya Credit, which is owed."]);
    expect(currentNotes(notes, { item: "Random necessities" })).toEqual(notes);
  });
});

describe("notes the card has since answered", () => {
  const notes = [
    "Read as PHP 2,500.00, but the picture shows PHP 25.00. Using PHP 25.00: check it.",
    "Still needs one thing: the wallet it went to.",
    'A QR payment, and none of your accounts took in ₱25.00 around November 15, 2026, so it paid for something. Say what it was for, or "sent to someone".',
    "Booked as Food, which you have used 12 times.",
  ];
  it("go once the card says it: sent out of the accounts", () => {
    expect(currentNotes(notes, { item: "", flow: "Transfer", sentOut: true, toWallet: "" })).toEqual([notes[0]]);
  });
  it("and stay while it still lacks it", () => {
    expect(currentNotes(notes, { item: "", flow: "Spending", toWallet: "" })).toEqual(notes);
    expect(currentNotes(notes, { item: "Food", flow: "Spending" })).toEqual([notes[0], notes[1], notes[3]]);
    expect(currentNotes(["Still needs 2 things: the amount, the wallet it went to."], { item: "", flow: "Transfer", amount: 500, toWallet: "" })).toHaveLength(1);
    expect(currentNotes(["Still needs 2 things: the amount, the wallet it went to."], { item: "", flow: "Transfer", amount: 500, toWallet: "Cash" })).toHaveLength(0);
  });
});
