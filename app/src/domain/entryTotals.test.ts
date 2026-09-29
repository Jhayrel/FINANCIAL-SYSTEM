/**
 * A total and its parts, in one typed message (`entryTotals.ts`).
 *
 * The owner, 29 September 2026: "I paid 450, 300 for honorarium for capstone
 * and 150 for my donation for capstone. All school category basically 300
 * and 150 total of 450" became three cards, ₱450.00, ₱150.00 and ₱150.00,
 * for ₱450.00 spent. "make sure it knows logic too, i keep explaining this".
 * These pin that the parts are the entries, the total is not, a sentence
 * that says it all again is not, and what it says about all of them is kept.
 */

import { describe, expect, it } from "vitest";

import { emptyDraft, type Draft } from "./entry";
import { namedIn, readTotals, totalWords, withSaidItem, withoutTheTotal, withoutTotals } from "./entryTotals";
import { formatMoney } from "./money";
import { readEntry, splitEntries } from "./readEntry";
import type { ReferenceLists } from "./types";
import { clauseFor, verifyReading } from "./verify";

const ASOF = "2026-09-29";
const OWNER =
  "I paid 450, 300 for honorarium for capstone and 150 for my donation for capstone. All school category basically 300 and 150 total of 450";

const reference: ReferenceLists = {
  wallets: ["Maya", "Gcash", "Cash"],
  savings: ["Maya Bank"],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [
    { name: "Food", remark: "" },
    { name: "School", remark: "" },
    { name: "Gas", remark: "" },
  ],
  credits: ["Maya Credit"],
};

describe("the owner's message", () => {
  const read = readTotals(OWNER);

  it("reads 450 as the total of 300 and 150", () => {
    expect(read.total).toBe(45_000);
    expect(read.parts).toBe(45_000);
    expect(read.count).toBe(2);
  });

  it("leaves the sentence that says it all again out, and keeps its words", () => {
    expect(read.restated).toEqual(["All school category basically 300 and 150 total of 450"]);
    expect(namedIn(read.restated, reference.spendingTypes.map((t) => t.name))).toBe("School");
  });

  it("splits into the two payments, and no third", () => {
    const parts = splitEntries(OWNER);
    expect(parts).toHaveLength(2);
    const amounts = parts.map((p) => readEntry(p, [], reference, ASOF).draft.amount);
    expect(amounts).toEqual([30_000, 15_000]);
    expect(amounts.reduce((s, a) => (s ?? 0) + (a ?? 0), 0)).toBe(45_000);
  });

  it("checks each card against its own clause, without the total", () => {
    expect(clauseFor(OWNER, 30_000, reference)).toBe("I paid 300 for honorarium for capstone");
    const draft: Draft = { ...emptyDraft(ASOF), flow: "Spending", category: "Spending", item: "School", fromWallet: "Cash", amount: 30_000 };
    const findings = verifyReading(draft, clauseFor(OWNER, 30_000, reference), reference, ASOF).findings;
    expect(findings.filter((f) => f.check === "figure")).toEqual([]);
  });

  it("says the total was understood", () => {
    expect(totalWords(read, formatMoney)).toBe("₱450.00 is ₱300.00 and ₱150.00 together, so it is not an entry of its own.");
  });
});

describe("the ways a total is said", () => {
  it.each([
    ["300 for honorarium and 150 for donation, total 450", "300 for honorarium and 150 for donation"],
    ["300 for food and 150 for gas, 450 in total", "300 for food and 150 for gas"],
    ["Total 450: 300 food and 150 gas", "300 food and 150 gas"],
    ["Spent 1,000: 600 for groceries and 400 for gas", "Spent 600 for groceries and 400 for gas"],
    ["bought 2 pcs shirt 300 and 150 for socks, 450 lahat", "bought 2 pcs shirt 300 and 150 for socks"],
    ["on sept 29 I paid 300 for food and 150 for gas, all in all 450", "on sept 29 I paid 300 for food and 150 for gas"],
    ["sent 1000 to mom with 15 fee, total 1015", "sent 1000 to mom with 15 fee"],
  ])("%s", (said, left) => {
    expect(withoutTotals(said)).toBe(left);
  });

  it("keeps the lines of a list apart", () => {
    expect(withoutTotals("300 food\n150 gas\ntotal 450")).toBe("300 food\n150 gas");
    expect(splitEntries("300 food\n150 gas\ntotal 450")).toEqual(["300 food", "150 gas"]);
  });

  it("says when the parts do not come to the total given", () => {
    const read = readTotals("300 for food and 150 for gas, total of 460");
    expect(read.total).toBe(46_000);
    expect(read.parts).toBe(45_000);
    expect(totalWords(read, formatMoney)).toBe("You said ₱460.00 in all, but ₱300.00 and ₱150.00 come to ₱450.00. Check the amounts before adding them.");
  });
});

describe("what is not a total", () => {
  it.each([
    // Three payments that happen to add up: 450 has its own purpose.
    "I paid 450 for rent, 300 for food and 150 for load",
    // One figure, named a total, with nothing to be the total of.
    "I paid 450 total for school",
    // A first figure that is not the sum of the rest.
    "I paid 500, 300 for food and 150 for gas",
    // The same thing bought twice is two entries.
    "I paid 150 for load. Then I paid 150 for load again.",
  ])("%s", (said) => {
    expect(readTotals(said).total).toBeNull();
    expect(withoutTotals(said)).toBe(said);
  });

  it("does not take a date or a count for money", () => {
    expect(readTotals("on sept 29 I paid 300 for food and 150 for gas, 450 in total").parts).toBe(45_000);
    expect(readTotals("bought 2 pcs shirt 300 and 150 for socks, 450 lahat").count).toBe(2);
  });

  it("keeps a later sentence that is an entry of its own", () => {
    expect(readTotals("I paid 300 for food. I also paid spotify.").restated).toEqual([]);
    expect(readTotals("I paid 300 for food and 150 for gas. All school.").restated).toEqual(["All school."]);
  });
});

describe("cards from the model", () => {
  const card = (amount: number, fee = 0, item = "") => ({
    draft: { ...emptyDraft(ASOF), flow: "Spending" as const, category: "Spending" as const, item, fromWallet: "Cash", amount, fee },
  });

  it("drops a card that is only the total of the others", () => {
    const out = withoutTheTotal([card(45_000), card(30_000), card(15_000)], readTotals(OWNER));
    expect(out.dropped).toBe(true);
    expect(out.cards.map((c) => c.draft.amount)).toEqual([30_000, 15_000]);
  });

  it("keeps every card when they do not add up to it", () => {
    const out = withoutTheTotal([card(45_000), card(30_000), card(10_000)], readTotals(OWNER));
    expect(out.dropped).toBe(false);
    expect(out.cards).toHaveLength(3);
  });

  it("keeps two cards, which are the parts", () => {
    expect(withoutTheTotal([card(30_000), card(15_000)], readTotals(OWNER)).cards).toHaveLength(2);
  });

  it("files each spending card as the kind they said they all were", () => {
    expect(withSaidItem(card(15_000), "School").draft.item).toBe("School");
    const income = { draft: { ...card(15_000).draft, flow: "Revenue" as const, category: "Revenue" as const } };
    expect(withSaidItem(income, "School")).toBe(income);
    const same = card(30_000, 0, "School");
    expect(withSaidItem(same, "School")).toBe(same);
  });
});
