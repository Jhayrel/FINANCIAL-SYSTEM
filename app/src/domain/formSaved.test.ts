/**
 * The row a card sent to the form became (`formSaved.ts`).
 *
 * 29 September 2026: a receipt's card, corrected in the form and saved, went
 * on reading "In the form" in the chat. These pin how the ledger settles it.
 */

import { describe, expect, it } from "vitest";

import { emptyDraft, type Draft } from "./entry";
import { rowSavedFor } from "./formSaved";
import type { Transaction } from "./types";

const CARD_AT = 1_759_150_000_000;
const card = `c-${CARD_AT}-1`;
const read: Draft = { ...emptyDraft("2026-09-29"), flow: "Spending", category: "Spending", item: "Food", description: "Upsize Coke and other beverage items", fromWallet: "Maya", amount: 208_200 };

const row = (over: Partial<Transaction>): Transaction => ({
  id: `t-${CARD_AT + 60_000}`,
  recordNumber: 3859,
  date: "2026-09-29",
  type: "Spending",
  fromWallet: "Maya",
  toWallet: "",
  category: "Spending",
  item: "Treat",
  description: "Treat my friend at mang inasal",
  amount: 208_200,
  fee: 0,
  total: 208_200,
  notes: "",
  status: "Paid",
  ...over,
});

describe("a card in the form, and the ledger", () => {
  it("is the row saved after it, however the item and the words were changed", () => {
    expect(rowSavedFor(card, [read], [row({})], new Set())?.recordNumber).toBe(3859);
  });

  it("is never a row saved before the card was made", () => {
    expect(rowSavedFor(card, [read], [row({ id: `t-${CARD_AT - 60_000}` })], new Set())).toBeNull();
  });

  it("is never a row of another day, amount or kind", () => {
    expect(rowSavedFor(card, [read], [row({ date: "2026-09-28" })], new Set())).toBeNull();
    expect(rowSavedFor(card, [read], [row({ amount: 208_300 })], new Set())).toBeNull();
    expect(rowSavedFor(card, [read], [row({ type: "Transfer" })], new Set())).toBeNull();
  });

  it("matches what the form showed when its amount was corrected there", () => {
    const shown = { ...read, amount: 208_300 };
    expect(rowSavedFor(card, [shown, read], [row({ amount: 208_300 })], new Set())?.recordNumber).toBe(3859);
  });

  it("does not guess between two rows that fit, or take one another card has", () => {
    const two = [row({}), row({ id: `t-${CARD_AT + 90_000}`, recordNumber: 3860 })];
    expect(rowSavedFor(card, [read], two, new Set())).toBeNull();
    expect(rowSavedFor(card, [read], [row({})], new Set([`t-${CARD_AT + 60_000}`]))).toBeNull();
  });

  it("ignores a binned row, and rows from anywhere but the form", () => {
    expect(rowSavedFor(card, [read], [{ ...row({}), deletedAt: "2026-09-29T12:00:00Z" } as Transaction], new Set())).toBeNull();
    expect(rowSavedFor(card, [read], [row({ id: "hist-3859" })], new Set())).toBeNull();
    expect(rowSavedFor("an-old-card", [read], [row({})], new Set())).toBeNull();
  });
});

describe("a card whose amount was changed in the form (5 November 2026)", () => {
  const empanada: Draft = { ...emptyDraft("2026-11-05"), flow: "Spending", category: "Spending", item: "Food", description: "empanada", fromWallet: "Cash", amount: 20_000 };
  const saved = (over: Partial<Transaction>): Transaction => row({ date: "2026-11-05", item: "Food", description: "empanada", fromWallet: "Cash", amount: 10_000, total: 10_000, recordNumber: 3992, id: `t-${CARD_AT + 20_000}`, ...over });

  it("is the row saved after it with its day, kind and words", () => {
    expect(rowSavedFor(card, [empanada], [saved({})], new Set())?.recordNumber).toBe(3992);
  });

  it("by its item when it had no words of its own", () => {
    const bare = { ...empanada, description: "" };
    expect(rowSavedFor(card, [bare], [saved({ description: "" })], new Set())?.recordNumber).toBe(3992);
    // The form gave it words the card never had: not enough to say it is the card's.
    expect(rowSavedFor(card, [bare], [saved({ description: "siomai" })], new Set())).toBeNull();
  });

  it("never by other words, another day or kind, or long after", () => {
    expect(rowSavedFor(card, [empanada], [saved({ description: "siomai" })], new Set())).toBeNull();
    expect(rowSavedFor(card, [empanada], [saved({ date: "2026-11-04" })], new Set())).toBeNull();
    expect(rowSavedFor(card, [empanada], [saved({ type: "Revenue" })], new Set())).toBeNull();
    expect(rowSavedFor(card, [empanada], [saved({ id: `t-${CARD_AT + 31 * 60_000}` })], new Set())).toBeNull();
  });

  it("the amount still decides first, and two by the words is a guess not made", () => {
    const exact = saved({ amount: 20_000, total: 20_000, recordNumber: 3993, id: `t-${CARD_AT + 40_000}` });
    expect(rowSavedFor(card, [empanada], [saved({}), exact], new Set())?.recordNumber).toBe(3993);
    const two = [saved({}), saved({ recordNumber: 3994, id: `t-${CARD_AT + 50_000}` })];
    expect(rowSavedFor(card, [empanada], two, new Set())).toBeNull();
  });
});
