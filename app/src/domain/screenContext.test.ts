/**
 * The assistant is told which screen is open and what is on it.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { buildContext } from "./aiContext";
import { buildChatContext } from "./aiChatContext";
import { aboutTheScreen, screenText } from "./screenContext";

const fx = loadFixture();

describe("what is on screen", () => {
  it("says nothing when no screen has reported", () => {
    expect(screenText(null)).toBe("");
  });

  it("names the screen and lists what it shows", () => {
    const text = screenText({ screen: "Dashboard", lines: ["Safe to spend PHP 65.01 a day.", "  ", "Spent PHP 3,834.11."] });
    expect(text.startsWith("## What is on screen now")).toBe(true);
    expect(text).toContain("on the Dashboard screen");
    expect(text).toContain("asking about what is described below");
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

/**
 * The block tells the model to answer about the screen, so it must only be
 * sent when the question is about the screen. Live, 20 September 2026: "how
 * much did I spend today" was answered with a description of the empty amount
 * field on the Add form, and the figure came third.
 */
describe("whether the question is about what is on screen", () => {
  const POINTS_AT_IT = [
    "what do you think",
    "what do you think of this",
    "is this right",
    "is this ok?",
    "how does this look",
    "anything wrong here",
    "should I save this",
    "ano sa tingin mo",
    "tama ba ito",
    "these entries look odd",
  ];

  const ABOUT_THE_LEDGER = [
    // "this month" is a span of time, not the screen. Live, 20 September
    // 2026: "I have 11 days left this month, what should I cut?" was
    // answered with a description of the Add form.
    "I have 11 days left this month, what should I cut?",
    "is 21k on Treat this month bad?",
    "how much did I spend this week",
    "what did I spend on food this year",
    "how much did I spend today",
    "what is my maya balance",
    "how much did I spend on food in august",
    "chart my spending",
    "which wallet is lowest",
    "magkano ang ginastos ko ngayong buwan",
    "",
  ];

  it("is true when the question points at it", () => {
    for (const said of POINTS_AT_IT) expect(aboutTheScreen(said), said).toBe(true);
  });

  it("is false for a question about the figures", () => {
    for (const said of ABOUT_THE_LEDGER) expect(aboutTheScreen(said), said).toBe(false);
  });
});
