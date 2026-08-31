/**
 * "discard all".
 *
 * A screenshot of a statement came back as eleven cards and none of them were
 * wanted. Typing it did nothing, so they went one at a time: eleven clicks
 * between 09:31:27 and 09:31:48 on 2026-08-31, in the assistant's own record.
 *
 * Not the same as `detectSweep`. That names rows already in the ledger and
 * asks before it moves any. This names cards that have been added to nothing,
 * so it is the cheapest and most reversible action in the app, and there is
 * nothing to confirm: the cards were never money.
 */

import { describe, expect, it } from "vitest";

import { wantsDiscardAll } from "./recall";

describe("throwing away every card at once", () => {
  it("recognises the sentence that did nothing", () => {
    expect(wantsDiscardAll("discard all")).toBe(true);
  });

  it("recognises the ways of saying it", () => {
    for (const said of [
      "discard all",
      "reject all",
      "throw them all away",
      "clear all",
      "delete all of them",
      "remove all",
      "no to all",
      "scrap all",
      "discard everything",
      "reject every one",
    ]) {
      expect(wantsDiscardAll(said), said).toBe(true);
    }
  });

  /**
   * A quantifier is required, and so is a rejecting verb.
   *
   * One without the other is an ordinary sentence, and the cost of being
   * wrong here is throwing away work somebody wanted.
   */
  it("does not fire on one card", () => {
    for (const said of ["discard", "discard this", "reject that one", "no"]) {
      expect(wantsDiscardAll(said), said).toBe(false);
    }
  });

  it("does not fire on a sentence that merely says all", () => {
    for (const said of [
      "add all",
      "all of them look right",
      "show me all my spending",
      "make this all 2026",
    ]) {
      expect(wantsDiscardAll(said), said).toBe(false);
    }
  });

  /**
   * Length is the guard against a long sentence that happens to contain both.
   *
   * "I paid for all the food and want to remove the fee from this one" has a
   * quantifier and a rejecting verb in it and means neither.
   */
  it("does not fire on a long sentence containing both words", () => {
    expect(
      wantsDiscardAll(
        "I paid for all the food yesterday and I want to remove the fee from this one",
      ),
    ).toBe(false);
  });

  it("is nothing for an empty message", () => {
    expect(wantsDiscardAll("")).toBe(false);
    expect(wantsDiscardAll("   ")).toBe(false);
  });
});
