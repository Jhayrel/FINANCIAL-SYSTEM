/**
 * A list where every row carries its own date, written without a year.
 *
 * 2 October 2026: a bank's interest list, one small credit a day, came back
 * as four cards all dated that day, and five more rows were dropped as the
 * overlap of a stitched screenshot. Its dates had no year, so none was known
 * as a date: every row sat under no day at all, and one day's "Interest
 * earned 0.15" was taken for the next day's. The layouts below are invented
 * in the shapes such lists come in.
 */
import { describe, expect, it } from "vitest";

import { DATE_LINE, dropRepeats, rowDatesIn } from "./ocrText";

const TAKEN = "2026-10-02";

describe("a date with no year is a date", () => {
  it("is known as a date line in every usual shape, alone on its line", () => {
    for (const line of ["Oct 1", "Oct 1, 11:59 PM", "October 1st", "01 Oct", "Wed, 01 Oct", "10/01/2026", "Today, 11:59 PM", "Yesterday"]) {
      expect(DATE_LINE.test(line), line).toBe(true);
    }
  });

  it("is not found in a row's own words", () => {
    for (const line of ["Sep 30 bill payment", "may 5 pa ako", "Interest earned", "06:31 PM"]) {
      expect(DATE_LINE.test(line), line).toBe(false);
    }
  });
});

describe("each row's own date", () => {
  it("under the figure: each date belongs to the row above it", () => {
    const text = [
      "Interest earned",
      "+₱0.15",
      "Oct 2, 12:01 AM",
      "Interest earned",
      "+₱0.10",
      "Oct 1, 12:01 AM",
      "Interest earned",
      "+₱0.10",
      "Sep 30, 12:01 AM",
      "Interest earned",
      "+₱0.15",
      "Sep 29, 12:01 AM",
    ].join("\n");
    expect(rowDatesIn(text, TAKEN)).toEqual([
      { amount: 15, date: "2026-10-02" },
      { amount: 10, date: "2026-10-01" },
      { amount: 10, date: "2026-09-30" },
      { amount: 15, date: "2026-09-29" },
    ]);
  });

  it("over the figure: each date belongs to the row under it", () => {
    const text = ["Oct 2", "Interest earned +₱0.15", "Oct 1", "Interest earned +₱0.10", "Sep 30", "Interest earned +₱0.10"].join("\n");
    expect(rowDatesIn(text, TAKEN).map((r) => r.date)).toEqual(["2026-10-02", "2026-10-01", "2026-09-30"]);
  });

  it("on the row's own line", () => {
    const text = ["Interest earned 02 Oct +₱0.15", "Interest earned 01 Oct +₱0.10"].join("\n");
    expect(rowDatesIn(text, TAKEN).map((r) => r.date)).toEqual(["2026-10-02", "2026-10-01"]);
  });

  it("across the year end, last December's", () => {
    const text = ["Interest earned", "+₱0.15", "Jan 1, 12:01 AM", "Interest earned", "+₱0.15", "Dec 31, 12:01 AM"].join("\n");
    expect(rowDatesIn(text, "2027-01-02").map((r) => r.date)).toEqual(["2027-01-01", "2026-12-31"]);
  });

  it("leaves a history grouped under headings as it was", () => {
    const text = [
      "Today",
      "Approved Purchase on 1 hour ago",
      "Corner store - ₱399.00",
      "Received money from 4 hours ago",
      "A friend ₱500.00",
      "September 26, 2026",
      "Approved Purchase on 06:31 PM",
      "Convenience store - ₱185.00",
      "Withdrawal from 04:41 PM",
      "An ATM - ₱218.00",
    ].join("\n");
    expect(rowDatesIn(text, TAKEN).map((r) => r.date)).toEqual(["2026-10-02", "2026-10-02", "2026-09-26", "2026-09-26"]);
  });
});

describe("a stitched screenshot of a daily list", () => {
  it("keeps every day, and drops only the rows shown twice", () => {
    const day = (d: string, amount: string): string[] => ["Interest earned", `+₱${amount}`, `${d}, 12:01 AM`];
    const first = [...day("Oct 2", "0.15"), ...day("Oct 1", "0.10"), ...day("Sep 30", "0.10"), ...day("Sep 29", "0.15")];
    // The second capture starts two rows back: Sep 30 and Sep 29 again, then two more days.
    const second = [...day("Sep 30", "0.10"), ...day("Sep 29", "0.15"), ...day("Sep 28", "0.15"), ...day("Sep 27", "0.10")];
    const { text, dropped } = dropRepeats([...first, ...second].join("\n"));
    expect(dropped).toBe(2);
    expect(rowDatesIn(text, TAKEN).map((r) => r.date)).toEqual([
      "2026-10-02",
      "2026-10-01",
      "2026-09-30",
      "2026-09-29",
      "2026-09-28",
      "2026-09-27",
    ]);
  });
});
