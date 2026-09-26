/**
 * A card is checked against its own clause, not the whole paragraph.
 *
 * From the owner's screen on 20 September 2026: two food cards out of one
 * message, both carrying "You named School but this was read as Food",
 * because the message mentioned walking to school and both cards were
 * verified against all of it.
 */

import { describe, expect, it } from "vitest";

import { clauseFor, verifyReading } from "./verify";
import type { Draft } from "./entry";
import type { ReferenceLists } from "./types";

const reference: ReferenceLists = {
  wallets: ["Gcash", "Maya", "Cash"],
  savings: ["Maya Bank (Personal savings)"],
  spendingTypes: [
    { name: "Food", remark: "" },
    { name: "School", remark: "" },
    { name: "Gas", remark: "" },
  ],
  revenueCategories: ["Allowance"],
  bills: [],
  subscriptions: [],
  credits: [],
};

const THE_MESSAGE =
  "This morning I withdrew a thousand pesos from my Maya account into cash, and the bank charged me fifteen pesos for the withdrawal. On the way to school I bought breakfast for a hundred and twenty pesos using that cash, and at lunch I spent two hundred and fifty more at the canteen.";

const spending = (over: Partial<Draft>): Draft =>
  ({
    flow: "Spending",
    date: "2026-09-20",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 12000,
    fee: 0,
    notes: "",
    status: "Paid",
    ...over,
  }) as Draft;

describe("the clause a card came from", () => {
  it("gives the whole thing back when there is only one clause", () => {
    const one = "I paid 250 for food from gcash";
    expect(clauseFor(one, 25000, reference)).toBe(one);
  });

  it("picks the clause holding this figure, written in words", () => {
    expect(clauseFor(THE_MESSAGE, 12000, reference)).toContain("breakfast");
    expect(clauseFor(THE_MESSAGE, 12000, reference)).not.toContain("canteen");

    expect(clauseFor(THE_MESSAGE, 25000, reference)).toContain("canteen");
    expect(clauseFor(THE_MESSAGE, 25000, reference)).not.toContain("breakfast");
  });

  it("picks the clause holding this figure, written in digits", () => {
    const said = "I paid 500 for food from gcash, then 300 for gas from cash";
    expect(clauseFor(said, 50000, reference)).toContain("food");
    expect(clauseFor(said, 30000, reference)).toContain("gas");
  });

  /*
   * Saying nothing is the point. The sentence checks all skip on "", which
   * is the right answer when the words cannot be pinned to this row: a
   * question asked of somebody else's clause is worse than no question.
   */
  it("says nothing rather than guess when the figure is in two clauses", () => {
    expect(clauseFor("I paid 250 for food and 250 for gas", 25000, reference)).toBe("");
  });

  it("says nothing when no clause holds the figure", () => {
    expect(clauseFor("I paid 500 for food, then 300 for gas", 99900, reference)).toBe("");
  });

  it("is empty for an empty message, as a photo is", () => {
    expect(clauseFor("", 12000, reference)).toBe("");
  });
});

describe("the warning that was on the wrong card", () => {
  it("no longer says School about the breakfast", () => {
    const breakfast = spending({ amount: 12000, description: "breakfast" });
    const notes = verifyReading(
      breakfast,
      clauseFor(THE_MESSAGE, breakfast.amount, reference),
      reference,
      "2026-09-20",
      "high",
    ).notes;
    expect(notes.join(" ")).not.toContain("School");
  });

  it("no longer says School about the lunch", () => {
    const lunch = spending({ amount: 25000, description: "lunch at the canteen" });
    const notes = verifyReading(
      lunch,
      clauseFor(THE_MESSAGE, lunch.amount, reference),
      reference,
      "2026-09-20",
      "high",
    ).notes;
    expect(notes.join(" ")).not.toContain("School");
  });

  /*
   * The check still has to work. One sentence naming one item that is not
   * the one on the row is exactly what it is for.
   */
  it("still says it when the clause really does name another item", () => {
    const said = "I paid 250 for school supplies from cash";
    const row = spending({ amount: 25000, item: "Food" });
    const notes = verifyReading(row, clauseFor(said, row.amount, reference), reference, "2026-09-20", "high").notes;
    expect(notes.join(" ")).toContain("School");
  });
});
