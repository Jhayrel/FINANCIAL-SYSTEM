/**
 * A period said in words, when it is a range: "march 2026 to today",
 * "january 2026 to june 2026", "from the 5th of may until now".
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Two readers of periods had grown one pattern at a time, and both lost the
 * end of a range they had no pattern for. 28 September 2026:
 *
 *   "trend of revenue and spending march 2026 to today"
 *        drew today alone: no range pattern matched, then "today" did
 *   "can you generate pdf of account statement january 2026 to june 2026"
 *        made a statement for January: the first month named was taken
 *        as the whole period
 *
 * So this reads a sentence the general way. It finds every point in time
 * named in it, whatever the form (a month, a month and year, a day, an ISO
 * date, a bare year, today, now, yesterday, this or last month, this or last
 * year), and when two of them are joined by a range word (to, until,
 * through, a dash, and) the period runs from the start of the first to the
 * end of the second. A month or day with no year borrows the year of the
 * other end, and a range that would run backwards starts the year before:
 * "november to february 2026" is November 2025 to February 2026.
 *
 * Only ranges. A single point is left to the callers, which each have their
 * own long-settled reading of "august" or "2025" (a chart's whole month, a
 * statement's month), and those are not what was broken.
 */

import type { IsoDate } from "./types";

export interface Span {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** In words, for a chart's title or a statement's reply: "March 2026 to today". */
  readonly name: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH = String.raw`(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)`;

interface Point {
  readonly at: number;
  readonly end: number;
  readonly kind: "day" | "month" | "year" | "today";
  /** Year as written, or null when it has to be borrowed. */
  readonly year: number | null;
  readonly month: number | null;
  readonly day: number | null;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const monthOf = (word: string): number => MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === word.slice(0, 3).toLowerCase()) + 1;

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shift(date: IsoDate, days: number): IsoDate {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Every point in time the sentence names, left to right, none overlapping. */
function pointsIn(text: string, asOf: IsoDate): Point[] {
  const taken: boolean[] = new Array(text.length).fill(false);
  const found: Point[] = [];
  const nowYear = Number(asOf.slice(0, 4));
  const nowMonth = Number(asOf.slice(5, 7));

  const scan = (pattern: RegExp, make: (m: RegExpExecArray) => Omit<Point, "at" | "end"> | null): void => {
    for (const m of text.matchAll(new RegExp(pattern.source, "gi"))) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      if (taken.slice(at, end).some(Boolean)) continue;
      const point = make(m as RegExpExecArray);
      if (!point) continue;
      for (let i = at; i < end; i += 1) taken[i] = true;
      found.push({ at, end, ...point });
    }
  };

  // 2026-03-05
  scan(/\b(20\d{2})-(\d{2})-(\d{2})\b/, (m) => ({ kind: "day", year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }));
  // march 5, 2026 / march 5th 2026
  scan(new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b`), (m) => ({
    kind: "day", year: Number(m[3]), month: monthOf(m[1] ?? ""), day: Number(m[2]),
  }));
  // 5 march 2026 / the 5th of march 2026
  scan(new RegExp(String.raw`\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}\.?,?\s+(20\d{2})\b`), (m) => ({
    kind: "day", year: Number(m[3]), month: monthOf(m[2] ?? ""), day: Number(m[1]),
  }));
  // march 2026 / march of 2026
  scan(new RegExp(String.raw`\b${MONTH}\.?,?\s+(?:of\s+)?(20\d{2})\b`), (m) => ({
    kind: "month", year: Number(m[2]), month: monthOf(m[1] ?? ""), day: null,
  }));
  // march 5 (no year, and not "march 5 months")
  scan(new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:months?|days?|weeks?|years?))`), (m) =>
    Number(m[2]) <= 31 ? { kind: "day", year: null, month: monthOf(m[1] ?? ""), day: Number(m[2]) } : null,
  );
  // 5 march / the 5th of march
  scan(new RegExp(String.raw`\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}\b`), (m) =>
    Number(m[1]) <= 31 ? { kind: "day", year: null, month: monthOf(m[2] ?? ""), day: Number(m[1]) } : null,
  );
  // this month, last month, this year, last year
  scan(/\b(this|current|last|previous)\s+(month|year)\b/, (m) => {
    const last = /last|previous/i.test(m[1] ?? "");
    if (/year/i.test(m[2] ?? "")) return { kind: "year", year: nowYear - (last ? 1 : 0), month: null, day: null };
    const month = last ? (nowMonth === 1 ? 12 : nowMonth - 1) : nowMonth;
    const year = last && nowMonth === 1 ? nowYear - 1 : nowYear;
    return { kind: "month", year, month, day: null };
  });
  // today, now, to date, so far, present
  scan(/\b(today|now|present|to\s+date|so\s+far|this\s+day)\b/, () => ({ kind: "today", year: null, month: null, day: null }));
  scan(/\byesterday\b/, () => {
    const d = shift(asOf, -1);
    return { kind: "day", year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) };
  });
  // A month on its own. "may" only where it cannot be the verb.
  scan(new RegExp(String.raw`\b${MONTH}\b`), (m) => {
    const word = (m[1] ?? "").toLowerCase();
    if (word === "may") {
      const before = text.slice(0, m.index ?? 0);
      const after = text.slice((m.index ?? 0) + m[0].length);
      const dated = /\b(?:in|of|for|since|from|until|till|to|during|last|this|next|and|through)\s*$/i.test(before) || /^\s*(?:to|until|till|through|and|[-\u2010-\u2015]|\d)/i.test(after);
      if (!dated) return null;
    }
    return { kind: "month", year: null, month: monthOf(word), day: null };
  });
  // 2026
  scan(/\b(20\d{2})\b/, (m) => ({ kind: "year", year: Number(m[1]), month: null, day: null }));

  return found.sort((a, b) => a.at - b.at);
}

