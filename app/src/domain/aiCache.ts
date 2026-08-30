/**
 * Not asking the same question twice.
 *
 * ── Why this is worth a module ────────────────────────────────────────────
 *
 * The free tiers are capped on tokens per minute, not requests, and a summary
 * of this ledger is the longest prompt the app sends. Regenerating it every
 * time a screen mounts spends that budget on an answer the owner has already
 * read, and then the one call that mattered gets rate limited.
 *
 * It is also just wrong on its own terms. The same figures produce the same
 * answer, so asking again either returns what was already on screen, or
 * returns something different, which is worse: two contradictory descriptions
 * of one unchanged month is a reason to distrust both.
 *
 * ── What "changed" means ──────────────────────────────────────────────────
 *
 * The key is a hash of the exact text that would be sent, plus the task and
 * the tone. So a new transaction invalidates it, and switching tone
 * invalidates it, while opening the screen again does not. Nothing has to
 * remember to clear this: an entry that changes nothing in the summary
 * legitimately keeps the same answer.
 *
 * ── Why localStorage, and why failing to use it is fine ───────────────────
 *
 * Surviving a reload is the whole point, since a reload is exactly when the
 * old code would spend a call for no reason. But every read and write is
 * wrapped: private windows and blocked storage throw, and an unavailable cache
 * has to mean "ask again", never "fail". It holds nothing that is not already
 * on screen, and it is per-browser, so it never needs syncing.
 */

const PREFIX = "fms.ai.";
const MAX_ENTRIES = 24;
/** A week. Long enough to be useful, short enough that stale text expires. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedAnswer {
  readonly text: string;
  readonly source: "model" | "offline";
  readonly model?: string | undefined;
  readonly reason?: string | undefined;
  /** When it was stored, so the UI can say how old it is. */
  readonly at: number;
}

/**
 * FNV-1a, the same hash `domain/backup.ts` uses for its checksum.
 *
 * Not cryptographic and does not need to be: a collision would show a stale
 * sentence, which is why the stored text is displayed with its age rather than
 * presented as fresh.
 */
export function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const cacheKey = (task: string, tone: string, context: string): string =>
  `${PREFIX}${task}.${tone}.${hash(context)}`;

export function readCache(key: string, now = Date.now()): CachedAnswer | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Private mode, blocked storage. No cache is not an error.
    return null;
  }
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<CachedAnswer>;
    if (typeof value.text !== "string" || !value.text) return null;
    if (value.source !== "model" && value.source !== "offline") return null;
    if (typeof value.at !== "number") return null;
    if (now - value.at > MAX_AGE_MS) return null;

    return {
      text: value.text,
      source: value.source,
      model: typeof value.model === "string" ? value.model : undefined,
      reason: typeof value.reason === "string" ? value.reason : undefined,
      at: value.at,
    };
  } catch {
    // Hand-edited or truncated. Treat exactly like a miss.
    return null;
  }
}

export function writeCache(key: string, answer: Omit<CachedAnswer, "at">, now = Date.now()): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...answer, at: now }));
    prune(now);
  } catch {
    // Quota, or storage refused. The feature works without it.
  }
}

/**
 * Keep the cache small.
 *
 * Every new transaction produces a new key, so without this the entries would
 * accumulate until they took a real share of a storage quota the ledger itself
 * needs. Oldest first, and only this module's own keys are ever touched.
 */
function prune(now: number): void {
  try {
    const mine: { key: string; at: number }[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;

      const entry = readCache(key, now);
      mine.push({ key, at: entry?.at ?? 0 });
    }

    mine.sort((a, b) => a.at - b.at);
    for (const { key } of mine.slice(0, Math.max(0, mine.length - MAX_ENTRIES))) {
      localStorage.removeItem(key);
    }
  } catch {
    // Nothing here is load-bearing.
  }
}

/** Everything this module stored. Used by the Data screen's reset. */
export function clearCache(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Nothing to do, and nothing lost.
  }
}

/** "just now", "2 hours ago". Only ever approximate, and says so. */
export function describeAge(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
