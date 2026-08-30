/**
 * The load-bearing test here is the privacy one: whatever is sent for a
 * description must contain nothing the owner typed as prose. Everything else
 * is about not putting a paragraph into a one-line field.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { cleanDescription, describeFields, describePlan } from "./describe";
import type { Draft } from "./entry";

const fixture = loadFixture();

const draft = (over: Partial<Draft> = {}): Draft => ({
  flow: "Spending",
  date: "2026-08-30",
  fromWallet: "Maya",
  toWallet: "",
  category: "Food",
  item: "Lunch",
  description: "",
  amount: 15000,
  fee: 0,
  notes: "",
  status: "Paid",
  ...over,
});

describe("describePlan", () => {
  it("says nothing until there is an item to describe", () => {
    expect(describePlan(draft({ item: "" }), fixture.transactions).kind).toBe("not-yet");
    expect(describePlan(draft({ flow: "" }), fixture.transactions).kind).toBe("not-yet");
  });

  it("reuses the owner's own wording when the item has history", () => {
    // Pick an item that genuinely recurs in the real ledger.
    const seen = fixture.transactions.find(
      (t) => t.type === "Spending" && t.item && t.description.trim(),
    );
    expect(seen).toBeDefined();

    const plan = describePlan(
      draft({ flow: "Spending", item: seen!.item, category: seen!.category }),
      fixture.transactions,
    );

    expect(plan.kind).toBe("history");
  });

  it("asks the model only when history has nothing", () => {
    const plan = describePlan(
      draft({ item: "Zzz Never Bought This Before", category: "Food" }),
      fixture.transactions,
    );

    expect(plan.kind).toBe("model");
  });

  it("never sends free text, which is the whole reason for the split", () => {
    const plan = describePlan(
      draft({ item: "Zzz Never Bought This Before" }),
      fixture.transactions,
    );
    if (plan.kind !== "model") throw new Error("expected the model path");

    const known = new Set(
      [
        ...fixture.reference.wallets,
        ...fixture.reference.savings,
        ...fixture.reference.bills,
        ...fixture.reference.subscriptions,
        ...fixture.reference.revenueCategories,
        ...fixture.reference.spendingTypes.map((t) => t.name),
      ].map((n) => n.trim().toLowerCase()),
    );

    const freeText = fixture.transactions
      .map((t) => t.description.trim())
      .filter((d) => d.length > 12 && !known.has(d.toLowerCase()));

    expect(freeText.length).toBeGreaterThan(20);
    for (const d of freeText) {
      expect(plan.fields).not.toContain(d);
    }
  });

  it("does not send the notes field either", () => {
    const plan = describePlan(
      draft({ item: "Zzz New Thing", notes: "SECRET-NOTE-CONTENT" }),
      fixture.transactions,
    );
    if (plan.kind !== "model") throw new Error("expected the model path");

    expect(plan.fields).not.toContain("SECRET-NOTE-CONTENT");
  });

  it("does not send a description already typed", () => {
    const plan = describePlan(
      draft({ item: "Zzz New Thing", description: "SECRET-DESCRIPTION" }),
      fixture.transactions,
    );
    if (plan.kind !== "model") throw new Error("expected the model path");

    expect(plan.fields).not.toContain("SECRET-DESCRIPTION");
  });
});

describe("describeFields", () => {
  it("carries the fields a description can be built from", () => {
    const fields = describeFields(draft());

    expect(fields).toContain("Flow: Spending");
    expect(fields).toContain("Category: Food");
    expect(fields).toContain("Item: Lunch");
    expect(fields).toContain("From: Maya");
    expect(fields).toContain("PHP 150.00");
  });

  it("leaves out what has not been chosen yet", () => {
    const fields = describeFields(draft({ toWallet: "", amount: null, category: "" }));

    expect(fields).not.toContain("To:");
    expect(fields).not.toContain("Amount:");
    expect(fields).not.toContain("Category:");
  });
});

describe("cleanDescription", () => {
  it("strips the preamble models put in front of a short answer", () => {
    expect(cleanDescription("Here is a description: Lunch at Jollibee")).toBe(
      "Lunch at Jollibee",
    );
    expect(cleanDescription("Suggested description: Grab ride home")).toBe("Grab ride home");
  });

  it("strips the quotes models wrap short answers in", () => {
    expect(cleanDescription('"Lunch at Jollibee"')).toBe("Lunch at Jollibee");
    expect(cleanDescription("\u201cGrab ride home\u201d")).toBe("Grab ride home");
  });

  it("keeps one line, because the field is one line", () => {
    expect(cleanDescription("Lunch at Jollibee\n\nThis is because you often...")).toBe(
      "Lunch at Jollibee",
    );
  });

  it("caps the length rather than filling the field with a sentence", () => {
    const long = "One two three four five six seven eight nine ten";
    expect(cleanDescription(long).split(" ")).toHaveLength(7);
  });

  it("drops a trailing full stop, which reads wrong in a cell", () => {
    expect(cleanDescription("Lunch at Jollibee.")).toBe("Lunch at Jollibee");
  });

  it("survives an empty or useless answer", () => {
    expect(cleanDescription("")).toBe("");
    expect(cleanDescription("   ")).toBe("");
  });

  it("leaves a good short answer exactly as it is", () => {
    expect(cleanDescription("Lunch at Jollibee")).toBe("Lunch at Jollibee");
  });
});
