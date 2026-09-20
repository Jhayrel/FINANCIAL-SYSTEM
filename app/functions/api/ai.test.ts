/**
 * The endpoint, which ran with no tests at all.
 *
 * It deploys to Cloudflare and nothing else runs it, so every change to it
 * has been checked by typechecking and then by the owner's next message.
 * That is how a syntax error shipped three times, and how the shrink ladder
 * below went out on 20 September 2026 having only ever been reasoned about.
 *
 * What is tested here is what can be tested without a provider: the
 * compaction, the sizes it comes down through, and the words a failure is
 * reported in. The parts that need a model are exercised against the live
 * endpoint instead, and the findings from that are what these were written
 * from.
 */

import { describe, expect, it } from "vitest";

import { compactContext, shortReason, SHRINK_TO } from "./ai";

/** A context shaped like the real one: worked-out figures, then the rows. */
function contextOf(rows: number): string {
  const head = [
    "Date: 2026-09-20. Currency: Philippine Peso.",
    "",
    "## September 2026",
    "Spent PHP 39,638.36, received PHP 12,338.22.",
    "Budget PHP 7,700.00, over by PHP 31,938.36.",
    "",
    "## Today and the days before it",
    "Today, 2026-09-20: spent PHP 3,434.00, received PHP 0.00, across 21 entries.",
    "",
    "## Accounts",
    "Gcash: PHP 484,341.38",
    "Maya: PHP 484,557.00",
  ].join("\n");

  const entries = ["", "## Entries"].concat(
    Array.from({ length: rows }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, "0")} | Spending | Item ${i} | PHP ${100 + i}.00`),
  );

  return [head, ...entries].join("\n");
}

describe("cutting a context to size", () => {
  it("leaves a context that already fits exactly as it is", () => {
    const small = contextOf(5);
    expect(compactContext(small, 18_000)).toBe(small);
  });

  it("keeps the worked-out figures and cuts the rows", () => {
    const cut = compactContext(contextOf(4000), 6_000);

    expect(cut.length).toBeLessThanOrEqual(6_000);
    expect(cut).toContain("## September 2026");
    expect(cut).toContain("## Today and the days before it");
    expect(cut).toContain("Gcash: PHP 484,341.38");
    expect(cut).toContain("## Entries");
  });

  it("says how many rows it left out, so nothing is counted that cannot be seen", () => {
    const cut = compactContext(contextOf(4000), 6_000);
    const note = /\((\d+) more entries left out to fit/.exec(cut);

    expect(note, cut.slice(-200)).not.toBeNull();
    expect(Number(note![1])).toBeGreaterThan(3000);
  });

  it("never returns more than it was asked for, at any size", () => {
    for (const max of [200, 500, 2_000, 6_000, 18_000]) {
      const cut = compactContext(contextOf(4000), max);
      expect(cut.length, `max ${max}`).toBeLessThanOrEqual(max);
    }
  });

  it("keeps the figures even when the room is too small for a single row", () => {
    const cut = compactContext(contextOf(4000), 400);
    expect(cut).toContain("## September 2026");
    expect(cut.length).toBeLessThanOrEqual(400);
  });

  it("cuts a context with no rows in it at all, rather than failing", () => {
    const noEntries = "## September 2026\n" + "x".repeat(5_000);
    const cut = compactContext(noEntries, 1_000);
    expect(cut.length).toBeLessThanOrEqual(1_000);
    expect(cut).toContain("## September 2026");
  });
});

describe("the sizes a refused request comes down through", () => {
  it("starts at the ordinary size and gets smaller each time", () => {
    expect(SHRINK_TO.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < SHRINK_TO.length; i += 1) {
      expect(SHRINK_TO[i]!, `step ${i}`).toBeLessThan(SHRINK_TO[i - 1]!);
    }
  });

  it("each step really is a smaller request, not just a smaller number", () => {
    const full = contextOf(4000);
    const sizes = SHRINK_TO.map((chars) => compactContext(full, chars).length);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]!, `step ${i}`).toBeLessThan(sizes[i - 1]!);
    }
  });

  it("the smallest still carries the figures an answer is usually made of", () => {
    const smallest = compactContext(contextOf(4000), SHRINK_TO[SHRINK_TO.length - 1]!);
    expect(smallest).toContain("## September 2026");
    expect(smallest).toContain("Spent PHP 39,638.36");
  });
});

describe("what a failure is called", () => {
  it("names the status when a provider refuses", () => {
    expect(shortReason(new Error("413"))).toBe("rejected (413)");
    expect(shortReason(new Error("429"))).toBe("rejected (429)");
    expect(shortReason(new Error("500"))).toBe("provider error (500)");
  });

  it("says the one thing the owner can act on", () => {
    expect(shortReason(new Error("no key"))).toBe("no key for this provider");
  });

  it("says timed out for an abort, and never invents a reason", () => {
    expect(shortReason(new Error("The operation was aborted"))).toBe("timed out");
    expect(shortReason(new Error("something nobody has seen"))).toBe("unavailable");
    expect(shortReason("a string, not an error")).toBe("unavailable");
  });
});
