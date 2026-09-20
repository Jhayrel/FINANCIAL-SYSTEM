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
    category: "Spending",
    item: "Lunch",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    fromWallet: "Maya",
    toWallet: "",
    notes: "",
    status: "Paid" as const,
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
  /*
   * A category is the track a row is counted on, and the database refuses
   * every other value. This list offered the owner's spending types instead,
   * so a confident answer of "Food" was written into the field and the save
   * was refused. It is the track now, and only ever something that can be
   * saved.
   */
  it("offers the three tracks a spending row can be counted on", () => {
    const allowed = allowedCategories("Spending");

    expect(allowed.slice(0, 3)).toEqual(["Spending", "Bills", "Subscriptions"]);
    expect(allowed[allowed.length - 1]).toBe(UNSURE);
  });

  it("offers nothing to choose for revenue, which has one category", () => {
    expect(allowedCategories("Revenue")).toEqual(["Revenue"]);
    // Filing a bill as income is the exact mistake this app exists to undo.
    expect(allowedCategories("Revenue")).not.toContain("Bills");
  });

  it("offers only categories the database accepts", () => {
    const legal = new Set(["Revenue", "Spending", "Bills", "Subscriptions", "Transfer", "Opening", UNSURE]);
    for (const flow of ["Spending", "Revenue", "Opening", "Transfer", "Debt", ""] as const) {
      for (const c of allowedCategories(flow)) expect(legal.has(c), flow + ": " + c).toBe(true);
    }
  });

  it("offers nothing for flows the category does not apply to", () => {
    expect(allowedCategories("Transfer")).toEqual([]);
    expect(allowedCategories("Debt")).toEqual([]);
    expect(allowedCategories("")).toEqual([]);
  });

  it("never repeats a category, even if two lists both name it", () => {
    const allowed = allowedCategories("Spending");
    expect(new Set(allowed).size).toBe(allowed.length);
  });
});

describe("pastLabels", () => {
  it("returns the owner's own labels for this item, newest first", () => {
    const examples = pastLabels(
      [
        row({ date: "2026-01-01", item: "Grab", category: "Spending" }),
        row({ date: "2026-08-01", item: "Grab", category: "Bills" }),
      ],
      "Spending",
      "Grab",
    );

    expect(examples[0]).toEqual({ item: "Grab", category: "Bills" });
  });

  it("prefers exact matches over merely related ones", () => {
    const examples = pastLabels(
      [
        row({ date: "2026-08-01", item: "Jollibee lunch", category: "Bills" }),
        row({ date: "2026-01-01", item: "Lunch", category: "Spending" }),
      ],
      "Spending",
      "Lunch",
    );

    expect(examples[0]?.category).toBe("Spending");
  });

  it("keeps to the same flow, since revenue says nothing about spending", () => {
    const examples = pastLabels(
      [row({ item: "Lunch", category: "Revenue", type: "Revenue" })],
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
      [row({ item: "Lunch", category: "Bills" }), row({ item: "Lunch", category: "Bills" })],
    );

    expect(plan.kind).toBe("known");
    if (plan.kind === "known") {
      expect(plan.category).toBe("Bills");
      expect(plan.seen).toBe(2);
    }
  });

  it("asks when there is only one past entry, which is not a pattern", () => {
    const plan = categoryPlan(
      draft(),
      [row({ item: "Lunch", category: "Bills" })],
    );

    expect(plan.kind).toBe("ask");
  });

  it("asks when past entries disagree", () => {
    const plan = categoryPlan(
      draft(),
      [row({ item: "Lunch", category: "Bills" }), row({ item: "Lunch", category: "Subscriptions" })],
    );

    expect(plan.kind).toBe("ask");
  });

  it("stays quiet with no item, and on flows that have no category", () => {
    expect(categoryPlan(draft({ item: "" }), []).kind).toBe("not-yet");
    expect(categoryPlan(draft({ flow: "Transfer" }), []).kind).toBe("not-yet");
    // One possible answer is not a question: revenue is always Revenue.
    expect(categoryPlan(draft({ flow: "Revenue", item: "Allowance" }), []).kind).toBe("not-yet");
  });

  it("never proposes a category outside the allowed list", () => {
    const plan = categoryPlan(
      draft(),
      [
        row({ item: "Lunch", category: "Transfer" }),
        row({ item: "Lunch", category: "Transfer" }),
      ],
    );

    // Twice filed, but the category no longer exists, so it must be asked.
    expect(plan.kind).toBe("ask");
  });
});

describe("describeForCategory", () => {
  it("carries the item, the wallets and the past labels", () => {
    const fields = describeForCategory(
      draft(),
      [row({ item: "Lunch", category: "Bills" })],
    );

    expect(fields).toContain("Item: Lunch");
    expect(fields).toContain("From: Maya");
    expect(fields).toContain("Lunch -> Bills");
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
  const allowed = ["Spending", "Bills", "Subscriptions", UNSURE];

  it("accepts a category from the list", () => {
    expect(acceptCategory("Bills", "high", allowed)).toEqual({
      category: "Bills",
      confidence: "high",
    });
  });

  it("matches case-insensitively, since models vary the casing", () => {
    expect(acceptCategory("bills", "high", allowed).category).toBe("Bills");
  });

  it("refuses an invented category rather than letting it into the totals", () => {
    expect(acceptCategory("Groceries and Snacks", "high", allowed)).toEqual({
      category: UNSURE,
      confidence: "low",
    });
  });

  it("treats an unrecognised confidence as the weakest, never as none", () => {
    expect(acceptCategory("Bills", "very sure", allowed).confidence).toBe("low");
    expect(acceptCategory("Bills", "", allowed).confidence).toBe("low");
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
    expect(shouldApply({ category: "Bills", confidence: "high" })).toBe(true);
    expect(shouldApply({ category: "Bills", confidence: "medium" })).toBe(false);
    expect(shouldApply({ category: "Bills", confidence: "low" })).toBe(false);
  });

  it("never fills the field with the unsure value", () => {
    expect(shouldApply({ category: UNSURE, confidence: "high" })).toBe(false);
  });
});

describe("the feedback loop", () => {
  it("makes a correction improve the next answer, with no extra storage", () => {
    // The owner files "Grab" as Travel once. Not yet settled, so it is asked.
    const once = [row({ item: "Grab", category: "Bills" })];
    expect(categoryPlan(draft({ item: "Grab" }), once).kind).toBe("ask");

    // They file it the same way again. Now the ledger answers on its own, and
    // no model is asked. The correction was simply the saved row.
    const twice = [...once, row({ item: "Grab", category: "Bills" })];
    const plan = categoryPlan(draft({ item: "Grab" }), twice);

    expect(plan.kind).toBe("known");
    if (plan.kind === "known") expect(plan.category).toBe("Bills");
  });

  it("follows the owner when they change their mind", () => {
    const rows = [
      row({ date: "2026-01-01", item: "Grab", category: "Spending" }),
      row({ date: "2026-07-01", item: "Grab", category: "Bills" }),
      row({ date: "2026-08-01", item: "Grab", category: "Bills" }),
    ];

    const plan = categoryPlan(draft({ item: "Grab" }), rows);
    if (plan.kind !== "known") throw new Error("expected history to answer");
    expect(plan.category).toBe("Bills");
  });
});
