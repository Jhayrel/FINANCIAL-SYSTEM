import { describe, expect, it } from "vitest";

import { byOldest, said, MAX_TEXT, type ChatMessage } from "./chat";
import { imageLimits, DEFAULT_IMAGE, DEFAULT_AI } from "./settings";

describe("said", () => {
  it("keeps what was said, with who said it", () => {
    const message = said("you", "how is this month going");
    expect(message.role).toBe("you");
    expect(message.text).toBe("how is this month going");
    expect(message.from).toBeUndefined();
    expect(message.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records which model answered", () => {
    expect(said("assistant", "You spent PHP 100.00.", "GPT-OSS 120B").from).toBe("GPT-OSS 120B");
  });

  /** A message is whatever was typed, and that is sometimes a pasted key. */
  it("takes a key out before it can land at rest", () => {
    const message = said("you", "my key is gsk_abcdefghijklmnopqrst");
    expect(message.text).not.toContain("gsk_abcdefghijklmnopqrst");
    expect(message.text).toContain("[redacted]");
  });

  it("caps the text at what the rule accepts", () => {
    expect(said("you", "x".repeat(9000)).text.length).toBe(MAX_TEXT);
  });

  it("gives every message a distinct id, even in the same millisecond", () => {
    const ids = new Set([said("you", "a").id, said("you", "b").id, said("you", "c").id]);
    expect(ids.size).toBe(3);
  });
});

describe("byOldest", () => {
  it("reads in the order it was said", () => {
    const messages = [
      { at: "2026-08-31T10:00:00.000Z", id: "b" },
      { at: "2026-08-31T09:00:00.000Z", id: "a" },
      { at: "2026-08-31T11:00:00.000Z", id: "c" },
    ] as ChatMessage[];
    expect([...messages].sort(byOldest).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("imageLimits", () => {
  it("uses the defaults when nothing is set", () => {
    expect(imageLimits(DEFAULT_AI)).toEqual(DEFAULT_IMAGE);
  });

  it("uses what was set", () => {
    expect(imageLimits({ ...DEFAULT_AI, image: { maxCount: 3, maxSizeMB: 2 } })).toEqual({
      maxCount: 3,
      maxSizeMB: 2,
    });
  });

  /** A typo must not ask for a hundred images of a hundred megabytes. */
  it("clamps anything out of range", () => {
    expect(imageLimits({ ...DEFAULT_AI, image: { maxCount: 100, maxSizeMB: 500 } })).toEqual({
      maxCount: 5,
      maxSizeMB: 8,
    });
    expect(imageLimits({ ...DEFAULT_AI, image: { maxCount: 0, maxSizeMB: 0 } })).toEqual({
      maxCount: 1,
      maxSizeMB: 1,
    });
  });

  it("ignores a value that is not a number at all", () => {
    const broken = { ...DEFAULT_AI, image: { maxCount: NaN, maxSizeMB: undefined } };
    expect(imageLimits(broken)).toEqual(DEFAULT_IMAGE);
  });
});
