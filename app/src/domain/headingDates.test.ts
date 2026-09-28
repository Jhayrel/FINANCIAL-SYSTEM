import { describe, expect, it } from "vitest";

import { emptyDraft } from "./entry";
import { dayInFileName, rowDatesIn } from "./ocrText";
import { datesFromHeadings, type Proposal } from "./proposal";

/**
 * The owner's Maya history, 28 September 2026, as the device reads it. The
 * model dated each group by the heading below it: Today's rows as the 26th,
 * the 26th's as the 24th, the 24th's as the 23rd.
 */
const MAYA = [
  "Transactions",
  "Today",
  "Withdrawal from 1 hour ago",
  "BAUANG CROSSING - ₱1,518.00",
  "Approved Purchase on 1 hour ago",
  "MCDO 878 BAUANG - ₱399.00",
  "Bills Payment for 4 hours ago",
  "Maya Bank - ₱4,302.06",
  "Received money from 4 hours ago",
  "YOUR OWN NAME ₱9,980.00",
  "September 26, 2026",
  "Approved Purchase on 06:31 PM",
  "7-Eleven-ST5906 - ₱185.00",
  "Withdrawal from 04:41 PM",
  "TANQUI SFLU - ₱218.00",
  "September 24, 2026",
  "Withdrawal from 11:00 AM",
  "St.Louis College - ₱516.00",
  "September 23, 2026",
  "Received money from 08:48 PM",
  "Maya ₱1.74",
].join("\n");

const card = (amount: number, date: string): Proposal => ({
  draft: { ...emptyDraft(date), flow: "Spending", amount },
  confidence: "high",
  sourceRef: "Screenshot_20260927_173618_Maya.jpg",
  adjustments: [],
});

describe("a history list's rows take the heading above them", () => {
  it("reads the day a phone wrote into the file name", () => {
    expect(dayInFileName("Screenshot_20260927_173618_Maya.jpg")).toBe("2026-09-27");
    expect(dayInFileName("receipt.jpg")).toBeNull();
    expect(dayInFileName("Screenshot_20261340_1.jpg")).toBeNull();
  });

  it("dates every row by the heading above it, Today being the day it was taken", () => {
    expect(rowDatesIn(MAYA, "2026-09-27").map((r) => [r.amount, r.date])).toEqual([
      [151800, "2026-09-27"],
      [39900, "2026-09-27"],
      [430206, "2026-09-27"],
      [998000, "2026-09-27"],
      [18500, "2026-09-26"],
      [21800, "2026-09-26"],
      [51600, "2026-09-24"],
      [174, "2026-09-23"],
    ]);
  });

  it("puts right the dates the model shifted, and says so on the card", () => {
    const read = [
      card(151800, "2026-09-26"),
      card(18500, "2026-09-24"),
      card(51600, "2026-09-23"),
      card(174, "2026-09-23"),
    ];
    const fixed = datesFromHeadings(read, [MAYA, MAYA], ["2026-09-27", "2026-09-27"], "2026-09-28");
    expect(fixed.map((p) => p.draft.date)).toEqual(["2026-09-27", "2026-09-26", "2026-09-24", "2026-09-23"]);
    expect(fixed[0]?.adjustments.at(-1)).toContain("heading above it");
    // A row already dated right is left alone and says nothing.
    expect(fixed[3]?.adjustments).toEqual([]);
  });

  it("takes Today from an As of line when there is one", () => {
    const gcash = ["Transaction History", "As of Sep 27, 2026", "Today", "12:52 PM", "Sent GCash to Maya Philippi... -9,990.00"].join("\n");
    expect(rowDatesIn(gcash, "2026-09-28")).toEqual([{ amount: 999000, date: "2026-09-27" }]);
  });

  it("changes nothing when the two readings disagree on the day", () => {
    const other = MAYA.replace("September 26, 2026", "September 25, 2026");
    const fixed = datesFromHeadings([card(18500, "2026-09-24")], [MAYA, other], ["2026-09-27", "2026-09-27"], "2026-09-28");
    expect(fixed[0]?.draft.date).toBe("2026-09-24");
  });
});
