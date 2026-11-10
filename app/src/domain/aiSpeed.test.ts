/**
 * Faster answers that still think (owner, 10 November 2026: "can we make it
 * faster but still advance and can think deep"). A question the worked-out
 * sections answer is sent the ledger rows nearest it, not all 60 KB of them;
 * a question that asks to see, find or count entries, or about a time gone,
 * keeps them all. Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { MAX_ROW_BYTES, rowBudgetFor, SUMMARY_ROW_BYTES } from "./aiChatContext";

describe("how much of the ledger a question is sent", () => {
  it("the rows nearest it, for a question the worked-out figures answer", () => {
    for (const q of ["Can I afford now the plan for motorcycle upgrade?", "how am I doing this month", "what should I cut", "is my spending normal", "how much can I spend today", "what's my forecast for next month", "any tips to save more?"]) {
      expect(rowBudgetFor(q), q).toBe(SUMMARY_ROW_BYTES);
    }
  });
  it("every row, for finding, listing, counting, or a time gone", () => {
    for (const q of ["what did I buy on nov 5", "when did I last buy shoes", "how much did I spend in june", "list my gym entries", "how many times did I eat out", "can I see #0432", "did I pay my wifi last month", "can I afford what I spent in 2025 again"]) {
      expect(rowBudgetFor(q), q).toBe(MAX_ROW_BYTES);
    }
  });
  it("anything else keeps every row, as before", () => {
    expect(rowBudgetFor("tell me something interesting about my money")).toBe(MAX_ROW_BYTES);
    expect(rowBudgetFor("")).toBe(MAX_ROW_BYTES);
    expect(SUMMARY_ROW_BYTES).toBeLessThan(MAX_ROW_BYTES);
  });
});
