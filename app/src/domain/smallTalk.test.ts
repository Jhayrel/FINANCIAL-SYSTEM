/**
 * The 27 October 2026 sweep: "hello", "thanks", "100" and "what's 2+2" were
 * each answered with the month's summary.
 */
import { describe, expect, it } from "vitest";

import { readSmallTalk, smallTalkAnswer } from "./smallTalk";

describe("small talk", () => {
  it("greets, thanks, asks what a bare figure was for, and adds", () => {
    expect(smallTalkAnswer(readSmallTalk("hello")!, "Jay")).toMatch(/^Hello, Jay\. Tell me what you spent/);
    expect(smallTalkAnswer(readSmallTalk("thanks!")!)).toBe("You're welcome.");
    expect(smallTalkAnswer(readSmallTalk("100")!)).toBe('₱100.00 for what? Say what it was and where it came from, like "lunch 100 cash", and I make the card.');
    expect(smallTalkAnswer(readSmallTalk("what's 150+80")!)).toBe("150.00 + 80.00 = **230.00**");
    expect(smallTalkAnswer(readSmallTalk("500 - 120.50 + 35")!)).toBe("500.00 − 120.50 + 35.00 = **414.50**");
  });

  it("leaves everything else to the readers that know it", () => {
    for (const s of ["lunch 100", "ok", "sige", "hello how much did i spend today", "100 cash", "how much is 3k"]) expect(readSmallTalk(s), s).toBeNull();
  });
});
