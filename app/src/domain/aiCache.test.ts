/**
 * The cache must never be the reason something breaks, so most of these are
 * about it failing safely: unavailable storage, corrupt entries, and a full
 * quota all have to mean "ask again", never "throw".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheKey,
  clearCache,
  describeAge,
  hash,
  readCache,
  writeCache,
} from "./aiCache";

/** A minimal localStorage, since the tests run in node. */
class MemoryStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const install = (storage: unknown): void => {
  vi.stubGlobal("localStorage", storage);
};

beforeEach(() => install(new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("hash and cacheKey", () => {
  it("is stable for the same input", () => {
    expect(hash("hello")).toBe(hash("hello"));
  });

  it("changes when the context changes, which is the invalidation rule", () => {
    expect(hash("spent 100")).not.toBe(hash("spent 200"));
  });

  it("separates tasks and tones, so switching either asks again", () => {
    const context = "same figures";

    expect(cacheKey("summary", "brief", context)).not.toBe(
      cacheKey("patterns", "brief", context),
    );
    expect(cacheKey("summary", "brief", context)).not.toBe(
      cacheKey("summary", "detailed", context),
    );
  });

  it("returns the same key for the same question", () => {
    expect(cacheKey("summary", "brief", "x")).toBe(cacheKey("summary", "brief", "x"));
  });
});

describe("readCache and writeCache", () => {
  it("stores and returns an answer", () => {
    const key = cacheKey("summary", "brief", "figures");
    writeCache(key, { text: "You spent PHP 10.00.", source: "model", model: "groq:x" });

    const got = readCache(key);
    expect(got?.text).toBe("You spent PHP 10.00.");
    expect(got?.source).toBe("model");
    expect(got?.model).toBe("groq:x");
  });

  it("misses on a key that was never written", () => {
    expect(readCache(cacheKey("summary", "brief", "nothing here"))).toBeNull();
  });

  it("expires after a week rather than showing a stale month", () => {
    const key = cacheKey("summary", "brief", "figures");
    const longAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;

    writeCache(key, { text: "old", source: "model" }, longAgo);
    expect(readCache(key)).toBeNull();
  });

  it("treats a corrupt entry as a miss, not an error", () => {
    const key = cacheKey("summary", "brief", "figures");
    localStorage.setItem(key, "{not json");

    expect(() => readCache(key)).not.toThrow();
    expect(readCache(key)).toBeNull();
  });

  it("rejects an entry missing the fields it needs", () => {
    const key = cacheKey("summary", "brief", "figures");

    localStorage.setItem(key, JSON.stringify({ text: "", source: "model", at: Date.now() }));
    expect(readCache(key)).toBeNull();

    localStorage.setItem(key, JSON.stringify({ text: "hi", source: "wat", at: Date.now() }));
    expect(readCache(key)).toBeNull();
  });

  it("keeps the cache from growing without limit", () => {
    for (let i = 0; i < 40; i++) {
      writeCache(cacheKey("summary", "brief", `figures ${i}`), {
        text: `answer ${i}`,
        source: "model",
      });
    }

    let mine = 0;
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith("fms.ai.")) mine++;
    }
    expect(mine).toBeLessThanOrEqual(24);
  });

  it("never touches keys belonging to anything else", () => {
    localStorage.setItem("fms.theme", "dark");
    for (let i = 0; i < 40; i++) {
      writeCache(cacheKey("summary", "brief", `f${i}`), { text: `a${i}`, source: "model" });
    }

    expect(localStorage.getItem("fms.theme")).toBe("dark");

    clearCache();
    expect(localStorage.getItem("fms.theme")).toBe("dark");
  });
});

describe("when storage is unavailable", () => {
  it("reads as a miss rather than throwing", () => {
    install({
      get length() {
        throw new Error("blocked");
      },
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
      key() {
        throw new Error("blocked");
      },
    });

    expect(() => readCache("fms.ai.x")).not.toThrow();
    expect(readCache("fms.ai.x")).toBeNull();
  });

  it("writes silently rather than throwing on a full quota", () => {
    install({
      length: 0,
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
      key: () => null,
    });

    expect(() => writeCache("fms.ai.x", { text: "hi", source: "model" })).not.toThrow();
  });

  it("clears silently", () => {
    install({
      get length(): number {
        throw new Error("blocked");
      },
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      key: () => null,
    });

    expect(() => clearCache()).not.toThrow();
  });
});

describe("describeAge", () => {
  const now = Date.parse("2026-08-30T12:00:00Z");

  it("says how old the answer is, roughly", () => {
    expect(describeAge(now - 30_000, now)).toBe("just now");
    expect(describeAge(now - 20 * 60_000, now)).toBe("20 minutes ago");
    expect(describeAge(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(describeAge(now - 2 * 86_400_000, now)).toBe("2 days ago");
  });

  it("gets the singular right", () => {
    expect(describeAge(now - 3_600_000, now)).toBe("1 hour ago");
    expect(describeAge(now - 86_400_000, now)).toBe("1 day ago");
  });
});
