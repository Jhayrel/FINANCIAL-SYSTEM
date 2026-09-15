/**
 * The assistant is told which screen is open and what is on it.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { buildContext } from "./aiContext";
import { buildChatContext } from "./aiChatContext";
import { screenText } from "./screenContext";

const fx = loadFixture();

describe("what is on screen", () => {
  it("says nothing when no screen has reported", () => {
    expect(screenText(null)).toBe("");
  });

  it("names the screen, says what 'this' means, and lists what it shows", () => {
    const text = screenText({ screen: "Dashboard", lines: ["Safe to spend PHP 65.01 a day.", "  ", "Spent PHP 3,834.11."] });
    expect(text.startsWith("## What is on screen now")).toBe(true);
    expect(text).toContain("on the Dashboard screen");
    expect(text).toContain('"this"');
    expect(text).toContain("- Safe to spend PHP 65.01 a day.");
    expect(text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(2);
  });

  it("keeps a long screen from crowding out the ledger", () => {
    const text = screenText({ screen: "Database", lines: Array.from({ length: 90 }, (_, i) => `Row ${i} ${"x".repeat(400)}`) });
    const lines = text.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(40);
    expect(lines.every((l) => l.length <= 283)).toBe(true);
  });

  it("goes first in what the assistant reads, before the ledger", () => {
    const snapshot = buildContext({
      transactions: fx.transactions,
      accounts: [],
      budgets: fx.budgets,
      credits: [],
      reference: fx.reference,
      lowBalanceThreshold: 0,
      asOf: "2026-08-29",
    });
    const screen = screenText({ screen: "Insights", lines: ["Looking at August 2026."] });
    const { text } = buildChatContext({ snapshot, transactions: fx.transactions, asOf: "2026-08-29", question: "what do you think", screen });
    expect(text.indexOf("## What is on screen now")).toBe(0);
    expect(text.indexOf("## The ledger")).toBeGreaterThan(0);

    const without = buildChatContext({ snapshot, transactions: fx.transactions, asOf: "2026-08-29", question: "what do you think" });
    expect(without.text).not.toContain("What is on screen now");
  });
});
