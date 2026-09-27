/**
 * Firestore's free day, counted on this device, and the refusal recorded.
 *
 * The owner, 28 September 2026: 48,000 of 50,000 free reads used, with
 * nothing in the app to say so.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { needsFullRead } from "./firestoreLedger";
import { countReads, countWrites, isQuotaError, noteError, quotaDay, usageLevel, usageToday } from "./usage";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("the Firestore day", () => {
  it("turns over at midnight Pacific, not at midnight here", () => {
    // 3:30 PM in Manila on 28 September is 00:30 Pacific on 28 September.
    expect(quotaDay(new Date("2026-09-28T07:30:00Z"))).toBe("2026-09-28");
    // 2:30 PM in Manila is still 27 September in California.
    expect(quotaDay(new Date("2026-09-28T06:30:00Z"))).toBe("2026-09-27");
  });
});

describe("counting", () => {
  it("adds up reads and writes for the day", () => {
    countReads(3836);
    countReads(12);
    countWrites(2);
    expect(usageToday()).toMatchObject({ reads: 3848, writes: 2 });
  });

  it("is near at four fifths, and over only when Firestore says so", () => {
    countReads(39_999);
    expect(usageLevel(usageToday())).toBe("ok");
    countReads(1);
    expect(usageLevel(usageToday())).toBe("near");
    noteError(Object.assign(new Error("Quota exceeded."), { code: "resource-exhausted" }), "reads");
    expect(usageLevel(usageToday())).toBe("over");
    expect(usageToday().exhaustedWhat).toBe("reads");
  });

  it("records only a quota refusal, not any error", () => {
    noteError(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }), "reads");
    expect(usageToday().exhaustedAt).toBeUndefined();
    expect(isQuotaError({ code: "resource-exhausted" })).toBe(true);
    expect(isQuotaError(new Error("Quota exceeded."))).toBe(true);
  });
});

describe("reading the whole ledger again", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const mark = { fullAt: now - 60 * 60 * 1000, count: 3836 };

  it("happens on a device that never read it", () => {
    expect(needsFullRead(null, 0, now)).toBe(true);
  });

  it("does not happen when this device's copy is whole and recent", () => {
    expect(needsFullRead(mark, 3836, now)).toBe(false);
    expect(needsFullRead(mark, 3840, now)).toBe(false);
  });

  it("happens when the copy has fewer rows than the last whole read found", () => {
    expect(needsFullRead(mark, 3000, now)).toBe(true);
  });

  it("happens once a week regardless", () => {
    expect(needsFullRead({ ...mark, fullAt: now - 8 * 24 * 60 * 60 * 1000 }, 3836, now)).toBe(true);
  });
});
