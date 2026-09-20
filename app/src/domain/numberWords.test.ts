/**
 * Money written out in words.
 *
 * From the owner's own long messages, 20 September 2026: "I withdrew a
 * thousand pesos from my Maya account into cash, and the bank charged me
 * fifteen pesos", "I bought breakfast for a hundred and twenty pesos", "the
 * amount should be two hundred and fifty pesos". The reader on this device
 * found no figure in any of them.
 */

import { describe, expect, it } from "vitest";

import { centavosInWords, numbersInWords } from "./numberWords";

describe("numbers written in words", () => {
  const CASES: [string, number[]][] = [
    ["a thousand pesos", [1000]],
    ["one thousand", [1000]],
    ["fifteen pesos", [15]],
    ["a hundred and twenty pesos", [120]],
    ["two hundred and fifty more at the canteen", [250]],
    ["five hundred pesos through Gcash", [500]],
    ["twenty five thousand", [25000]],
    ["twenty-five thousand pesos", [25000]],
    ["two thousand five hundred", [2500]],
    ["one hundred eighty eight", [188]],
    ["ninety nine", [99]],
    ["a million", [1000000]],
  ];

  for (const [said, expected] of CASES) {
    it(`reads "${said}"`, () => {
      expect(numbersInWords(said)).toEqual(expected);
    });
  }

  it("reads several out of one sentence, in order", () => {
    const said =
      "This morning I withdrew a thousand pesos from my Maya account into cash, and the bank charged me fifteen pesos for the withdrawal.";
    expect(numbersInWords(said)).toEqual([1000, 15]);
  });

  it("keeps two figures apart rather than adding them together", () => {
    expect(numbersInWords("twenty pesos for thirty minutes")).toEqual([20, 30]);
    expect(numbersInWords("three hundred for food and four hundred for gas")).toEqual([300, 400]);
  });

  it("finds nothing where there is nothing", () => {
    for (const said of ["", "paid the wifi", "a mistake with the food"]) {
      expect(numbersInWords(said), said).toEqual([]);
    }
  });

  it("gives whole centavos, or nothing", () => {
    expect(centavosInWords("a hundred and twenty pesos")).toBe(12000);
    expect(centavosInWords("two hundred and fifty")).toBe(25000);
    expect(centavosInWords("no figure here")).toBeNull();
  });

  /*
   * "one of my entries" is the trap: it is a real use of "one" that names no
   * amount. The reader only falls back to words when it found no digits, and
   * the check that matters is that this does not become PHP 1.00.
   */
  it("is not fooled by the ordinary English use of one", () => {
    expect(numbersInWords("I made a mistake with one of my entries earlier")).toEqual([1]);
  });
});
