/**
 * Four things happened. One row was created.
 *
 *   14:52:56  "Transfer 1000 to my firend maya payment for things I bought
 *              and also add spending treat food 1000 paid gcash and also I
 *              paid my spotify and globe at home for next month"
 *   14:53:02  accepted: 2026-08-29 Spending Money Send PHP 1,000.00
 *
 * Splitting only ever looked at line breaks, so a message typed as one
 * paragraph was one entry however many times it said "and also".
 *
 * Splitting liberally is safe because the caller keeps a split only when
 * every piece reads as an entry on its own. The cost of a wrong split is a
 * discarded guess, not a wrong row, which is why this file can be generous
 * and the tests below check the shape rather than the judgement.
 */

import { describe, expect, it } from "vitest";

import { splitEntries } from "./readEntry";

const NL = String.fromCharCode(10);

describe("the sentence that made one row out of four", () => {
  const said =
    "Transfer 1000 to my firend maya payment for things I bought and also add spending treat food 1000 paid gcash and also I paid my spotify and globe at home for next month";

  it("finds three separate things in it", () => {
    const parts = splitEntries(said);
    expect(parts.length).toBe(3);
    expect(parts[0]).toContain("Transfer 1000");
    expect(parts[1]).toContain("treat food 1000");
    expect(parts[2]).toContain("spotify");
  });

  it("drops the joining words rather than leaving them on the front", () => {
    for (const part of splitEntries(said)) {
      expect(part, part).not.toMatch(/^(and|also|plus)\b/i);
    }
  });
});

describe("the joins that mean a new entry", () => {
  it("splits on the ones people actually type", () => {
    for (const said of [
      "I paid 100 for food and also I paid 200 for gas",
      "I earned 5000 then I spent 300",
      "I earned 5000 and then spent 300",
      "I paid 100 for food; I paid 200 for gas",
      "I paid 100 also add spending 200 for gas",
    ]) {
      expect(splitEntries(said).length, said).toBe(2);
    }
  });

  /**
   * "and" alone is not a separator, deliberately.
   *
   * It joins two halves of one thought far more often than it joins two
   * entries, and "gas and food" is the ordinary case.
   */
  it("leaves a plain and alone", () => {
    expect(splitEntries("I paid 250 for gas and food using cash").length).toBe(1);
    expect(splitEntries("I paid my spotify and globe at home").length).toBe(1);
  });

  it("still splits on line breaks", () => {
    expect(splitEntries(`I pay 100${NL}I paid gas 200`).length).toBe(2);
  });

  it("splits a line break and a join together", () => {
    expect(splitEntries(`I pay 100 and also I pay 50${NL}I paid gas 200`).length).toBe(3);
  });
});

describe("what it leaves alone", () => {
  it("gives back one piece for an ordinary sentence", () => {
    expect(splitEntries("I paid 250 for gas using cash")).toEqual([
      "I paid 250 for gas using cash",
    ]);
  });

  it("is empty for an empty message", () => {
    expect(splitEntries("")).toEqual([]);
    expect(splitEntries(`   ${NL}  ${NL} `)).toEqual([]);
  });

  it("drops a fragment too short to be anything", () => {
    expect(splitEntries("I paid 100 then a")).toEqual(["I paid 100"]);
  });

  it("trims each piece", () => {
    for (const part of splitEntries("I pay 100  and also   I pay 50")) {
      expect(part).toBe(part.trim());
    }
  });
});

/**
 * A clause borrows the verb of the one before it.
 *
 * "I paid 500 for food from gcash, then 300 for gas from cash, then 250 for
 * fun from maya" is three payments in English. The split was already right;
 * the pieces were not readable, because `readEntry` needs a verb to decide
 * which way the money went and the second and third clauses have none. Two of
 * the three payments were dropped for not looking like entries.
 */
describe("splitEntries lends the first verb to a clause that has none", () => {
  it("puts the verb on a clause that opens with a figure", () => {
    expect(
      splitEntries("I paid 500 for food from gcash, then 300 for gas from cash"),
    ).toEqual(["I paid 500 for food from gcash,", "I paid 300 for gas from cash"]);
  });

  it("does it for every later clause, not just the second", () => {
    const parts = splitEntries(
      "I paid 500 for food from gcash, then 300 for gas from cash, then 250 for fun from maya",
    );
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part.startsWith("I paid")).toBe(true);
  });

  /**
   * The safety property. Lending "I borrowed" to a clause that says "gave"
   * would turn a gift into a loan, which is a wrong row rather than a
   * discarded guess.
   */
  it("leaves a clause that has its own verb alone", () => {
    expect(
      splitEntries(
        "I borrowed 2000 on maya credit into gcash, then paid 500 for food, then gave 300 to my mom",
      ),
    ).toEqual([
      "I borrowed 2000 on maya credit into gcash,",
      "paid 500 for food,",
      "gave 300 to my mom",
    ]);
  });

  it("lends nothing when the lead-in is a sentence rather than a verb", () => {
    const long = "on the way home from school yesterday afternoon I paid 500 for food, then 300 for gas";
    expect(splitEntries(long)[1]).toBe("300 for gas");
  });

  it("lends nothing when there is only one clause", () => {
    expect(splitEntries("I paid 500 for food from gcash")).toEqual([
      "I paid 500 for food from gcash",
    ]);
  });

  it("handles a peso sign on the borrowed clause", () => {
    expect(splitEntries("I paid ₱500 for food, then ₱300 for gas")).toEqual([
      "I paid ₱500 for food,",
      "I paid ₱300 for gas",
    ]);
  });
});