/** Where a point starts and ends, once it has a year. */
function bounds(p: Point, year: number, asOf: IsoDate): { from: IsoDate; to: IsoDate } {
  if (p.kind === "today") return { from: asOf, to: asOf };
  if (p.kind === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  const month = p.month ?? 1;
  if (p.kind === "month") return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay(year, month))}` };
  const day = Math.min(p.day ?? 1, lastDay(year, month));
  const d = `${year}-${pad(month)}-${pad(day)}`;
  return { from: d, to: d };
}

function nameOf(p: Point, year: number, asOf: IsoDate): string {
  if (p.kind === "today") return "today";
  if (p.kind === "year") return String(year);
  const month = MONTHS[(p.month ?? 1) - 1] ?? "";
  if (p.kind === "month") return `${month} ${year}`;
  const { from } = bounds(p, year, asOf);
  return from === asOf ? "today" : `${month.slice(0, 3)} ${Number(from.slice(8, 10))}, ${year}`;
}

/** Joins two points into one range: "to", "until", "through", a dash, or "and". */
const JOIN = /^\s*,?\s*(?:to|until|till|til|through|thru|up\s+to|up\s+until|upto|and|hanggang|[-\u2010-\u2015~])\s*(?:the\s+)?$/i;

/**
 * The range a sentence names, or null when it names none. "since X" and
 * "from X onwards" run to today.
 */
export function spanIn(text: string, asOf: IsoDate): Span | null {
  const points = pointsIn(text, asOf);
  const thisYear = Number(asOf.slice(0, 4));

  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    if (!JOIN.test(text.slice(a.end, b.at))) continue;
    // Nothing to join: "today and today", or the same point twice.
    if (a.kind === "today" && b.kind === "today") continue;

    // Each end takes a year: its own, or the other end's, or this one.
    let yearB = b.year ?? (b.kind === "today" ? thisYear : (a.year ?? thisYear));
    let yearA = a.year ?? (a.kind === "today" ? thisYear : yearB);
    let from = bounds(a, yearA, asOf).from;
    let to = bounds(b, yearB, asOf).to;
    // Neither end names a year: "from august to may" is May to August, as it always was.
    const anyYear = a.year !== null || b.year !== null;
    if (to < from && anyYear) {
      if (a.year === null && a.kind !== "today") {
        yearA -= 1;
        from = bounds(a, yearA, asOf).from;
      } else if (b.year === null && b.kind !== "today") {
        yearB += 1;
        to = bounds(b, yearB, asOf).to;
      }
    }
    if (to < from) [from, to] = [bounds(b, yearB, asOf).from, bounds(a, yearA, asOf).to];
    return { from, to, name: `${nameOf(a, yearA, asOf)} to ${nameOf(b, yearB, asOf)}` };
  }

  // "since march", "since march 5, 2026", "from march onwards": to today.
  for (const p of points) {
    const before = text.slice(0, p.at);
    const after = text.slice(p.end);
    const since = /\b(?:since|simula|mula)\s*$/i.test(before);
    const onwards = /\bfrom\s*$/i.test(before) && /^\s*(?:on|onwards?|forward|until\s+now|to\s+now)\b/i.test(after);
    if ((since || onwards) && p.kind !== "today") {
      const year = p.year ?? thisYear;
      const from = bounds(p, year, asOf).from;
      if (from <= asOf) return { from, to: asOf, name: `${nameOf(p, year, asOf)} to today` };
    }
  }
  return null;
}
