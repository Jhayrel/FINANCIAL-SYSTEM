/** A pattern in the bell opens the entries it is about (owner, 17 November 2026). Invented findings. */
import { describe, expect, it } from "vitest";

import { patternQuery } from "./alerts";

describe("the entries a pattern is about", () => {
  it("a long gap: that kind of entry", () => {
    expect(patternQuery({ id: "streak-Money Send", detail: "" })).toBe("Money Send");
  });
  it("a wallet that keeps reaching zero: that wallet", () => {
    expect(patternQuery({ id: "zeroes-Wallet B", detail: "" })).toBe("Wallet B");
  });
  it("money that left quickly: the day it arrived", () => {
    expect(patternQuery({ id: "velocity-2026-11-05", detail: "" })).toBe("2026-11-05");
  });
  it("spending that shifted: the kind that rose", () => {
    expect(patternQuery({ id: "migration", detail: "Food fell by PHP 500.00 while Treat rose by PHP 800.00. It moved." })).toBe("Treat");
  });
  it("rows with no category: none to search for", () => {
    expect(patternQuery({ id: "uncategorised", detail: "" })).toBeUndefined();
  });
});
