/**
 * Sums a model says it did (owner, 17 November 2026: an answer added two
 * figures, stated a total they do not make, and the check passed it). The
 * two answers are the owner's screenshot's words with invented figures.
 */
import { describe, expect, it } from "vitest";

import { sumNote, sumSlips } from "./sumCheck";

describe("a sum said in words is worked out", () => {
  it("adding this to that: this is the last figure before it", () => {
    const answer = "Your spending wallets hold **PHP 2,400.00**, and after paying PHP 200.00 for a bill and holding PHP 1,500.00 for your allocations, you have **PHP 700.00** in safe to spend. Adding this to the PHP 15,000.00 you have already spent this month makes a total possible spending budget of **PHP 17,200.00**.";
    const slips = sumSlips(answer);
    expect(slips).toHaveLength(1);
    expect(slips[0]?.worked).toBe(1_570_000);
    expect(sumNote(answer)).toBe("A sum in this answer does not add up: ₱700.00 and ₱15,000.00 make ₱15,700.00, not ₱17,200.00.");
  });

  it("produced by adding: the result is the figure before it", () => {
    const answer = "The calculation of PHP 17,200.00 as your maximum possible spending budget is accurate. It is produced by adding the PHP 15,000.00 you have already spent this month to the PHP 700.00 currently in your safe to spend.";
    expect(sumNote(answer)).toBe("A sum in this answer does not add up: ₱15,000.00 and ₱700.00 make ₱15,700.00, not ₱17,200.00.");
  });

  it("a right sum says nothing", () => {
    expect(sumNote("Adding the PHP 700.00 to the PHP 15,000.00 already spent makes PHP 15,700.00.")).toBe("");
    expect(sumNote("PHP 1,000.00 plus PHP 250.50 is PHP 1,250.50.")).toBe("");
    expect(sumNote("PHP 1,000.00 minus PHP 250.50 leaves PHP 749.50.")).toBe("");
  });

  it("the plain shapes", () => {
    expect(sumNote("PHP 1,000.00 + PHP 250.00 = PHP 1,300.00")).toContain("make ₱1,250.00, not ₱1,300.00");
    expect(sumNote("PHP 1,000.00 less PHP 250.00 is PHP 800.00.")).toContain("leaves ₱750.00, not ₱800.00");
  });

  it("a figure beside a sum word that is not a sum is left alone", () => {
    expect(sumNote("Adding PHP 500.00 to your Gcash means your wallets are at PHP 3,000.00.")).toBe("");
    expect(sumNote("You spent PHP 4,000.00 on food and PHP 900.00 on gas, and your safe to spend is PHP 300.00.")).toBe("");
    expect(sumNote("Adding a plan for PHP 500.00 to the Planner gives it a date.")).toBe("");
  });
});
