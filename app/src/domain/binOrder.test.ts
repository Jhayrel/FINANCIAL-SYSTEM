/** The bin, newest first (owner, 3 November 2026: "make the recent above"). Invented rows. */
import { describe, expect, it } from "vitest";

import { binOrder } from "./binView";

const row = (recordNumber: number, deletedAt?: string) => ({ recordNumber, ...(deletedAt ? { deletedAt } : {}) });

describe("binOrder", () => {
  it("puts the last one binned on top, whatever its record number", () => {
    const rows = [row(3837, "2026-09-27T10:29:34.591Z"), row(3878, "2026-10-02T22:43:41.321Z"), row(3877, "2026-10-02T22:44:35.327Z"), row(3976, "2026-11-03T07:40:12.296Z"), row(3938, "2026-10-13T10:29:22.504Z")];
    expect(binOrder(rows).map((r) => r.recordNumber)).toEqual([3976, 3938, 3877, 3878, 3837]);
  });

  it("the same moment: the higher record first; no time binned goes last; the list given is not changed", () => {
    const rows = [row(10), row(20, "2026-10-01T00:00:00.000Z"), row(21, "2026-10-01T00:00:00.000Z"), row(30)];
    expect(binOrder(rows).map((r) => r.recordNumber)).toEqual([21, 20, 30, 10]);
    expect(rows.map((r) => r.recordNumber)).toEqual([10, 20, 21, 30]);
  });
});
