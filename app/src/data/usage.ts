/**
 * How much of Firestore's free allowance this device has used today.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The owner, 28 September 2026, from the Firebase console: 48,000 reads of
 * the 50,000 a Spark project gets free each day, with nothing in the app to
 * say so. Past the limit every read is refused until the day turns over, so
 * the ledger stops loading and nothing on screen says why. They asked for a
 * popup and a notification.
 *
 * Firestore does not tell a browser how much the whole project has used, so
 * this counts what this device read and wrote from the server, by the same
 * rule Firestore bills: every document a query returns from the server, and
 * nothing served from the device's own cache. It is a floor, not the total:
 * the phone and the computer each count their own. What is certain is the
 * refusal itself, `resource-exhausted`, which is recorded the moment any
 * read or write meets it.
 *
 * The day is Firestore's: it turns over at midnight Pacific time.
 */

/** Spark's free reads and writes per day. */
export const FREE_READS = 50_000;
export const FREE_WRITES = 20_000;

const KEY = "fms.firestoreUsage";

export interface Usage {
  /** The Pacific day these counts are for, YYYY-MM-DD. */
  readonly day: string;
  readonly reads: number;
  readonly writes: number;
  /** When Firestore last refused for being over its allowance, ISO, this day. */
  readonly exhaustedAt?: string | undefined;
  /** What was refused: reads, writes, or both. */
  readonly exhaustedWhat?: string | undefined;
}

/** The Firestore day, midnight to midnight Pacific. */
export function quotaDay(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** When the allowance next resets, as this device's clock shows it: "3:00 PM". */
export function resetsAt(now: Date = new Date()): string {
  // The next Pacific midnight: step forward an hour at a time until the Pacific day changes.
  const today = quotaDay(now);
  const at = new Date(now.getTime());
  at.setMinutes(0, 0, 0);
  for (let i = 0; i < 30 && quotaDay(at) === today; i += 1) at.setTime(at.getTime() + 3_600_000);
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type Listener = (u: Usage) => void;
const listeners = new Set<Listener>();

function read(): Usage {
  const day = quotaDay();
  try {
    const raw = localStorage.getItem(KEY);
    const u = raw ? (JSON.parse(raw) as Usage) : null;
    if (u && u.day === day && Number.isFinite(u.reads) && Number.isFinite(u.writes)) return u;
  } catch {
    // Private mode or a corrupt value: start the day again.
  }
  return { day, reads: 0, writes: 0 };
}

function write(u: Usage): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {
    // Not remembered, still counted for this session through the listeners.
  }
  for (const l of listeners) l(u);
}

export const usageToday = (): Usage => read();

export function onUsage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Documents read from the server. Nothing from the cache is billed, so nothing from it is counted. */
export function countReads(n: number): void {
  if (!(n > 0)) return;
  const u = read();
  write({ ...u, reads: u.reads + n });
}

export function countWrites(n: number): void {
  if (!(n > 0)) return;
  const u = read();
  write({ ...u, writes: u.writes + n });
}

/** Firestore's word for "over the allowance". */
export const isQuotaError = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : String(e ?? "");
  return code === "resource-exhausted" || /quota|resource[- ]exhausted/i.test(message);
};

/** Record a refusal for being over the allowance. Anything else is ignored. */
export function noteError(e: unknown, what: "reads" | "writes"): void {
  if (!isQuotaError(e)) return;
  const u = read();
  const both = u.exhaustedWhat && u.exhaustedWhat !== what ? "reads and writes" : what;
  write({ ...u, exhaustedAt: new Date().toISOString(), exhaustedWhat: both });
}

/** How close this device's own count is to the allowance: 0 to 1. */
export const readShare = (u: Usage): number => Math.min(1, u.reads / FREE_READS);

/** The level worth telling the owner about: over, near (four fifths), or nothing. */
export function usageLevel(u: Usage): "over" | "near" | "ok" {
  if (u.exhaustedAt) return "over";
  if (u.reads >= FREE_READS * 0.8 || u.writes >= FREE_WRITES * 0.8) return "near";
  return "ok";
}
