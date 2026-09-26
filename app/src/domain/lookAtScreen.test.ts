/**
 * Being told to look is pointing, without a pointing word.
 *
 * From the owner's chat: "but look at my budget 2026" (21 September 2026)
 * and "read the output" (23 September) both came back as charts, and under
 * the first they wrote "// you give me a chart instead of seing my screen".
 */

import { describe, expect, it } from "vitest";

import { aboutTheScreen } from "./screenContext";

describe("an instruction to look at the screen", () => {
  const LOOKING = [
    "but look at my budget 2026",
    "read the output",
    "see my screen",
    "look at the chart",
    "check the numbers",
    "tignan mo yung output",
    "read the result please",
  ];

  for (const said of LOOKING) {
    it(`is about the screen: "${said}"`, () => {
      expect(aboutTheScreen(said)).toBe(true);
    });
  }

  /*
   * "look at May" is about the ledger, not the screen, which is why the
   * verbs only count with my, the or this in front of a thing on screen.
   */
  const NOT_LOOKING = [
    "look at May",
    "check my spending in August",
    "how much did I spend today",
    "read my database",
  ];

  for (const said of NOT_LOOKING) {
    it(`is not about the screen: "${said}"`, () => {
      expect(aboutTheScreen(said)).toBe(false);
    });
  }

  /*
   * The fix from 20 September stays fixed: a span of time is not a screen.
   */
  it("still leaves a question about the month alone", () => {
    expect(aboutTheScreen("I have 11 days left this month, what should I cut?")).toBe(false);
  });

  it("still reads the plain pointing words", () => {
    expect(aboutTheScreen("what do you think about this?")).toBe(true);
    expect(aboutTheScreen("how abouut this area?")).toBe(true);
  });
});
