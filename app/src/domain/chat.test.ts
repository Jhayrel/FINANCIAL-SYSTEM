import { describe, expect, it } from "vitest";

import { byOldest, said, MAX_FROM, MAX_TEXT, type ChatMessage } from "./chat";
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

/**
 * The line under a message says where the words came from, and when nothing
 * answered it says why. On 20 September 2026 that line read "... too large,
 * then reje": cut at 80 characters, mid-word, with the cause missing.
 */
describe("the line under a message", () => {
  const long =
    "Every model in the chain failed. Tried: openai/gpt-oss-120b too large at every size, then rejected (413), meta/llama-4-scout rejected (429), google/gemma-2-27b unavailable, mistral/small-24b provider error (503), qwen/qwen3-32b timed out, deepseek/deepseek-chat no key for this provider.";

  it("keeps the whole diagnosis when it fits", () => {
    const fits = "Every model in the chain failed. Tried: openai/gpt-oss-120b too large at every size, then rejected (413).";
    expect(said("assistant", "No answer.", fits).from).toBe(fits);
  });

  it("cuts a longer one on a word, not through one", () => {
    const from = said("assistant", "No answer.", long).from ?? "";
    expect(from.length).toBeGreaterThan(200);
    expect(from.length).toBeLessThanOrEqual(MAX_FROM);
    expect(from).toContain("too large at every size");

    const kept = from.slice(0, -1);
    expect(from.slice(-1)).toBe(String.fromCodePoint(0x2026));
    expect(long.startsWith(kept)).toBe(true);
    // The cut lands after a whole word: what follows it in the original is a
    // space or the punctuation that was trimmed off the end, never a letter.
    expect(long.charAt(kept.length)).toMatch(/[\s,;:.]/);
  });

  it("leaves a short one exactly as it is", () => {
    expect(said("assistant", "Done.", "openai/gpt-oss-120b").from).toBe("openai/gpt-oss-120b");
  });
});
