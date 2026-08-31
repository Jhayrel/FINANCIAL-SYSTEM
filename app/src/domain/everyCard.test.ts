/**
 * A correction aimed at every card.
 *
 * ── The sentences ─────────────────────────────────────────────────────────
 *
 *   09:04:44  "make this all 2026 and just populate them to the missing
 *              I used maya"
 *   09:31:03  "edit them 2026 and make also I use maya to all"
 *
 * A screenshot of a statement produces one card per line, all from the same
 * account and often all needing the same year. Both sentences say so, and
 * both changed exactly one card. The assistant's record holds one correction
 * for that entire session, `fromWallet: Cash to Maya`, against eleven cards
 * on screen.
 *
 * The quantifier is the whole signal and it has to be present: reading "make
 * it 300" as "make them all 300" would silently rewrite ten amounts nobody
 * looked at.
 */

import { describe, expect, it } from "vitest";

import { addressesEveryCard, amend } from "./capture";
import { emptyDraft } from "./entry";
import type { Draft } from "./entry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "Meals, snacks, drinks" }],
};

const ASOF = "2026-08-31";

describe("naming every card", () => {
  it("recognises the two sentences that changed one card each", () => {
    expect(addressesEveryCard("edit them 2026 and make also I use maya to all")).toBe(true);
    expect(addressesEveryCard("make this all 2026")).toBe(true);
  });

  it("recognises the ordinary ways of saying it", () => {
    for (const said of [
      "maya for all",
      "make them all 300",
      "2026 for every one",
      "cash for each",
      "change them to gcash",
      "all of these are maya",
    ]) {
      expect(addressesEveryCard(said), said).toBe(true);
    }
  });

  /**
   * One card is the default and must stay the default.
   *
   * The cost of reading a single correction as a bulk one is ten amounts
   * changed on cards nobody was looking at, on a screen about money.
   */
  it("does not fire on a correction to one card", () => {
    for (const said of ["make it 300", "gcash", "food", "2026", "change the date"]) {
      expect(addressesEveryCard(said), said).toBe(false);
    }
  });

  it("does not fire on a long sentence that happens to say all", () => {
    expect(
      addressesEveryCard(
        "I went to the shop and paid for all of the groceries and then walked home again",
      ),
    ).toBe(false);
  });
});

describe("the amendment is worked out per card, not copied", () => {
  const card = (over: Partial<Draft>): Draft => ({
    ...emptyDraft("2026-08-31"),
    flow: "Spending",
    category: "Spending",
    item: "Food",
    amount: 10000,
    ...over,
  });

  /**
   * "2026" means a different date on every card.
   *
   * The year changes and the day does not, so copying one card's corrected
   * date onto the rest would move every entry to the same day. That is why
   * `amend` runs per card rather than once.
   */
  it("keeps each card's own day when the year is corrected", () => {
    const a = amend(card({ date: "2022-10-07" }), "make them all 2026", reference, ASOF);
    const b = amend(card({ date: "2024-01-06" }), "make them all 2026", reference, ASOF);
    expect(a?.draft.date).toBe("2026-10-07");
    expect(b?.draft.date).toBe("2026-01-06");
  });

  it("puts the same wallet on each of them", () => {
    const a = amend(card({ fromWallet: "Cash" }), "maya for all", reference, ASOF);
    const b = amend(card({ fromWallet: "" }), "maya for all", reference, ASOF);
    expect(a?.draft.fromWallet).toBe("Maya");
    expect(b?.draft.fromWallet).toBe("Maya");
  });

  /** A card the sentence does not apply to returns null and is left alone. */
  it("leaves a card the correction does not touch", () => {
    expect(amend(card({}), "not a correction at all thank you", reference, ASOF)).toBeNull();
  });
});
