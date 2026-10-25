/**
 * Days named by weekday, by "days ago" and by date alone (26 October 2026:
 * "make the ai etc knows days, time etc"). 25 October 2026 is a Sunday.
 */
import { describe, expect, it } from "vitest";

import { dayFromWords, daysAgoIn } from "./dayWords";
import { readEntry } from "./readEntry";
import type { ReferenceLists } from "./types";

const SUNDAY = "2026-10-25";
const reference: ReferenceLists = { wallets: ["Cash", "Gcash"], savings: [], bills: [], subscriptions: [], revenueCategories: ["Allowance"], spendingTypes: [{ name: "Food", remark: "" }, { name: "Gas", remark: "" }] };

describe("a weekday", () => {
  it("alone is the latest one, today included; 'last' is the one before today", () => {
    expect(dayFromWords("food 150 on friday", SUNDAY)).toBe("2026-10-23");
    expect(dayFromWords("I spent 200 gas last friday", SUNDAY)).toBe("2026-10-23");
    expect(dayFromWords("food 100 sunday", SUNDAY)).toBe(SUNDAY);
    expect(dayFromWords("food 100 last sunday", SUNDAY)).toBe("2026-10-18");
    expect(dayFromWords("food 100 last week monday", SUNDAY)).toBe("2026-10-12");
  });

  it("in Filipino, and 'linggo' as Sunday only after noong or nung", () => {
    expect(dayFromWords("food 100 noong lunes", SUNDAY)).toBe("2026-10-19");
    expect(dayFromWords("food 100 nung biyernes", SUNDAY)).toBe("2026-10-23");
    expect(dayFromWords("food 100 nung linggo", "2026-10-27")).toBe(SUNDAY);
    expect(dayFromWords("food 100 isang linggo", SUNDAY)).toBeNull();
  });
});

describe("days ago, the 23rd, and parts of today", () => {
  it("counts back", () => {
    expect(daysAgoIn("gas 200 2 days ago")).toBe(2);
    expect(daysAgoIn("three days ago")).toBe(3);
    expect(daysAgoIn("a week ago")).toBe(7);
    expect(daysAgoIn("2 weeks ago")).toBe(14);
    expect(daysAgoIn("3 araw na ang nakalipas")).toBe(3);
  });

  it("reads a day of the month as this month once it has come, else last month", () => {
    expect(dayFromWords("food 100 on the 23rd", SUNDAY)).toBe("2026-10-23");
    expect(dayFromWords("food 100 on the 28th", SUNDAY)).toBe("2026-09-28");
    expect(dayFromWords("food 100 on the 31st", "2026-10-05")).toBe(null);
  });

  it("keeps this morning and tonight on today", () => {
    expect(dayFromWords("food 100 this morning", SUNDAY)).toBe(SUNDAY);
    expect(dayFromWords("food 100 kaninang umaga", SUNDAY)).toBe(SUNDAY);
  });
});

describe("an entry typed with them", () => {
  it("is dated that day, and the day's figures are never the amount", () => {
    const at = (q: string) => readEntry(q, [], reference, SUNDAY).draft;
    expect(at("I spent 200 gas last friday")).toMatchObject({ date: "2026-10-23", amount: 20000 });
    expect(at("on the 23rd food 100")).toMatchObject({ date: "2026-10-23", amount: 10000 });
    expect(at("2 days ago spent 50 for food")).toMatchObject({ date: "2026-10-23", amount: 5000 });
    expect(at("food 100 kahapon")).toMatchObject({ date: "2026-10-24", amount: 10000 });
  });
});

describe("the calendar the AI is given", () => {
  it("names the time, every one of the last seven days, and the weeks", async () => {
    const { calendarLines } = await import("./dates");
    const lines = calendarLines(SUNDAY, new Date(2026, 9, 25, 21, 42));
    expect(lines[0]).toBe("Today is Sunday, October 25, 2026 (2026-10-25), 9:42 PM, evening by the phone's clock. Tomorrow is Monday, October 26 (2026-10-26).");
    expect(lines[1]).toContain("Friday, October 23 (2026-10-23, the day before yesterday)");
    expect(lines[1]).toContain("Sunday, October 18 (2026-10-18, 7 days ago)");
    expect(lines[2]).toContain("(Friday is 2026-10-23)");
    expect(lines[2]).toContain("this week 2026-10-19 to 2026-10-25, last week 2026-10-12 to 2026-10-18, next week 2026-10-26 to 2026-11-01");
    expect(lines[3]).toBe("October 2026 has 31 days: today is day 25, with 7 left counting today. November 2026 starts on Sunday, November 1.");
    expect(calendarLines(SUNDAY)[0]).toBe("Today is Sunday, October 25, 2026 (2026-10-25). Tomorrow is Monday, October 26 (2026-10-26).");
  });
});
