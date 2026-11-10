/**
 * The figure check said on a line of its own under a model's answer (owner,
 * 10 November 2026: "the Show the app's working is so confusing"). Every
 * figure here is invented.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { checkWords, withCheckWords } from "./answerCheck";

const DASH = String.fromCharCode(0x2014);

describe("what the check found, in words", () => {
  it("all matched, one or many", () => {
    expect(checkWords({ figures: 1, loose: [], slip: "" })).toBe("Checked: the one figure in this answer matches your records.");
    expect(checkWords({ figures: 6, loose: [], slip: "" })).toBe("Checked: all 6 figures in this answer match your records.");
    expect(checkWords({ figures: 0, loose: [], slip: "" })).toBe("");
  });
  it("names the ones not in the records", () => {
    expect(checkWords({ figures: 8, loose: [1234500, 39850], slip: "" })).toBe("Checked: 6 of 8 figures match your records. Not in them: ₱12,345.00, ₱398.50. Check those before you rely on them.");
    expect(checkWords({ figures: 3, loose: [500], slip: "" })).toContain("Check it before you rely on it.");
    expect(checkWords({ figures: 4, loose: [], slip: "", madeUp: true })).toBe("Made-up figures, as you asked: none of them is from your records.");
  });
  it("is kept in the record only when something did not match", () => {
    expect(withCheckWords("Spent ₱100.00.", { figures: 1, loose: [], slip: "" })).toBe("Spent ₱100.00.");
    expect(withCheckWords("Spent ₱123.45.", { figures: 1, loose: [12345], slip: "" })).toBe("Spent ₱123.45.\n\nChecked: the one figure in this answer, ₱123.45, is not in your records. Check it before you rely on it.");
    expect(checkWords({ figures: 2, loose: [1], slip: "" })).not.toContain(DASH);
  });
});

describe("one answer, said once it is final", () => {
  const source = readFileSync(new URL("../features/AskPanel.tsx", import.meta.url), "utf8");
  it("a held answer shows nothing but the check until it settles, and never waits long", () => {
    expect(source).toContain('text: holding ? "" : answerText');
    expect(source).toContain("if (held && !text) return null;");
    expect(source).toContain("setTimeout(() => settleHeld(heldKey, null), SECOND_LOOK_WAIT_MS)");
    expect(source).toContain("if (settledHeld.current.has(key)) return;");
  });
  it("charts drawn in the conversation are the app's figures, an answer's own charts are not", () => {
    expect(source).toContain("...turns.filter(isChart).filter((t) => !t.chart.fromAnswer).map((t) => chartInWords(t.chart)),");
  });
});
