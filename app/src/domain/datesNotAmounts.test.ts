/**
 * The owner's own sentences, 26 September 2026: a day read as an amount, a
 * year checked as one, and "maya cash back" filed into Cash.
 */
import { describe, expect, it } from "vitest";

import { withoutDays } from "./money";
import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";
import { verifyReading } from "./verify";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Random"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

describe("a date is not an amount", () => {
  it("takes out a day written with its month", () => {
    expect(withoutDays("in September 13 2026 the amount is 4.25")).not.toMatch(/13|2026/);
    expect(withoutDays("paid 300 on 13 sept")).toContain("300");
    expect(withoutDays("paid 300 on 13 sept")).not.toContain("13");
  });

  it("leaves Tagalog 'may' alone", () => {
    expect(withoutDays("may 30 pa ako")).toContain("30");
    expect(withoutDays("spent 500 on May 5, 2026")).not.toMatch(/\b5\b|2026/);
  });

  it("reads the owner's cash back as PHP 4.25 into Maya, with nothing to check", () => {
    const said = "I recieved maya cash back in September 13 2026 the amount is 4.25";
    const read = readEntry(said, [], reference, "2026-09-27");
    expect(read.draft.amount).toBe(425);
    expect(read.draft.toWallet).toBe("Maya");
    expect(verifyReading(read.draft, said, reference, "2026-09-27").notes.filter((n) => /You wrote/.test(n))).toEqual([]);
  });

  it("reads the online buy as its amount, not the year", () => {
    const said = "I paid another online buy in September 16 2026 maya 745.48";
    const read = readEntry(said, [], reference, "2026-09-27");
    expect(read.draft.amount).toBe(74548);
    expect(verifyReading(read.draft, said, reference, "2026-09-27").notes.filter((n) => /You wrote/.test(n))).toEqual([]);
  });
});
