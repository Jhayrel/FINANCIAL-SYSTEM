import { describe, expect, it } from "vitest";
import { limitLine } from "./entryImpact";
import { asksAboutLimit, limitAnswer, limitLines, limitWords, planLimitNote } from "./limitAsk";
import type { Budgets, Transaction } from "./types";

const food = (date: string, pesos: number): Transaction =>
  ({ id: `${date}-${pesos}`, recordNumber: 1, date, type: "Spending", fromWallet: "Cash", toWallet: "", category: "Spending", item: "Food", description: "", amount: pesos * 100, fee: 0, total: pesos * 100, notes: "", status: "Paid" }) as Transaction;
const budgets = { "2026": { spending: Array(12).fill(0), billsSubs: Array(12).fill(0), categories: { Food: [0, 0, 0, 0, 0, 0, 0, 0, 0, 300_000, 0, 0], Gas: [0, 0, 0, 0, 0, 0, 0, 0, 0, 100_000, 0, 0] } } } as unknown as Budgets;

describe("a question about a limit (7 October 2026 limits audit)", () => {
  it("is a question, not a command", () => {
    expect(asksAboutLimit("did I go over my 3000 food limit?")).toBe(true);
    expect(asksAboutLimit("how much food budget is left", ["Food"])).toBe(true);
    expect(asksAboutLimit("how much of my budget is left?", ["Food"])).toBe(false);
    expect(asksAboutLimit("am I over any of my limits?")).toBe(true);
    expect(asksAboutLimit("limit food to 3000")).toBe(false);
    expect(asksAboutLimit("remove the food limit")).toBe(false);
  });

  it("answers with the Budget screen's figures", () => {
    const lines = limitLines([food("2026-10-02", 4_691)], budgets, [], 2026, 10);
    expect(limitAnswer("did I go over my 3000 food limit?", lines, 10, "2026-10-06")).toBe("Food: ₱4,691.00 of its ₱3,000.00 limit, ₱1,691.00 over.");
    expect(limitAnswer("am I over any of my limits?", lines, 10, "2026-10-06")).toContain("Food is over its limit in October.");
    expect(limitAnswer("how much is left on my gas limit?", lines, 10, "2026-10-06")).toBe("Gas: ₱0.00 of its ₱1,000.00 limit, ₱1,000.00 left, ₱38.46 a day for the 26 days left.");
    expect(limitAnswer("how much treat budget is left?", lines, 10, "2026-10-06", ["Food", "Gas", "Treat"])).toContain("Treat has no limit in October.");
  });
});

describe("limits audit, 27 October 2026", () => {
  it("names the kind asked about when no limit is set at all", () => {
    expect(limitAnswer("did I go over my food limit?", [], 10, "2026-10-06", ["Food"])).toBe('Food has no limit in October, and no other kind has one. Set one on the Budget screen, or say "limit food to 3000".');
    expect(limitAnswer("am I near any of my limits?", [], 10, "2026-10-06", ["Food"])).toBe('No kind of spending has a limit in October. Set one on the Budget screen, or say "limit food to 3000".');
  });

  it("says which kinds are close to their limit, the bell's 90%", () => {
    const lines = limitLines([food("2026-10-02", 2_800)], budgets, [], 2026, 10);
    expect(limitAnswer("am I near any of my limits?", lines, 10, "2026-10-06")).toMatch(/^No kind is over its limit in October\. Food is close to its limit\./);
    const easy = limitLines([food("2026-10-02", 100)], budgets, [], 2026, 10);
    expect(limitAnswer("am I near any of my limits?", easy, 10, "2026-10-06")).toMatch(/^Every kind with a limit is well within it in October\./);
  });

  it("says a limit in a few words for the Dashboard", () => {
    expect(limitWords({ kind: "Food", limit: 300_000, spent: 469_100 })).toEqual({ text: "₱1,691.00 over its ₱3,000.00 limit", over: true });
    expect(limitWords({ kind: "Food", limit: 300_000, spent: 300_000 })).toEqual({ text: "At its ₱3,000.00 limit, nothing left", over: false });
    expect(limitWords({ kind: "Food", limit: 300_000, spent: 288_000 })).toEqual({ text: "₱120.00 left of its ₱3,000.00 limit", over: false });
  });
});

describe("the entry card's limit line, the same on the Add form and in the chat", () => {
  const base = { kind: "Food", limit: 300_000, cost: 20_000 };
  it("says what is left, before and after", () => {
    expect(limitLine({ ...base, kindBefore: 100_000 })).toEqual({ text: "Food limit: ₱2,000.00 left, then ₱1,800.00.", over: false });
  });
  it("says when this entry takes it over", () => {
    expect(limitLine({ ...base, kindBefore: 290_000 })).toEqual({ text: "Food limit: ₱100.00 left; this takes it ₱100.00 over.", over: true });
  });
  it("says when it is over already", () => {
    expect(limitLine({ ...base, kindBefore: 857_000 })).toEqual({ text: "Food is ₱5,570.00 over its ₱3,000.00 limit, ₱5,770.00 after this.", over: true });
  });
  it("says nothing for a kind with no limit", () => {
    expect(limitLine({ ...base, limit: null, kindBefore: 0 })).toBeNull();
    expect(limitLine({ ...base, kind: null, kindBefore: 0 })).toBeNull();
  });
});

describe("a plan against its kind's limit, on the plan form", () => {
  const line = { kind: "Food", limit: 300_000, spent: 100_000 };
  it("says what is left after the plan", () => {
    expect(planLimitNote(line, 0, 50_000, 11)).toEqual({ text: "Food has a ₱3,000.00 limit in November: ₱1,000.00 spent. ₱1,500.00 is left after this plan.", over: false });
  });
  it("counts the other plans, and says when this one takes it over", () => {
    expect(planLimitNote(line, 150_000, 80_000, 11)).toEqual({ text: "Food has a ₱3,000.00 limit in November: ₱1,000.00 spent, ₱1,500.00 in other plans. This plan takes it ₱300.00 over.", over: true });
  });
  it("says when it is over before this plan", () => {
    expect(planLimitNote({ ...line, spent: 350_000 }, 0, 10_000, 10).text).toBe("Food has a ₱3,000.00 limit in October: ₱3,500.00 spent. It is already ₱500.00 over; with this plan, ₱600.00 over.");
  });
});
