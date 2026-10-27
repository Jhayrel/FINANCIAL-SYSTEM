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
