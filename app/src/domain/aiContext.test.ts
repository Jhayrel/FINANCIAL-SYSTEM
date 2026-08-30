/**
 * What the AI is allowed to see.
 *
 * These are privacy tests before they are correctness tests. The important
 * ones assert what is ABSENT: no descriptions, no notes, no raw rows. If one
 * of those starts failing, the boundary has moved and someone's ledger is
 * going somewhere it was not going before.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { buildContext, contextSize, contextToText, type ContextInput } from "./aiContext";
import type { Account } from "./accounts";

const fixture = loadFixture();
const AS_OF = "2026-08-29";

const accounts: Account[] = [
  { id: "gcash", name: "Gcash", kind: "spending", archived: false },
  { id: "maya", name: "Maya", kind: "spending", archived: false },
  { id: "cash", name: "Cash", kind: "spending", archived: false, channel: "cash" },
  { id: "extra", name: "Extra Cash", kind: "savings", archived: false },
  { id: "gone", name: "Hidden cash (fieldtrip)", kind: "reserve", archived: true },
];

const input: ContextInput = {
  transactions: fixture.transactions,
  accounts,
  budgets: fixture.budgets,
  credits: [],
  reference: fixture.reference,
  lowBalanceThreshold: 50000,
  asOf: AS_OF,
};

const context = buildContext(input);
const text = contextToText(context);

describe("what it refuses to send", () => {
  it("sends no transaction descriptions", () => {
    // These are real descriptions from the ledger. None may appear.
    for (const phrase of [
      "Give 2000 to my father",
      "Send to my classmate",
      "Eat at SFC night market with my friend",
      "Buy Alcohol, Anti Dandruff Shampoo",
      "Treat my cousins at beach",
    ]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("sends no notes", () => {
    const notes = fixture.transactions.map((t) => t.notes).filter((n) => n.trim().length > 8);
    for (const note of notes) expect(text).not.toContain(note);
  });

  it("sends no raw rows, whatever the ledger size", () => {
    // 441 rows would be far larger than this. A summary must stay a summary.
    expect(contextSize(context)).toBeLessThan(4000);
  });

  it("carries no record numbers, so a row cannot be identified", () => {
    expect(text).not.toMatch(/#\d{4}/);
  });

  it("names no archived account, which is history rather than a live position", () => {
    expect(text).not.toContain("Hidden cash (fieldtrip)");
  });
});

describe("what it does send", () => {
  it("names the month and what is left of it", () => {
    expect(context.month.name).toBe("August 2026");
    expect(context.month.daysLeft).toBe(3);
  });

  it("sends money as pesos, not centavos, because a model reads it better", () => {
    expect(context.month.spent).toBeCloseTo(11291.37, 2);
    expect(text).toContain("11,291.37");
  });

  it("sends live balances", () => {
    const maya = context.balances.find((b) => b.account === "Maya");
    expect(maya?.balance).toBeCloseTo(5795.74, 2);
  });

  it("separates borrowing and opening balance from real income", () => {
    expect(context.income.cashIn).toBeGreaterThan(context.income.trueIncome);
    expect(text).toContain("was borrowed");
    expect(text).toContain("already held when counting started");
  });

  it("sends the alerts the app already computed, rather than asking for new ones", () => {
    expect(context.alerts.length).toBeGreaterThan(0);
    expect(text).toContain("Already flagged by the app");
  });

  it("sends recent months so the model can tell normal from unusual", () => {
    expect(context.comparison).toHaveLength(6);
    expect(context.comparison.at(-1)?.month).toBe("August 2026");
  });

  it("caps the spending ranking rather than sending every category", () => {
    expect(context.topSpending.length).toBeLessThanOrEqual(8);
  });
});

describe("it is a snapshot, not a query", () => {
  it("returns the same thing for the same ledger", () => {
    expect(JSON.stringify(buildContext(input))).toBe(JSON.stringify(buildContext(input)));
  });

  it("changes nothing it reads", () => {
    const before = JSON.stringify(fixture.transactions);
    buildContext(input);
    expect(JSON.stringify(fixture.transactions)).toBe(before);
  });

  it("has a known size before anything is sent", () => {
    expect(contextSize(context)).toBe(new TextEncoder().encode(text).length);
  });
});

describe("an empty system", () => {
  const empty = buildContext({
    transactions: [],
    accounts: [],
    budgets: {},
    credits: [],
    reference: {
      wallets: [],
      savings: [],
      bills: [],
      subscriptions: [],
      revenueCategories: [],
      spendingTypes: [],
    },
    lowBalanceThreshold: 0,
    asOf: AS_OF,
  });

  it("says there is no budget rather than inventing a zero one", () => {
    expect(empty.month.budget).toBeNull();
    expect(contextToText(empty)).toContain("No budget set");
  });

  it("still produces readable text", () => {
    expect(contextToText(empty).length).toBeGreaterThan(50);
  });
});
