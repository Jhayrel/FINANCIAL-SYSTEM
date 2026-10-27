/** The owner's Maya receipt of 27 October 2026, read as October 7 (`pictureDay.ts`). */
import { describe, expect, it } from "vitest";
import { pictureDay, timeInFileName } from "./pictureDay";

const name = "Screenshot_20261027_093437_Maya.jpg";

describe("a screenshot's day against the day it was saved", () => {
  it("reads the time in the file name", () => {
    expect(timeInFileName(name)).toEqual({ hours: 9, minutes: 34 });
  });

  it("puts back a day that lost a digit, when the time is the screenshot's", () => {
    const fixed = pictureDay({ date: "2026-10-07", notes: "09:34", description: "TM 15" }, name);
    expect(fixed?.date).toBe("2026-10-27");
    expect(fixed?.note).toContain("the screenshot was saved on October 27, 2026");
  });

  it("never dates a payment after its screenshot", () => {
    expect(pictureDay({ date: "2026-10-29", notes: "", description: "" }, name)?.date).toBe("2026-10-27");
  });

  it("keeps an older payment's own day", () => {
    // A history screenshot: an earlier row at another time.
    expect(pictureDay({ date: "2026-10-07", notes: "14:10", description: "" }, name)).toBeNull();
    expect(pictureDay({ date: "2026-10-20", notes: "09:34", description: "" }, name)).toBeNull();
    expect(pictureDay({ date: "2026-10-07", notes: "", description: "" }, name)).toBeNull();
    expect(pictureDay({ date: "2026-10-07", notes: "09:34", description: "" }, "IMG_4410.jpg")).toBeNull();
  });
});
