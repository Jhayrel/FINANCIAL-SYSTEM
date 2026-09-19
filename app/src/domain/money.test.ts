/**
 * Reading a figure a person typed, or pasted.
 *
 * The app writes a negative with U+2212, the real minus sign, because the
 * style guide says money is set that way. Until 20 September 2026 it could
 * not read that back: a figure copied off its own screen and pasted into an
 * amount field, or into "what it really holds" on Insights, parsed as
 * nothing. Found by the stress sweep, which round-tripped every figure the
 * formatter can produce.
 */

import { describe, expect, it } from "vitest";

import { formatMoney, parseAmount, toCentavos } from "./money";

describe("a negative typed with something other than a hyphen", () => {
  /*
   * Hyphen (U+2010) through horizontal bar (U+2015), and the minus sign
   * (U+2212). A phone keyboard, a bank statement and a word processor each
   * produce a different one, and every one of them means the same thing to
   * the person who pasted it.
   */
  const DASHES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((c) =>
    String.fromCodePoint(c),
  );

  it("reads every one of them as a minus sign", () => {
    for (const d of DASHES) {
      const point = `U+${d.codePointAt(0)!.toString(16)}`;
      expect(parseAmount(`${d}1,234.56`), point).toBe(-123456);
      expect(parseAmount(`${d}₱1,234.56`), point).toBe(-123456);
      expect(parseAmount(`₱${d}1,234.56`), point).toBe(-123456);
    }
  });

  it("reads back everything the formatter writes", () => {
    for (const c of [-123456, -1, -99_999_999_999, 0, 500, 99_999_999_999]) {
      expect(parseAmount(formatMoney(c)), formatMoney(c)).toBe(c);
      expect(parseAmount(formatMoney(c, { symbol: false }))).toBe(c);
      expect(parseAmount(formatMoney(c, { signBeforeSymbol: false }))).toBe(c);
    }
  });

  it("still refuses text that only looks like a figure", () => {
    for (const bad of ["", "-", ".", "abc", "1.2.3", "--5", "12-34"]) {
      expect(parseAmount(bad), bad).toBeNull();
    }
  });

  it("keeps centavos exact where a float would not", () => {
    // 0.1 + 0.2 in pesos is the classic; in centavos it cannot happen.
    expect(toCentavos(0.1) + toCentavos(0.2)).toBe(30);
    expect(parseAmount("0.10")! + parseAmount("0.20")!).toBe(30);
    expect(parseAmount("1234.565")).toBe(123457);
  });
});
