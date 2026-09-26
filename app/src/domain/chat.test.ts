import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { byOldest, cardsIn, carded, proposed, said, MAX_FROM, MAX_TEXT, type ChatMessage, type StoredCard } from "./chat";
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
 *
 * The stored copy is held to the 80 the database rule takes: a longer one was
 * refused whole and vanished on the next refresh. It is still cut on a word.
 */
describe("the line under a message", () => {
  const long =
    "Every model in the chain failed. Tried: openai/gpt-oss-120b too large at every size, then rejected (413), meta/llama-4-scout rejected (429), google/gemma-2-27b unavailable, mistral/small-24b provider error (503), qwen/qwen3-32b timed out, deepseek/deepseek-chat no key for this provider.";

  it("keeps the whole diagnosis when it fits", () => {
    const fits = "Every model failed. Tried: openai/gpt-oss-120b too large (413).";
    expect(said("assistant", "No answer.", fits).from).toBe(fits);
  });

  it("cuts a longer one on a word, not through one", () => {
    const from = said("assistant", "No answer.", long).from ?? "";
    expect(from.length).toBeGreaterThan(60);
    expect(from.length).toBeLessThanOrEqual(MAX_FROM);
    expect(from).toContain("Every model in the chain failed");

    const kept = from.slice(0, -1);
    expect(from.slice(-1)).toBe(String.fromCodePoint(0x2026));
    expect(long.startsWith(kept)).toBe(true);
    // The cut lands after a whole word: what follows it in the original is a
    // space or the punctuation that was trimmed off the end, never a letter.
    expect(long.charAt(kept.length)).toMatch(/[\s,;:.]/);
  });

  it("never stores more than the database rule takes", () => {
    const rules = readFileSync(resolve(__dirname, "../../../firestore.rules"), "utf8");
    const bound = /d\.from is string && d\.from\.size\(\) <= (\d+)/.exec(rules)?.[1];
    expect(Number(bound)).toBe(MAX_FROM);
  });

  it("leaves a short one exactly as it is", () => {
    expect(said("assistant", "Done.", "openai/gpt-oss-120b").from).toBe("openai/gpt-oss-120b");
  });
});

/**
 * The owner, 26 September 2026: "sometimes when I refresh some part is
 * disappearing, it should stay". A list of rows to bin, a change to saved
 * entries, a budget change and a file were never written, so an open one was
 * gone after a refresh. They are kept now, and replayed like every other card.
 */
describe("cards that act on saved rows", () => {
  const found = (state: StoredCard["state"], done: string[]): StoredCard => ({
    id: "c-1",
    kind: "found",
    state,
    draft: {},
    data: { action: "bin", rows: [{ id: "t-1" }, { id: "t-2" }], why: ["entered twice"], done },
  });

  it("come back from the record with their data", () => {
    const back = carded({ ...proposed(found("open", []), "2 entries found to move to the bin."), id: "m-1" });
    expect(back?.kind).toBe("found");
    expect(back?.data?.["rows"]).toEqual([{ id: "t-1" }, { id: "t-2" }]);
  });

  it("end in the last state written for them", () => {
    const first = { ...proposed(found("open", []), "found"), id: "m-1", at: "2026-09-26T01:00:00.000Z" };
    const later = { ...proposed(found("open", ["t-1"]), "found"), id: "m-2", at: "2026-09-26T01:00:05.000Z" };
    const last = { ...proposed(found("applied", ["t-1", "t-2"]), "found"), id: "m-3", at: "2026-09-26T01:00:09.000Z" };
    const final = cardsIn([last, first, later]).get("c-1");
    expect(final?.state).toBe("applied");
    expect(final?.data?.["done"]).toEqual(["t-1", "t-2"]);
  });

  it("fit a message when a sweep names a hundred rows", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `t-${1789534513068 + i}` }));
    const card: StoredCard = { id: "c-2", kind: "found", state: "open", draft: {}, data: { action: "bin", rows, why: ["entered by the assistant"], done: [] } };
    const message = proposed(card, "100 entries found to move to the bin.");
    expect(message.card).toBeDefined();
    expect(message.card!.length).toBeLessThanOrEqual(MAX_TEXT);
  });

  it("keep a budget change as what was asked, not as the whole year", () => {
    const card: StoredCard = {
      id: "c-3",
      kind: "budget",
      state: "open",
      draft: {},
      data: { ask: { kind: "tracks", year: 2026, month: 10, spending: 4169436, scope: "month" }, words: "October 2026 spending budget set to PHP 41,694.36.", changes: [], skipped: 0 },
    };
    const back = carded({ ...proposed(card, "Budget change"), id: "m-4" });
    expect(back?.data?.["ask"]).toMatchObject({ kind: "tracks", month: 10 });
  });
});
