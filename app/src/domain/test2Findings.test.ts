/**
 * What the second challenge turned up.
 *
 * Three faults, and one of them was found by the owner writing a note to
 * themselves in the chat box and watching the app answer it.
 */

import { describe, expect, it } from "vitest";

import { buildChart } from "./charts";
import { inferFromHistory } from "./infer";
import { emptyDraft } from "./entry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Microsoft Office 365", "Spotify"],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "Meals, snacks, drinks" }],
};

const ASOF = "2026-09-05";

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `x-${n}`,
    recordNumber: n,
    date: "2026-08-20",
    type: "Spending",
    fromWallet: "Maya",
    toWallet: "",
    category: "Subscriptions",
    item: "Microsoft Office 365",
    description: "",
    amount: 23900,
    fee: 0,
    total: 23900,
    notes: "",
    status: "Paid",
    ...over,
  };
};

describe("a fixed subscription costs what it always costs", () => {
  /**
   * "I paid my microsoft office 365 today from maya" left the amount blank
   * and the owner wrote: "it should now the amount access the database".
   * Spotify is the same figure every month; that is a fact about the
   * subscription, not a guess about this payment.
   */
  const paid = [
    row({ date: "2026-06-20" }),
    row({ date: "2026-07-20" }),
    row({ date: "2026-08-20" }),
  ];

  it("fills the amount from the last three, when they agree", () => {
    const draft = {
      ...emptyDraft(ASOF),
      flow: "Spending" as const,
      category: "Subscriptions" as const,
      item: "Microsoft Office 365",
    };
    const result = inferFromHistory(draft, paid, reference, "microsoft office 365");
    expect(result.draft.amount).toBe(23900);
    expect(result.unsure).toContain("amount");
  });

  /** One differing figure and it is not a fixed cost, so nothing is filled. */
  it("fills nothing when the figure moves", () => {
    const varying = [row({ date: "2026-08-20", amount: 30000, total: 30000 }), ...paid.slice(1)];
    const draft = {
      ...emptyDraft(ASOF),
      flow: "Spending" as const,
      category: "Subscriptions" as const,
      item: "Microsoft Office 365",
    };
    expect(inferFromHistory(draft, varying, reference, "office").draft.amount).toBeNull();
  });

  /**
   * Food is a different figure every time and always will be. The amount
   * rule still bites everywhere it should.
   */
  it("never fills an amount for ordinary spending", () => {
    const meals = [
      row({ category: "Spending", item: "Food", amount: 10000, total: 10000, date: "2026-06-01" }),
      row({ category: "Spending", item: "Food", amount: 10000, total: 10000, date: "2026-07-01" }),
      row({ category: "Spending", item: "Food", amount: 10000, total: 10000, date: "2026-08-01" }),
    ];
    const draft = {
      ...emptyDraft(ASOF),
      flow: "Spending" as const,
      category: "Spending" as const,
      item: "Food",
    };
    expect(inferFromHistory(draft, meals, reference, "food").draft.amount).toBeNull();
  });

  it("never overrules an amount you typed", () => {
    const draft = {
      ...emptyDraft(ASOF),
      flow: "Spending" as const,
      category: "Subscriptions" as const,
      item: "Microsoft Office 365",
      amount: 50000,
    };
    expect(inferFromHistory(draft, paid, reference, "office").draft.amount).toBe(50000);
  });
});

describe("a follow-up narrows the chart, it does not replace it", () => {
  /**
   * "chart my treats from may to august" then "treat only" drew Treat across
   * September, because the second message named no period and fell back to
   * this month. The window was on screen a second earlier.
   *
   * The carry is done in `AskPanel`, by putting the previous chart's title
   * into the question. This checks the property that makes that work: a
   * title holds its own period in words that `windowOf` can read back.
   */
  const treats = [
    row({ category: "Spending", item: "Treat", date: "2026-05-04", amount: 30000, total: 30000 }),
    row({ category: "Spending", item: "Treat", date: "2026-07-04", amount: 20000, total: 20000 }),
    row({ category: "Spending", item: "Treat", date: "2026-09-04", amount: 45000, total: 45000 }),
  ];

  it("reads its own title back as the same window", () => {
    const first = buildChart("chart my treats from may to august", treats, ASOF);
    expect(first?.title).toContain("May 2026 to August 2026");

    const again = buildChart(`treat only ${first?.title}`, treats, ASOF);
    expect(again?.total).toBe(first?.total);
    expect(again?.title).toContain("May 2026 to August 2026");
  });

  /** Without the carry it falls back to this month, which is the bug. */
  it("falls back to this month when nothing is carried", () => {
    expect(buildChart("treat only", treats, ASOF)?.title).toContain("September 2026");
  });
});
