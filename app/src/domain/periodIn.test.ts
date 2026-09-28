import { describe, expect, it } from "vitest";

import { windowOf } from "./charts";
import { exportWords, readExportAsk } from "./exportAsk";
import { spanIn } from "./periodIn";

/**
 * A period said any way, for charts and statements alike.
 *
 * 28 September 2026: "trend of revenue and spending march 2026 to today" drew
 * today alone, and "generate pdf of account statement january 2026 to june
 * 2026" made a statement for January. The owner: "make sure it works to all
 * kind of scenario".
 */

const TODAY = "2026-09-28";
const win = (said: string) => {
  const w = windowOf(said, TODAY);
  return [w.from, w.to];
};

describe("a chart's window, when it is a range", () => {
  it("runs to today when the range ends today", () => {
    expect(win("trend of revenue and spending march 2026 to today")).toEqual(["2026-03-01", TODAY]);
    expect(win("trend os revenue and spending march 2026 to today")).toEqual(["2026-03-01", TODAY]);
    expect(windowOf("trend of revenue and spending march 2026 to today", TODAY).name).toBe("March 2026 to today");
    expect(win("chart my food from march to now")).toEqual(["2026-03-01", TODAY]);
    expect(win("spending march 2026 up to present")).toEqual(["2026-03-01", TODAY]);
    expect(win("2026-03-01 to today")).toEqual(["2026-03-01", TODAY]);
    expect(win("yesterday to today")).toEqual(["2026-09-27", TODAY]);
    expect(win("last month to today")).toEqual(["2026-08-01", TODAY]);
  });

  it("reads months, days and years at either end, across years", () => {
    expect(win("jan 2026 - jun 2026")).toEqual(["2026-01-01", "2026-06-30"]);
    expect(win("january to june 2026")).toEqual(["2026-01-01", "2026-06-30"]);
    expect(win("november to february 2026")).toEqual(["2025-11-01", "2026-02-28"]);
    expect(win("december 2025 to february 2026")).toEqual(["2025-12-01", "2026-02-28"]);
    expect(win("5 march 2026 to 20 april 2026")).toEqual(["2026-03-05", "2026-04-20"]);
    expect(win("march 5, 2026 until april 20, 2026")).toEqual(["2026-03-05", "2026-04-20"]);
    expect(win("between may and july")).toEqual(["2026-05-01", "2026-07-31"]);
    expect(win("2024 to 2025")).toEqual(["2024-01-01", "2025-12-31"]);
    expect(win("spending june 2025 through march 2026 by month")).toEqual(["2025-06-01", "2026-03-31"]);
  });

  it("runs from a named start to today", () => {
    expect(win("since march 2026")).toEqual(["2026-03-01", TODAY]);
    expect(win("since last month")).toEqual(["2026-08-01", TODAY]);
    expect(win("my food since august 15")).toEqual(["2026-08-15", TODAY]);
  });

  it("still reads one point the way it always did", () => {
    expect(win("today")).toEqual([TODAY, TODAY]);
    expect(win("chart august")).toEqual(["2026-08-01", "2026-08-31"]);
    expect(win("2025")).toEqual(["2025-01-01", "2025-12-31"]);
    expect(win("last month")).toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("does not read the verb may as a month", () => {
    expect(spanIn("I may spend 500 to 600 on food", TODAY)).toBeNull();
  });
});

describe("a statement asked for in words", () => {
  it("covers the whole range, not its first month", () => {
    const ask = readExportAsk("can you generate pdf of account statement january 2026 to june 2026", TODAY);
    expect(ask).toMatchObject({ kind: "statement", type: "account", year: 2026, fromMonth: 1, toMonth: 6, toYear: 2026, format: "pdf" });
    expect(ask ? exportWords(ask, TODAY) : "").toContain("January 2026 to June 2026");
  });

  it("runs across years", () => {
    const ask = readExportAsk("statement january 2025 to june 2026", TODAY);
    expect(ask).toMatchObject({ year: 2025, fromMonth: 1, toMonth: 6, toYear: 2026 });
  });

  it("runs to this month when it ends today, and says so far", () => {
    const ask = readExportAsk("pdf statement march 2026 to today", TODAY);
    expect(ask).toMatchObject({ year: 2026, fromMonth: 3, toMonth: 9, toYear: 2026 });
    expect(ask ? exportWords(ask, TODAY) : "").toContain("so far");
  });

  it("keeps one month as one month", () => {
    expect(readExportAsk("export my september spending as csv", TODAY)).toMatchObject({ fromMonth: 9, toMonth: 9, format: "csv" });
  });
});
