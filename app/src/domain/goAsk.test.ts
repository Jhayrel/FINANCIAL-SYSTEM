/** 27 October 2026 sweep: "rename food to meals" was asked "How much was it?". */
import { describe, expect, it } from "vitest";

import { asksToRenameName, readGoAsk } from "./goAsk";

describe("renaming a kind or an account", () => {
  it("is Settings' to do, said with what it rewrites", () => {
    expect(asksToRenameName("rename food to meals", ["Food", "Travel"], ["Cash", "Gcash"])).toEqual({ from: "Food", to: "meals", what: "kind" });
    expect(asksToRenameName("rename gcash to gcash main", ["Food"], ["Cash", "Gcash"])).toEqual({ from: "Gcash", to: "gcash main", what: "account" });
    expect(asksToRenameName("rename the trip plan to Baguio trip", ["Food"], ["Cash"])).toBeNull();
  });
});

describe("the Needs review list", () => {
  it("opens for \"show entries needing review\"", () => {
    expect(readGoAsk("show entries needing review", "2026-10-26")).toMatchObject({ screen: "database", review: true });
    // Any other "show" is a question, answered where it is asked.
    expect(readGoAsk("show my spending", "2026-10-26")).toBeNull();
  });
});
