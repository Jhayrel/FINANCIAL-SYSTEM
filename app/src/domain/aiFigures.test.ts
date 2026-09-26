/**
 * The answer's figures, checked against the figures it was given.
 *
 * Every case here is taken from the owner's own log on 20 September 2026.
 */

import { describe, expect, it } from "vitest";

import { figuresIn, untracedFigures, untracedNote } from "./aiFigures";
import { formatMoney } from "./money";

describe("reading figures out of text", () => {
  it("reads the shapes a model writes", () => {
    expect(figuresIn("PHP 1,234.56")).toEqual([123456]);
    expect(figuresIn("₱1,234.56")).toEqual([123456]);
    expect(figuresIn("PHP 5,000.00 and ₱10,548.94")).toEqual([500000, 1054894]);
  });

  it("keeps the minus sign, whichever side it is written", () => {
    expect(figuresIn("PHP -33,478.39")).toEqual([-3347839]);
    expect(figuresIn("-PHP 3,043.49")).toEqual([-304349]);
  });

  it("reads a bare grouped figure inside a sentence about pesos", () => {
    expect(figuresIn("spent 39,638.36 against a budget")).toEqual([3963836]);
  });

  it("finds nothing in a sentence with no money in it", () => {
    expect(figuresIn("eleven days left in the month")).toEqual([]);
  });
});

describe("the debt answer that invented three figures", () => {
  /*
   * The data held the real answer, PHP 5,000.00, the whole time. The model
   * added and subtracted in prose instead and produced a chain: 2,520.00,
   * then 811.21, then 1,708.79, each built on the last.
   */
  const given = "## Debt\nMaya Credit: PHP 5,000.00 owed\n## The ledger\nborrowed PHP 2,500.00, interest PHP 188.79";
  const answer =
    "You still owe PHP 4,111.21. The original debt was PHP 2,500.00 plus a PHP 20.00 service charge, totaling PHP 2,520.00. Your payment of PHP 1,000.00 included PHP 188.79 in interest, which means only PHP 811.21 went toward the principal. The remaining balance on that specific loan is PHP 1,708.79.";

  it("names the figures the data cannot support", () => {
    const loose = untracedFigures(answer, given);
    expect(loose).toContain(411121);
    expect(loose).toContain(81121);
    expect(loose).toContain(170879);
  });

  it("leaves the figures it was actually given alone", () => {
    const loose = untracedFigures(answer, given);
    expect(loose).not.toContain(250000);
    expect(loose).not.toContain(18879);
  });

  it("writes a line the owner can act on", () => {
    expect(untracedNote(answer, given, formatMoney)).toContain("not figures this app worked out");
  });
});

describe("what it deliberately allows", () => {
  const given = "Net worth PHP 1,024,251.32. Maya Credit PHP 5,000.00 owed.";

  it("allows one honest step from two figures it holds", () => {
    // 1,024,251.32 + 5,000.00, said out loud, with both parts named.
    const answer = "Paying off Maya Credit leaves PHP 1,029,251.32.";
    expect(untracedFigures(answer, given)).toEqual([]);
  });

  it("does not allow a second step built on an invented one", () => {
    const answer = "That leaves PHP 1,029,251.32, and after next month PHP 1,041,817.77.";
    expect(untracedFigures(answer, given)).toEqual([104181777]);
  });

  it("says nothing about an answer that only repeats what it was given", () => {
    const answer = "You owe PHP 5,000.00 on Maya Credit and your net worth is PHP 1,024,251.32.";
    expect(untracedNote(answer, given, formatMoney)).toBe("");
  });

  /*
   * A guard that fires on "PHP 50.00" or "the 3 days" is a guard the owner
   * stops reading, which is how the duplicate warning ended up overridden
   * thirty-one times.
   */
  it("keeps quiet about small round figures", () => {
    expect(untracedFigures("about PHP 50.00 a day, over 11 days", given)).toEqual([]);
  });

  it("has nothing to check against when it was given nothing", () => {
    expect(untracedFigures("PHP 4,111.21", "")).toEqual([]);
  });

  it("names a figure once however often it is repeated", () => {
    const answer = "PHP 4,111.21 now, and PHP 4,111.21 again next month.";
    expect(untracedFigures(answer, given)).toEqual([411121]);
  });
});
