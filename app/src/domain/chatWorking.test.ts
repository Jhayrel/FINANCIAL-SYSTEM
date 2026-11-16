/**
 * "See the figures behind this answer" is kept with the answer, so a
 * refresh brings it back (owner, 10 and 11 November 2026). Invented figures.
 */
import { describe, expect, it } from "vitest";

import { drawn, drew, MAX_TEXT, said, workingIn } from "./chat";

describe("an answer's working, kept with it", () => {
  it("comes back from the record, and is never taken for a chart", () => {
    const m = said("assistant", "You have ₱120.00 a day.", "a model", undefined, "Wallets ₱3,000.00\nBills ₱600.00\nLeft ₱2,400.00 over 20 days");
    expect(workingIn(m)).toBe("Wallets ₱3,000.00\nBills ₱600.00\nLeft ₱2,400.00 over 20 days");
    expect(drawn(m)).toBeNull();
    expect(m.chart!.length).toBeLessThanOrEqual(MAX_TEXT);
  });
  it("a chart is still a chart, and an answer without working has none", () => {
    const c = drew({ title: "Food", rows: [] }, "Food", "");
    expect(drawn(c)).not.toBeNull();
    expect(workingIn(c)).toBeNull();
    expect(said("assistant", "Hello").chart).toBeUndefined();
  });
  it("too long is cut at a line, and says so, inside the bound", () => {
    const long = Array.from({ length: 400 }, (_, i) => `Line ${i}: ₱${i}.00`).join("\n");
    const m = said("assistant", "Long one.", "a model", undefined, long);
    const back = workingIn(m)!;
    expect(m.chart!.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(back.startsWith("Line 0: ₱0.00\nLine 1:")).toBe(true);
    expect(back.endsWith("(The rest was too long to keep.)")).toBe(true);
  });
});
