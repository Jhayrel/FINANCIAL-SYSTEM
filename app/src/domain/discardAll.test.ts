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

import { wantsDiscardAll, wantsDiscardOpen } from "./recall";

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

describe("discarding the card in front of you", () => {
  /**
   * ── The dangerous one ───────────────────────────────────────────────────
   *
   * The owner wrote this while testing:
   *
   *   "now I said the word discard then it show data from database and it
   *    moved to bin"
   *
   * `discard` is in the delete list, so a bare "discard" was read as an
   * instruction to find rows in the ledger. They meant the card on screen.
   * One is throwing away a guess; the other is moving real money records out
   * of the ledger, and they were the same word.
   */
  it("recognises the four ways it was actually typed", () => {
    for (const said of [
      "discard it",
      "I said discard it mean you should discard it",
      "discard",
      "//discard",
    ]) {
      expect(wantsDiscardOpen(said), said).toBe(true);
    }
  });

  it("recognises the other ways of saying it", () => {
    for (const said of ["reject it", "scrap it", "nevermind", "never mind", "discard this"]) {
      expect(wantsDiscardOpen(said), said).toBe(true);
    }
  });

  /**
   * Naming a target means the ledger. A card is a guess that has not become
   * anything, so throwing one away costs a retype; a row is money.
   */
  it("leaves anything that names a row to the finder", () => {
    for (const said of [
      "delete the entry from august",
      "remove record 442",
      "cancel my google drive",
      "delete all dataabse",
      "discard the transaction I made yesterday",
    ]) {
      expect(wantsDiscardOpen(said), said).toBe(false);
    }
  });

  it("is not a question", () => {
    expect(wantsDiscardOpen("should I discard it?")).toBe(false);
  });

  it("is nothing for a long sentence that merely mentions it", () => {
    expect(
      wantsDiscardOpen(
        "I was going to discard that but then I changed my mind about the whole thing entirely",
      ),
    ).toBe(false);
  });
});
