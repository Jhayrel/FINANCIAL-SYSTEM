/**
 * A wrong category is the quietest bug this app can have: it does not look
 * like an error, it looks like a fact, and it moves a figure in every report
 * that groups by category. So most of these tests are about refusing to
 * answer rather than answering.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import {
  acceptCategory,
  allowedCategories,
  categoryPlan,
  describeForCategory,
  pastLabels,
  shouldApply,
  UNSURE,
} from "./categorise";
import type { Draft } from "./entry";
import type { Transaction } from "./types";

const fixture = loadFixture();

let seq = 0;
const row = (over: Partial<Transaction>): Transaction => {
  seq += 1;
  return {
    id: `c${seq}`,
    recordNumber: seq,
    date: "2026-08-01",
    type: "Spending",
    category: "Food",
    item: "Lunch",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    fromWallet: "Maya",
    toWallet: "",
    status: "Paid",
    ...over,
  };
};

const draft = (over: Partial<Draft> = {}): Draft => ({
  flow: "Spending",
  date: "2026-08-30",
  fromWallet: "Maya",
  toWallet: "",
  category: "",
  item: "Lunch",
  description: "",
  amount: 10000,
  fee: 0,
  notes: "",
  status: "Paid",
  ...over,
});

describe("allowedCategories", () => {
  it("offers spending types plus the recurring buckets, for spending", () => {
    const allowed = allowedCategories("Spending", fixture.reference);

    expect(allowed).toContain("Bills");
    expect(allowed).toContain("Subscriptions");
    expect(allowed[allowed.length - 1]).toBe(UNSURE);
  });

  it("offers revenue categories, for revenue", () => {
    const allowed = allowedCategories("Revenue", fixture.reference);

    expect(allowed.length).toBeGreaterThan(1);
    // Filing a bill as income is the exact mistake this app exists to undo.
    expect(allowed).not.toContain("Bills");
  });

  it("offers nothing for flows the category does not apply to", () => {
    expect(allowedCategories("Transfer", fixture.reference)).toEqual([]);
    expect(allowedCategories("Debt", fixture.reference)).toEqual([]);
    expect(allowedCategories("", fixture.reference)).toEqual([]);
  });

  it("never repeats a category, even if two lists both name it", () => {
    const allowed = allowedCategories("Spending", fixture.reference);
    expect(new Set(allowed).size).toBe(allowed.length);
  });
});

describe("pastLabels", () => {
  it("returns the owner's own labels for this item, newest first", () => {
    const examples = pastLabels(
      [
        row({ date: "2026-01-01", item: "Grab", category: "Travel" }),
        row({ date: "2026-08-01", item: "Grab", category: "Fun" }),
      ],
      "Spending",
      "Grab",
    );

    expect(examples[0]).toEqual({ item: "Grab", category: "Fun" });
  });

  it("prefers exact matches over merely related ones", () => {
    const examples = pastLabels(
      [
        row({ date: "2026-08-01", item: "Jollibee lunch", category: "Treat" }),
        row({ date: "2026-01-01", item: "Lunch", category: "Food" }),
      ],
      "Spending",
      "Lunch",
    );

    expect(examples[0]?.category).toBe("Food");
  });

  it("keeps to the same flow, since revenue says nothing about spending", () => {
    const examples = pastLabels(
      [row({ item: "Lunch", category: "Salary", type: "Revenue" })],
      "Spending",
      "Lunch",
    );

    expect(examples).toEqual([]);
  });

  it("says nothing when there is nothing to say", () => {
    expect(pastLabels([], "Spending", "Lunch")).toEqual([]);
    expect(pastLabels(fixture.transactions, "Spending", "")).toEqual([]);
  });
});

describe("categoryPlan", () => {
  it("answers from history when the item has been filed twice the same way", () => {
    const plan = categoryPlan(
      draft(),
      [row({ item: "Lunch", category: "Food" }), row({ item: "Lunch", category: "Food" })],
      fixture.reference,
    );

    expect(plan.kind).toBe("known");
    if (plan.kind === "known") {
      expect(plan.category).toBe("Food");
      expect(plan.seen).toBe(2);
    }
  });

  it("asks when there is only one past entry, which is not a pattern", () => {
    const plan = categoryPlan(
      draft(),
      [row({ item: "Lunch", category: "Food" })],
      fixture.reference,
    );

    expect(plan.kind).toBe("ask");
  });

  it("asks when past entries disagree", () => {
    const plan = categoryPlan(
      draft(),
      [row({ item: "Lunch", category: "Food" }), row({ item: "Lunch", category: "Treat" })],
      fixture.reference,
    );

    expect(plan.kind).toBe("ask");
  });

  it("stays quiet with no item, and on flows that have no category", () => {
    expect(categoryPlan(draft({ item: "" }), [], fixture.reference).kind).toBe("not-yet");
    expect(categoryPlan(draft({ flow: "Transfer" }), [], fixture.reference).kind).toBe("not-yet");
  });

  it("never proposes a category outside the allowed list", () => {
    const plan = categoryPlan(
      draft(),
      [
        row({ item: "Lunch", category: "Something Deleted" }),
        row({ item: "Lunch", category: "Something Deleted" }),
      ],
      fixture.reference,
    );

    // Twice filed, but the category no longer exists, so it must be asked.
    expect(plan.kind).toBe("ask");
  });
});

describe("describeForCategory", () => {
  it("carries the item, the wallets and the past labels", () => {
    const fields = describeForCategory(
      draft(),
      [row({ item: "Lunch", category: "Food" })],
    );

    expect(fields).toContain("Item: Lunch");
    expect(fields).toContain("From: Maya");
    expect(fields).toContain("Lunch -> Food");
  });

  it("never sends free text, the same boundary as describe.ts", () => {
    const fields = describeForCategory(
      draft({ description: "SECRET-DESCRIPTION", notes: "SECRET-NOTE" }),
      fixture.transactions,
    );

    expect(fields).not.toContain("SECRET-DESCRIPTION");
    expect(fields).not.toContain("SECRET-NOTE");

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
    for (const d of freeText) expect(fields).not.toContain(d);
  });
});

describe("acceptCategory", () => {
  const allowed = ["Food", "Travel", "Bills", UNSURE];

  it("accepts a category from the list", () => {
    expect(acceptCategory("Food", "high", allowed)).toEqual({
      category: "Food",
      confidence: "high",
    });
  });

  it("matches case-insensitively, since models vary the casing", () => {
    expect(acceptCategory("food", "high", allowed).category).toBe("Food");
  });

  it("refuses an invented category rather than letting it into the totals", () => {
    expect(acceptCategory("Groceries and Snacks", "high", allowed)).toEqual({
      category: UNSURE,
      confidence: "low",
    });
  });

  it("treats an unrecognised confidence as the weakest, never as none", () => {
    expect(acceptCategory("Food", "very sure", allowed).confidence).toBe("low");
    expect(acceptCategory("Food", "", allowed).confidence).toBe("low");
  });

  it("keeps an unsure answer unsure even when the model claims otherwise", () => {
    expect(acceptCategory(UNSURE, "high", allowed)).toEqual({
      category: UNSURE,
      confidence: "low",
    });
  });
});

describe("shouldApply", () => {
  it("fills the field only on a confident answer", () => {
    expect(shouldApply({ category: "Food", confidence: "high" })).toBe(true);
    expect(shouldApply({ category: "Food", confidence: "medium" })).toBe(false);
    expect(shouldApply({ category: "Food", confidence: "low" })).toBe(false);
  });

  it("never fills the field with the unsure value", () => {
    expect(shouldApply({ category: UNSURE, confidence: "high" })).toBe(false);
  });
});

describe("the feedback loop", () => {
  it("makes a correction improve the next answer, with no extra storage", () => {
    // The owner files "Grab" as Travel once. Not yet settled, so it is asked.
    const once = [row({ item: "Grab", category: "Travel" })];
    expect(categoryPlan(draft({ item: "Grab" }), once, fixture.reference).kind).toBe("ask");

    // They file it the same way again. Now the ledger answers on its own, and
    // no model is asked. The correction was simply the saved row.
    const twice = [...once, row({ item: "Grab", category: "Travel" })];
    const plan = categoryPlan(draft({ item: "Grab" }), twice, fixture.reference);

    expect(plan.kind).toBe("known");
    if (plan.kind === "known") expect(plan.category).toBe("Travel");
  });

  it("follows the owner when they change their mind", () => {
    const rows = [
      row({ date: "2026-01-01", item: "Grab", category: "Travel" }),
      row({ date: "2026-07-01", item: "Grab", category: "Fun" }),
      row({ date: "2026-08-01", item: "Grab", category: "Fun" }),
    ];

    const plan = categoryPlan(draft({ item: "Grab" }), rows, fixture.reference);
    if (plan.kind !== "known") throw new Error("expected history to answer");
    expect(plan.category).toBe("Fun");
  });
});
