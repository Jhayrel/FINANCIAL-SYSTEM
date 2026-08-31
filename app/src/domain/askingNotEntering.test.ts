/**
 * The request that became a two thousand peso transfer.
 *
 * ── What happened, at 14:48 on 2026-08-31 ─────────────────────────────────
 *
 *   14:48:04  "give me insights oif all transaction under treat this may to
 *              august 2026"
 *   14:48:18  "all, under treat"
 *   14:48:27  "I said all"
 *   14:48:37  "ok maya"
 *   14:48:53  "what is this???"
 *   14:49:04  rejected: 2026-08-29 Transfer PHP 2,026.00
 *
 * A request for insights turned into a card proposing a transfer, and the
 * amount was the year out of the date range. Five messages of increasing
 * bewilderment, then a rejection.
 *
 * Two faults, one sentence. `ASKING` is anchored at the start and none of
 * these open with one of its words, so a plain request read as something
 * that had happened. And a year sitting next to a month name was read as
 * money.
 */

import { describe, expect, it } from "vitest";

import { isQuestion } from "./intent";
import { readEntry } from "./readEntry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance", "Framelink"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Treat", remark: "Treating someone" },
  ],
};

const ledger: Transaction[] = [];
const read = (t: string) => readEntry(t, ledger, reference, "2026-08-31");

describe("asking for something is not recording something", () => {
  it("reads the sentence that became a transfer as a question", () => {
    expect(
      isQuestion("give me insights oif all transaction under treat this may to august 2026"),
    ).toBe(true);
  });

  it("reads the other requests from that session as questions too", () => {
    for (const said of [
      "I want to know how much I spent teating someone this year",
      "I want summary",
      "give me insights of all transaction under treat",
      "show me treat this month",
      "Show all data about treat in chat review the database",
      "tell me my top spending",
      "make me a chart of this month",
    ]) {
      expect(isQuestion(said), said).toBe(true);
    }
  });

  /**
   * Phrases, not bare words, and this is the reason.
   *
   * "give me" is a request and "I give 1000 to my friend" is an entry, and
   * they share a verb. Matching the verb alone would have stopped money
   * being recorded at all.
   */
  it("still reads a real entry as an entry", () => {
    for (const said of [
      "I give 1000 to my friend and I sent it using my gcash",
      "I paid 250 for gas using cash",
      "I earned 10000 yesterday from framelink",
      "I buy load using gcash 30 pesos",
      "I withdraw 5000 from maya to cash, fee 18",
    ]) {
      expect(isQuestion(said), said).toBe(false);
    }
  });
});

describe("a year beside a month is a date, not money", () => {
  /** The PHP 2,026.00 in the record, in one assertion. */
  it("finds no amount in a date range", () => {
    expect(
      read("give me insights oif all transaction under treat this may to august 2026").draft.amount,
    ).toBeNull();
  });

  it("finds no amount in any month and year", () => {
    for (const said of [
      "show me august 2026",
      "spending from january 2026 to march 2026",
      "what did I spend in dec 2025",
    ]) {
      expect(read(said).draft.amount, said).toBeNull();
    }
  });

  /** A figure that says it is money is still money, month or no month. */
  it("keeps an amount that is marked as money", () => {
    expect(read("I paid 2026 pesos for food in august using cash").draft.amount).toBe(202600);
    expect(read("I spent php 2026 on food in august using cash").draft.amount).toBe(202600);
  });

  /** With no month named, a bare figure is exactly what it looks like. */
  it("leaves a bare figure alone when no month is named", () => {
    expect(read("I paid 2026 for food using cash").draft.amount).toBe(202600);
  });

  it("still reads an ordinary amount alongside a month", () => {
    expect(read("I paid 250 for food in august using cash").draft.amount).toBe(25000);
  });
});
