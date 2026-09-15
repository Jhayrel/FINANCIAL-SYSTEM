/**
 * What a debt costs to leave unpaid, in the two shapes debts really take.
 */

import { describe, expect, it } from "vitest";

import { costOfWaiting, interestCost, interestShareWords, projectedInterest } from "./debtInterest";

const monthly = { interestType: "monthly_pct" as const, interestRate: 755 };
const flat = { interestType: "flat" as const, interestRate: 755 };
const free = { interestType: "none" as const, interestRate: 0 };

describe("interest expected between two dates", () => {
  it("charges nothing on a debt with no interest, or with nothing owed", () => {
    expect(projectedInterest(free, 250000, "2026-09-01", "2026-12-01").amount).toBe(0);
    expect(projectedInterest(monthly, 0, "2026-09-01", "2026-12-01").amount).toBe(0);
    expect(projectedInterest(monthly, -500, "2026-09-01", "2026-12-01").amount).toBe(0);
  });

  it("charges a flat fee once, however long the balance sits", () => {
    const month = projectedInterest(flat, 250000, "2026-09-01", "2026-10-01");
    const year = projectedInterest(flat, 250000, "2026-09-01", "2027-09-01");
    // 7.55% of PHP 2,500.00, charged once.
    expect(month.amount).toBe(18875);
    expect(month.cycles).toBe(1);
    expect(year.amount).toBe(18875);
    expect(year.owedAfter).toBe(268875);
  });

  it("compounds a monthly rate, cycle by cycle", () => {
    const one = projectedInterest(monthly, 250000, "2026-09-01", "2026-10-01");
    expect(one).toMatchObject({ amount: 18875, cycles: 1, kind: "monthly", owedAfter: 268875 });

    // The second cycle charges on the first cycle's interest too: 7.55% of 268,875.
    const two = projectedInterest(monthly, 250000, "2026-09-01", "2026-11-01");
    expect(two.cycles).toBe(2);
    expect(two.amount).toBe(18875 + Math.round((268875 * 755) / 10000));
    expect(two.amount).toBeGreaterThan(one.amount * 2 - 1);
  });

  it("counts whole cycles only, so paying inside the cycle owes nothing more", () => {
    expect(projectedInterest(monthly, 250000, "2026-09-01", "2026-09-30").amount).toBe(0);
    expect(projectedInterest(monthly, 250000, "2026-09-01", "2026-09-01").amount).toBe(0);
    // A cycle from the 31st lands on the last day of a short month, as addMonths clamps.
    expect(projectedInterest(monthly, 250000, "2026-01-31", "2026-02-28").cycles).toBe(1);
  });

  it("answers what one more cycle costs", () => {
    expect(costOfWaiting(monthly, 295000, "2026-09-16").amount).toBe(Math.round((295000 * 755) / 10000));
    expect(costOfWaiting(free, 295000, "2026-09-16").amount).toBe(0);
  });
});

describe("what interest has cost against what was borrowed", () => {
  it("gives the share, and says it in words", () => {
    const cost = interestCost({ interestPaid: 93879, drawn: 520000 });
    expect(cost.paid).toBe(93879);
    expect(cost.borrowed).toBe(520000);
    expect(Math.round((cost.share ?? 0) * 100)).toBe(18);
    expect(interestShareWords(cost)).toBe("18%");
  });

  it("says nothing when nothing was borrowed or nothing was paid", () => {
    expect(interestCost({ interestPaid: 0, drawn: 0 }).share).toBeNull();
    expect(interestShareWords(interestCost({ interestPaid: 0, drawn: 500000 }))).toBe("");
    expect(interestShareWords(interestCost({ interestPaid: 100, drawn: 500000 }))).toBe("under 1%");
  });
});
