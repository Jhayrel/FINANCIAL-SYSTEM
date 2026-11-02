/**
 * Every figure on a card is held to the paper it came from (owner, 2 November
 * 2026: "make the reasoning and recognition better"; the receipt readers that
 * re-derive each value from its source text). Figures invented.
 */
import { describe, expect, it } from "vitest";
import { emptyDraft } from "./entry";
import { checkAgainstReadings, type Proposal } from "./proposal";

const card = (amount: number, fee = 0): Proposal => ({
  draft: { ...emptyDraft("2026-11-01"), flow: "Spending", category: "Spending", item: "Treat", amount, fee },
  confidence: "high",
  sourceRef: "Image 1",
  adjustments: [],
});
const READING = "CINEMA 2\nTICKET REGULAR 300.00\nTICKET REGULAR 300.00\nVAT 0.00\nTOTAL 300.00\nCASH 500.00 CHANGE 200.00";

describe("a card's amount against the paper", () => {
  it("leaves a printed figure, a sum of printed figures, an amount with its fee, and a typed figure alone", () => {
    for (const p of [card(30_000), card(60_000), card(29_000, 1_000)]) expect(checkAgainstReadings([p], [READING])[0]).toEqual(p);
    expect(checkAgainstReadings([card(15_000)], [READING], "also 150 for popcorn")[0]?.confidence).toBe("high");
  });
  it("marks a figure printed nowhere, and changes nothing", () => {
    const out = checkAgainstReadings([card(45_000)], [READING])[0]!;
    expect(out.draft.amount).toBe(45_000);
    expect(out.confidence).toBe("low");
    expect(out.adjustments.join(" ")).toContain("is not printed on the picture as read here");
  });
  it("judges nothing when the reading caught too little", () => {
    expect(checkAgainstReadings([card(45_000)], ["TOTAL 300.00"])[0]?.confidence).toBe("high");
  });
});
