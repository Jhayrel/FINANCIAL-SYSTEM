/**
 * "Today" was frozen at 2026-08-29, for everybody.
 *
 * ── What it cost ──────────────────────────────────────────────────────────
 *
 * On 2026-09-02 the owner typed "I transfer 1000 to cash 15 fee then use
 * that 1000 to pay my food today" and got rows dated 2026-08-29, four days
 * earlier. Their reply was "you give wrong entry fix this".
 *
 * It was never only the assistant. `AS_OF` is the whole app's idea of now,
 * so on live data the Dashboard read August 29, "this month" meant August
 * while September was running, and every budget, alert and insight described
 * a month that had already ended.
 *
 * The anchor exists for the Excel fixture and only for it: a demo ledger
 * ending in August has nothing in September, and reporting an empty month
 * would be true and useless.
 *
 * Guarded at the source, because nothing else fails if the branch is
 * removed: the app simply goes quietly back to being a week stale.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { today } from "./dates";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("today is today when the data is real", () => {
  it("chooses the real date when signed in, and the anchor when not", () => {
    expect(app).toContain("const asOf = cloud.uid ? today() : FIXTURE_AS_OF;");
  });

  it("keeps the fixture anchor for the fixture", () => {
    expect(app).toContain('const FIXTURE_AS_OF = "2026-08-29";');
  });

  /** Every screen reads the one value, so none of them can drift apart. */
  it("has no second hardcoded anchor left in the shell", () => {
    const anchors = app.match(/"2026-08-29"/g) ?? [];
    expect(anchors.length).toBe(1);
  });

  it("today is an ISO date and is not the fixture's", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today()).not.toBe("2026-08-29");
  });
});
