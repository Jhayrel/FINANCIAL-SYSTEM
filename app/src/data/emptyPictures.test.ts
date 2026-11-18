/**
 * Pictures that gave nothing are named, so none is dropped without a word
 * (owner's 18 November 2026 backup: a credit screen sent with two receipts
 * left no trace).
 */

import { describe, expect, it } from "vitest";

import { emptyOf, type ExtractResult } from "./aiClient";

const answer = (over: Partial<ExtractResult> = {}): ExtractResult => ({ proposals: [], refused: [], source: "model", ...over });
const card = { draft: {} as never, confidence: "high" as const, sourceRef: "", adjustments: [] };

describe("which pictures gave nothing", () => {
  const pictures = [{ name: "a.jpg" }, { name: "b.jpg" }, { name: "c.jpg" }];

  it("names the one with no card", () => {
    expect(emptyOf(pictures, [[answer({ proposals: [card] })], [answer()], [answer({ proposals: [card] })]])).toEqual(["b.jpg"]);
  });

  it("counts a balance or a refused row as something", () => {
    const balance = answer({ balances: [{ account: "Maya", amount: 100, date: "2026-11-18" }] as never });
    const refused = answer({ refused: [{ sourceRef: "x", reason: "Not money" }] as never });
    expect(emptyOf(pictures, [[balance], [refused], [answer()]])).toEqual(["c.jpg"]);
  });

  it("names a picture with no answer at all", () => {
    expect(emptyOf(pictures, [[answer({ proposals: [card] })]])).toEqual(["b.jpg", "c.jpg"]);
  });
});
