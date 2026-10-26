import { describe, expect, it } from "vitest";

import type { ActivityEvent } from "./activity";
import { inPeriod, matchesSearch, periodDays } from "./activityFilter";

const now = new Date(2026, 9, 27, 15, 0); // 27 October 2026, the device's own day
const ev = (at: Date, over: Partial<ActivityEvent> = {}): ActivityEvent => ({ id: "e", at: at.toISOString(), actor: "owner", via: "manual", action: "transaction.create", summary: "Added Tuition, School, PHP 9,000.00", ...over });

describe("the period the Activity list and its PDF show", () => {
  it("covers whole calendar days", () => {
    expect(periodDays("today", now)).toEqual({ from: "2026-10-27", to: "2026-10-27" });
    expect(periodDays("week", now)).toEqual({ from: "2026-10-21", to: "2026-10-27" });
    expect(periodDays("month", now)).toEqual({ from: "2026-10-01", to: "2026-10-27" });
    expect(periodDays("lastMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodDays("lastMonth", new Date(2026, 0, 5))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodDays("year", now)).toEqual({ from: "2026-01-01", to: "2026-10-27" });
    expect(periodDays("all", now)).toBeNull();
  });
  it("puts an event in it by its own day", () => {
    expect(inPeriod(ev(new Date(2026, 9, 27, 0, 5)), "today", now)).toBe(true);
    expect(inPeriod(ev(new Date(2026, 9, 26, 23, 55)), "today", now)).toBe(false);
    expect(inPeriod(ev(new Date(2026, 8, 30, 12)), "lastMonth", now)).toBe(true);
    expect(inPeriod(ev(new Date(2026, 8, 30, 12)), "month", now)).toBe(false);
  });
});

describe("the search", () => {
  const e = ev(now, { recordNumber: 3933, amount: 933_700, summary: "Added Travel, Cash, PHP 9,337.00", after: "Spending | Cash | Travel to Abra" });
  it("finds words, a record number and an amount", () => {
    expect(matchesSearch(e, "abra")).toBe(true);
    expect(matchesSearch(e, "travel cash")).toBe(true);
    expect(matchesSearch(e, "#3933")).toBe(true);
    expect(matchesSearch(e, "3933")).toBe(true);
    expect(matchesSearch(e, "#03933")).toBe(true);
    expect(matchesSearch(e, "9337")).toBe(true);
    expect(matchesSearch(e, "9,337.00")).toBe(true);
  });
  it("needs every word", () => {
    expect(matchesSearch(e, "travel gcash")).toBe(false);
    expect(matchesSearch(e, "#3934")).toBe(false);
    expect(matchesSearch(e, "")).toBe(true);
  });
});
