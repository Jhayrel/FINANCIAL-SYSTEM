import { describe, expect, it } from "vitest";
import { asksAboutLimit, limitAnswer, limitLines } from "./limitAsk";
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
