/**
 * What the assistant is told it can do.
 *
 * ── The exchange this exists to stop ──────────────────────────────────────
 *
 *   15:06:32  "I want chart and trend at the same time with proper
 *              explaantion"
 *   15:07:14  "I cannot make charts or graphs here, only plain text, so a
 *              visual trend is not something..."
 *   15:07:31  "what you just did it!!!"
 *
 * And earlier, at 09:42:51, to "Delete that last": "I cannot add, change or
 * delete anything here."
 *
 * Neither was a misreading. The chat instruction said, in as many words,
 * "You cannot add, change or delete anything", and the model generalised
 * from it to charts. The app draws charts, adds entries and bins rows: the
 * model is one part of it, and a part denying what the whole does is worse
 * than an unhelpful answer, because it teaches the owner not to ask.
 *
 * This file guards the wording rather than the behaviour. It is the one
 * place a sentence can be edited back in without a test failing anywhere.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../functions/api/ai.ts", import.meta.url), "utf8");

/** The chat task's instruction, as it will be sent. */
const chatInstruction = (() => {
  const at = source.indexOf("  chat:");
  const end = source.indexOf('",', at);
  return source.slice(at, end);
})();

describe("the assistant is not told to deny what the app does", () => {
  it("found the instruction", () => {
    expect(chatInstruction.length).toBeGreaterThan(200);
  });

  /** The exact sentence that produced both denials. */
  it("no longer claims it cannot add, change or delete", () => {
    expect(chatInstruction).not.toContain("You cannot add, change or delete anything");
  });

  it("says the app does those things", () => {
    expect(chatInstruction.toLowerCase()).toContain("draws charts");
    expect(chatInstruction.toLowerCase()).toContain("never say you cannot");
  });

  /**
   * Files are the one genuine limit, and it must stay stated.
   *
   * "give me pdf of transaction" at 09:20:45 was answered correctly, and
   * that answer should not become a promise the app cannot keep.
   */
  it("still says files are beyond it", () => {
    expect(chatInstruction.toLowerCase()).toContain("pdf");
  });
});
