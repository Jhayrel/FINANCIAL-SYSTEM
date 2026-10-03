/** "whats that selected?" about a tapped slice: the handoff's open item. */
import { describe, expect, it } from "vitest";

import { asksAboutPick, pickAnswer, pickText } from "./chartPick";

const pick = { chart: "Spending by kind, September 2026", part: "Food", lines: ["Food: ₱4,515.00, 31 entries", "19% of the ₱23,679.00 the chart shows"] };

describe("the part picked on a chart", () => {
  it("is what a question pointing at it means", () => {
    for (const q of ["whats that selected?", "what is the selected one", "why is that slice so big", "explain this bar", "the one I tapped, what is it"]) {
      expect(asksAboutPick(q), q).toBe(true);
    }
    for (const q of ["how much did I spend on food", "what is my balance", "chart my spending"]) {
      expect(asksAboutPick(q), q).toBe(false);
    }
  });

  it("goes to the assistant with its figures, and is said by the device when no model answers", () => {
    expect(pickText(pick)).toContain('On "Spending by kind, September 2026" they tapped Food.');
    expect(pickText(pick)).toContain("- Food: ₱4,515.00, 31 entries");
    expect(pickAnswer(pick)).toBe('The part picked on "Spending by kind, September 2026" is Food: ₱4,515.00, 31 entries; 19% of the ₱23,679.00 the chart shows.');
    expect(pickAnswer({ chart: "Income and spending chart", part: "March 2026", lines: ["Income: ₱9,000.00", "Spending: ₱7,000.00"] })).toBe(
      'The part picked on "Income and spending chart" is March 2026: Income: ₱9,000.00; Spending: ₱7,000.00.',
    );
  });
});
