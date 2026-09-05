/**
 * The order the assistant thinks in.
 *
 * ── The sequence, as asked for ────────────────────────────────────────────
 *
 *   1. ANALYSE  the model reads the sentence, always, when it can be reached
 *   2. LEARN    your own corrections are applied
 *   3. GROUND   the ledger fills the blanks, Settings constrains the item
 *   4. RESULT   a card, every field visible before anything saves
 *
 * Two of those were not happening.
 *
 * The rules went first for any message with more than one part in it, and
 * the model was never asked. So "I transfer 1000 to cash 15 fee then use
 * that 1000 to pay my food today" was split by pattern rather than read for
 * meaning, and the reply was "you give wrong entry fix this".
 *
 * And step 2 was missing entirely: `learnedItems` was consulted when you
 * answered "what was it for?" and nowhere else, so a correction did nothing
 * when the model or the reader guessed the item directly, which is almost
 * every time.
 *
 * This file guards the order in `AskPanel.tsx`, because the order is the
 * thing that was wrong and nothing else would fail if it were reversed.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../features/AskPanel.tsx", import.meta.url), "utf8");

const at = (needle: string): number => {
  const i = source.indexOf(needle);
  expect(i, `not found: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("the four steps are named, and in order", () => {
  it("names every step", () => {
    for (const step of [
      "Step 1 of 4: the model reads it",
      "Step 2 of 4: what you have already corrected",
      "Step 3 of 4: the ledger, then Settings",
    ]) {
      expect(source).toContain(step);
    }
  });

  it("applies what was learned before grounding it in the ledger", () => {
    expect(at("Step 2 of 4")).toBeLessThan(at("Step 3 of 4"));
  });

  /**
   * The rules are the floor, not the first opinion. They may only run after
   * the model has been given the sentence and failed to answer.
   */
  it("splits a multi-part sentence only after the model has had its turn", () => {
    expect(at("const found = await readAttached(note);")).toBeLessThan(
      at("const lines = splitEntries(note);"),
    );
  });

  it("keeps the offline reader below the model as well", () => {
    expect(at("const found = await readAttached(note);")).toBeLessThan(
      at("const offline = readEntry(note, transactions, reference, asOf);"),
    );
  });

  /**
   * Debt is the one thing that never reaches a model, and it has to stay
   * above the analyse step. The credit line and the effect are not in a
   * sentence, and reading either wrong turns borrowing into income.
   */
  it("decides debt before the model is asked anything", () => {
    expect(at("if (local.readsAsDebt && !severalParts && !isQuestion(note))")).toBeLessThan(
      at("const found = await readAttached(note);"),
    );
  });

  /**
   * The gate matches one movement, not any sentence containing the word.
   *
   * "I acquire a debt at maya credit 5000... then I transferred 2000 of it
   * to gcash with 15 fee" contains "debt", so the gate matched, showed one
   * debt card and returned, dropping the transfer without a word. The owner
   * hit it five times across three sessions.
   */
  it("lets a sentence with several parts past the debt gate", () => {
    expect(source).toContain("const severalParts =");
    expect(source).toContain("if (local.readsAsDebt && !severalParts");
  });

  /**
   * A question about borrowing is a question.
   *
   * "if I loan 1 billion for treat is it good??" contains "loan", so the gate
   * matched and put a debt card on screen asking which credit line a
   * hypothetical billion pesos belonged to. Nobody borrowed anything: they
   * asked whether they should, which is the advice this assistant exists to
   * give.
   */
  it("does not open a debt card for a question about borrowing", () => {
    expect(source).toContain("if (local.readsAsDebt && !severalParts && !isQuestion(note))");
  });

  /** The message is echoed once, by the analyse step, and not again below. */
  it("does not echo the message twice", () => {
    const fallback = source.slice(at("const lines = splitEntries(note);"));
    const upToOffer = fallback.slice(0, fallback.indexOf("const offline ="));
    expect(upToOffer).not.toContain('say({ kind: "you", text: note })');
  });
});
