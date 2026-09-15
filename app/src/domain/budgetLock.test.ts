/**
 * The real cases for changing a budget, one test each where it can be.
 * See the list at the top of `budgetLock.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  describeRevision,
  GRACE_DAYS,
  MAX_REVISIONS,
  monthHistory,
  monthLock,
  monthMarks,
  saveLimit,
  saveTracks,
  undoLast,
} from "./budgetLock";
import { applyPlan, withMonthPlan } from "./budgetView";
import type { BudgetYear } from "./types";

const EMPTY: BudgetYear = {
  spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

const AT = "2026-09-15T02:00:00.000Z";
const LATER = "2026-09-22T02:00:00.000Z";
const SEPT = { spending: 600000, billsSubs: 170000 };

describe("when a month takes changes", () => {
  it("keeps the last day of the month open, and grace starts the day after (B1, B4)", () => {
    expect(monthLock(2026, 9, "2026-09-30").state).toBe("open");
    expect(monthLock(2026, 9, "2026-10-01")).toMatchObject({ state: "grace", editableUntil: "2026-10-05", daysLeft: 5 });
    expect(monthLock(2026, 9, "2026-10-05")).toMatchObject({ state: "grace", daysLeft: 1 });
    expect(monthLock(2026, 9, "2026-10-06").state).toBe("closed");
    expect(GRACE_DAYS).toBe(5);
  });

  it("keeps a month ahead open, and crosses the year for December", () => {
    expect(monthLock(2027, 1, "2026-09-15").state).toBe("open");
    expect(monthLock(2026, 12, "2027-01-03")).toMatchObject({ state: "grace", editableUntil: "2027-01-05" });
    expect(monthLock(2026, 12, "2027-01-06").state).toBe("closed");
  });
});

describe("setting a budget today and changing it next week (B1, B2, B8)", () => {
  const first = saveTracks(EMPTY, 2026, 9, SEPT, "month", "2026-09-15", AT);
  const second = saveTracks(first.plan, 2026, 9, { spending: 800000, billsSubs: 170000 }, "month", "2026-09-22", LATER);

  it("writes the month and keeps what it was", () => {
    expect(first.written).toEqual([9]);
    expect(first.plan.spending[8]).toBe(600000);
    expect(first.revisions[0]).toMatchObject({ what: "tracks", wasSpending: 0, spending: 600000, when: "open" });
  });

  it("keeps both changes, oldest first, and shows them newest first", () => {
    expect(second.plan.revisions?.["9"]).toHaveLength(2);
    expect(monthHistory(second.plan, 9).map((r) => r.spending)).toEqual([800000, 600000]);
    expect(describeRevision(monthHistory(second.plan, 9)[0]!)).toBe("Changed from ₱7,700.00 to ₱9,700.00");
  });

  it("records nothing when nothing changed", () => {
    const same = saveTracks(second.plan, 2026, 9, { spending: 800000, billsSubs: 170000 }, "month", "2026-09-23", LATER);
    expect(same.written).toEqual([]);
    expect(same.plan.revisions?.["9"]).toHaveLength(2);
  });

  it("changes it on the last day of the month like any other day", () => {
    const lastDay = saveTracks(second.plan, 2026, 9, SEPT, "month", "2026-09-30", LATER);
    expect(lastDay.written).toEqual([9]);
    expect(lastDay.revisions[0]?.when).toBe("open");
  });
});

describe("undoing a change you decided was wrong (B3)", () => {
  const set = saveTracks(EMPTY, 2026, 9, SEPT, "month", "2026-09-15", AT);
  const raised = saveTracks(set.plan, 2026, 9, { spending: 900000, billsSubs: 170000 }, "month", "2026-09-16", LATER);

  it("puts back what the last change replaced, and says so", () => {
    const undone = undoLast(raised.plan, 2026, 9, "2026-09-16", LATER);
    expect(undone.plan.spending[8]).toBe(600000);
    expect(monthHistory(undone.plan, 9)[0]?.reason).toBe("Undid the last change");
  });

  it("does nothing for a month with no changes", () => {
    expect(undoLast(EMPTY, 2026, 9, "2026-09-16", LATER).refused).toMatch(/Nothing has changed/);
  });

  it("will not undo in a closed month", () => {
    expect(undoLast(raised.plan, 2026, 9, "2026-11-01", LATER).refused).toMatch(/closed/);
  });
});

describe("forgetting to set last month's budget (B4, B5)", () => {
  it("sets it in the days after the month ended, marked as late", () => {
    const late = saveTracks(EMPTY, 2026, 8, SEPT, "month", "2026-09-03", AT);
    expect(late.written).toEqual([8]);
    expect(late.revisions[0]?.when).toBe("grace");
    expect(monthMarks(late.plan, 8)).toEqual({ late: true, corrected: false });
    expect(describeRevision(late.revisions[0]!)).toBe("Set to ₱7,700.00, after the month ended");
  });

  it("refuses a closed month without a reason", () => {
    const refused = saveTracks(EMPTY, 2026, 7, SEPT, "month", "2026-09-15", AT);
    expect(refused.refused).toMatch(/closed/);
    expect(refused.plan).toBe(EMPTY);
  });

  it("corrects a closed month with a reason, and shows it as a correction", () => {
    const fixed = saveTracks(EMPTY, 2026, 7, SEPT, "month", "2026-09-15", AT, "Forgot to set it");
    expect(fixed.written).toEqual([7]);
    expect(fixed.revisions[0]).toMatchObject({ when: "closed", reason: "Forgot to set it" });
    expect(monthMarks(fixed.plan, 7)).toEqual({ late: false, corrected: true });
    expect(describeRevision(fixed.revisions[0]!)).toBe("Correction: set to ₱7,700.00. Forgot to set it");
  });

  it("corrects a closed month only on its own", () => {
    expect(saveTracks(EMPTY, 2026, 7, SEPT, "rest", "2026-09-15", AT, "Wrong all year").refused).toMatch(/on its own/);
  });
});

describe("saving to more than one month (B6)", () => {
  it("writes only the months still running or ahead, and lists the rest", () => {
    const all = saveTracks(EMPTY, 2026, 9, SEPT, "year", "2026-09-15", AT);
    expect(all.written).toEqual([9, 10, 11, 12]);
    expect(all.skipped).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(all.plan.spending.slice(0, 8).every((v) => v === 0)).toBe(true);
  });

  it("writes a month in grace when it is the month being saved, and nothing else that is over", () => {
    const fromAugust = saveTracks(EMPTY, 2026, 8, SEPT, "rest", "2026-09-03", AT);
    expect(fromAugust.written).toEqual([8, 9, 10, 11, 12]);
    expect(fromAugust.skipped).toEqual([]);
    const allYear = saveTracks(EMPTY, 2026, 8, SEPT, "year", "2026-09-03", AT);
    expect(allYear.skipped).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("limits follow the same rules (B7)", () => {
  it("sets a limit in an open month and keeps the tracks", () => {
    const set = saveLimit(EMPTY, 2026, 9, "Food", 300000, "rest", "2026-09-15", AT);
    expect(set.written).toEqual([9, 10, 11, 12]);
    expect(set.plan.categories?.["Food"]?.[8]).toBe(300000);
    expect(set.plan.spending).toEqual(EMPTY.spending);
    expect(describeRevision(set.revisions[0]!)).toBe("Food limited to ₱3,000.00");
  });

  it("refuses a closed month's limit without a reason", () => {
    expect(saveLimit(EMPTY, 2026, 7, "Food", 300000, "month", "2026-09-15", AT).refused).toMatch(/closed/);
  });

  it("removes a limit and takes the kind off the year once no month has one", () => {
    const set = saveLimit(EMPTY, 2026, 9, "Food", 300000, "month", "2026-09-15", AT);
    const removed = saveLimit(set.plan, 2026, 9, "Food", 0, "month", "2026-09-15", LATER);
    expect(removed.plan.categories).toBeUndefined();
    expect(describeRevision(removed.revisions[0]!)).toBe("Food limit removed");
  });

  it("undoes a limit change", () => {
    const set = saveLimit(EMPTY, 2026, 9, "Food", 300000, "month", "2026-09-15", AT);
    const undone = undoLast(set.plan, 2026, 9, "2026-09-15", LATER);
    expect(undone.plan.categories).toBeUndefined();
  });
});

describe("the record survives", () => {
  it("keeps no more than the most recent changes of a month", () => {
    let plan = EMPTY;
    for (let i = 1; i <= MAX_REVISIONS + 5; i++) {
      plan = saveTracks(plan, 2026, 9, { spending: i * 10000, billsSubs: 0 }, "month", "2026-09-15", AT).plan;
    }
    expect(plan.revisions?.["9"]).toHaveLength(MAX_REVISIONS);
    expect(monthHistory(plan, 9)[0]?.spending).toBe((MAX_REVISIONS + 5) * 10000);
  });

  it("is kept by the budget functions that rebuild a year", () => {
    const changed = saveTracks(EMPTY, 2026, 9, SEPT, "month", "2026-09-15", AT).plan;
    expect(applyPlan(changed, 10, SEPT, "month").revisions).toEqual(changed.revisions);
    expect(withMonthPlan(changed, 11, SEPT).revisions).toEqual(changed.revisions);
  });
});
