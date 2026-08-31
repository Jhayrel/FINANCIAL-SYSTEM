/**
 * A chart is kept. A card is not.
 *
 * Charts vanished on reload, so asking to see the year by item and coming
 * back the next day lost the half of the conversation that was hardest to
 * ask for. Cards deliberately still vanish: a card is a decision in
 * progress, and storing one means it reappears tomorrow offering to add a
 * row that was already added.
 *
 * The figures are stored, never an image. Photos remain the one thing never
 * kept at all: those are described in the AI log and the bytes thrown away.
 */

import { describe, expect, it } from "vitest";

import { buildChart, chartInWords } from "./charts";
import { drawn, drew, said } from "./chat";
import type { Transaction } from "./types";

let n = 0;
const row = (over: Partial<Transaction> = {}): Transaction => {
  n += 1;
  return {
    id: `t-${n}`,
    recordNumber: n,
    date: "2026-08-10",
    type: "Spending",
    fromWallet: "Cash",
    toWallet: "",
    category: "Spending",
    item: "Food",
    description: "",
    amount: 10000,
    fee: 0,
    total: 10000,
    notes: "",
    status: "Paid",
    ...over,
  };
};

const ledger: Transaction[] = [
  row({ item: "School", amount: 100000, total: 100000, category: "Bills" }),
  row({ item: "Food", amount: 50000, total: 50000 }),
  row({ item: "Gas", amount: 20000, total: 20000 }),
];

const chart = buildChart("show me a chart", ledger, "2026-08-29");

describe("a chart survives a reload", () => {
  it("built one to work with", () => {
    expect(chart).not.toBeNull();
  });

  it("comes back with the same figures it went in with", () => {
    const message = drew(chart, chart?.title ?? "", chartInWords(chart!));
    expect(drawn(message)).toEqual(chart);
  });

  /**
   * The words matter as much as the figures.
   *
   * A reader that knows nothing about charts sees an answer rather than a
   * blank line, and when the turn goes back to the model as history it has
   * something to answer a follow-up from. A picture is not.
   */
  it("says what it drew, in words", () => {
    const message = drew(chart, chart?.title ?? "", chartInWords(chart!));
    expect(message.text).toContain("Spending by item");
    expect(message.text).toContain("School");
    expect(message.text).toContain("PHP 1,000.00");
    expect(message.role).toBe("assistant");
  });

  it("is an assistant message like any other, so nothing else has to change", () => {
    const message = drew(chart, "t", "s");
    expect(message.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(message.id.length).toBeGreaterThan(0);
  });

  /** An ordinary message is not a chart, and must not be read as one. */
  it("reads nothing out of a plain message", () => {
    expect(drawn(said("you", "how much did I spend"))).toBeNull();
    expect(drawn(said("assistant", "PHP 500 on food"))).toBeNull();
  });

  /** Half a chart is a picture that lies, so an oversized one is dropped. */
  it("drops the figures rather than storing half of them", () => {
    const huge = { rows: Array.from({ length: 5000 }, (_, i) => ({ label: `row ${i}` })) };
    const message = drew(huge, "big", "summary");
    expect(message.chart).toBeUndefined();
    // The sentence still carries the answer.
    expect(message.text).toContain("big");
  });

  it("survives a corrupted field rather than throwing", () => {
    expect(drawn({ ...said("assistant", "x"), chart: "{not json" })).toBeNull();
  });
});
