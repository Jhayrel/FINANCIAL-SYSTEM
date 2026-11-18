/**
 * "Half to one wallet and half to another" is two entries (owner's "//"
 * note of 5 September 2026, replayed on 16 November). Invented figures.
 */

import { describe, expect, it } from "vitest";

import { splitEntries } from "./readEntry";

describe("half to one wallet and half to another", () => {
  it("makes two entries of half each", () => {
    expect(splitEntries("I earned 9000 from my job on the 2nd, half went to maya and half to gcash")).toEqual([
      "I earned 4500 from my job on the 2nd into maya",
      "I earned 4500 from my job on the 2nd into gcash",
    ]);
  });

  it("keeps the centavos exact", () => {
    expect(splitEntries("received 1,000.50, half to maya and half to cash")).toEqual(["received 500.25 into maya", "received 500.25 into cash"]);
  });

  it("leaves an odd centavo whole for the card to ask about", () => {
    expect(splitEntries("received 1,000.25, half to maya and half to cash")).toHaveLength(1);
  });

  it("keeps the entries said after it", () => {
    const parts = splitEntries("I earned 9000 from my job, half went to maya and half to gcash, then I moved 2000 into savings");
    expect(parts).toHaveLength(3);
    expect(parts[2]).toContain("2000");
  });

  it("leaves a sentence with two figures alone", () => {
    expect(splitEntries("I earned 9000 and 500 tips, half to maya and half to gcash")).not.toContain("I earned 4500");
  });
});
