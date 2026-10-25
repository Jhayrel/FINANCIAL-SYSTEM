/**
 * The day a sentence names by weekday, by "days ago", or by its date alone.
 *
 * The owner, 26 October 2026: "make the ai etc knows days, time etc". Typed
 * on a Sunday, "I spent 200 gas last friday", "food 150 noong lunes", "gas
 * 200 2 days ago" and "food 100 on the 23rd" were all dated that Sunday: the
 * reader knew today, yesterday, the day before and a month with its day,
 * and nothing else. An entry a few days off lands in the wrong day's figure
 * and, at a month's end, the wrong month.
 *
 * Only the past: an entry is something that happened. A weekday alone is the
 * latest one on or before today ("friday" on a Sunday is two days back);
 * "last friday" is the latest one before today, so "last sunday" on a Sunday
 * is a week back. "last week monday" is the Monday of the week before this
 * one, the week starting on Monday as the charts count it.
 */
import type { IsoDate } from "./types";

const shift = (asOf: IsoDate, days: number): IsoDate => {
  const at = new Date(`${asOf}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/** 0 is Sunday, as `Date.getUTCDay` counts. */
const WEEKDAYS: readonly (readonly [RegExp, number])[] = [
  [/sunday|linggo/, 0],
  [/monday|lunes/, 1],
  [/tuesday|tues|martes/, 2],
  [/wednesday|wed|miyerkules|myerkules|miyerkoles/, 3],
  [/thursday|thurs|huwebes/, 4],
  [/friday|biyernes|byernes/, 5],
  [/saturday|sabado/, 6],
];

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  isang: 1, dalawang: 2, tatlong: 3, apat: 4, limang: 5,
};

/** "2 days ago", "three days ago", "a week ago", "2 weeks ago", "3 araw na ang nakalipas": days back, or null. */
export function daysAgoIn(text: string): number | null {
  const m =
    /\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?)\s+ago\b/i.exec(text) ??
    /\b(\d{1,2}|isang|dalawang|tatlong|apat|limang)\s+(araw|linggo)\s+(?:na\s+)?(?:ang\s+)?(?:nakalipas|nakaraan)\b/i.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1] ?? "") ? Number(m[1]) : (NUMBER_WORDS[(m[1] ?? "").toLowerCase()] ?? 0);
  const days = /^(?:weeks?|linggo)$/i.test(m[2] ?? "") ? n * 7 : n;
  return days > 0 && days <= 62 ? days : null;
}

/** The weekday a sentence names with the words around it, or null. */
function weekdayIn(text: string, asOf: IsoDate): IsoDate | null {
  const t = text.toLowerCase();
  /*
   * Tagalog "linggo" is also "week" ("isang linggo", "last linggo"), so as
   * Sunday it needs "noong", "nung", "kahapon" or "sa" before it.
   */
  const m = /\b(last\s+week\s+|this\s+|last\s+|on\s+|noong\s+|nung\s+|nong\s+|sa\s+|this\s+past\s+)?(sunday|monday|tuesday|tues|wednesday|thursday|thurs|friday|saturday|lunes|martes|miyerkules|myerkules|miyerkoles|huwebes|biyernes|byernes|sabado|linggo)\b/.exec(t);
  if (!m) return null;
  const word = m[2] ?? "";
  const lead = (m[1] ?? "").trim().replace(/\s+/g, " ");
  if (word === "linggo" && !/^(?:noong|nung|nong|sa)$/.test(lead)) return null;
  const day = WEEKDAYS.find(([re]) => new RegExp(`^(?:${re.source})$`).test(word))?.[1];
  if (day === undefined) return null;

  const today = new Date(`${asOf}T00:00:00Z`).getUTCDay();
  if (lead === "last week") {
    // This week's Monday, then back a week to the day named.
    const monday = shift(asOf, -((today + 6) % 7));
    return shift(monday, -7 + ((day + 6) % 7));
  }
  const back = (today - day + 7) % 7;
  // "last friday" is before today; "friday", "on friday" may be today.
  if (lead === "last" || lead === "this past") return shift(asOf, back === 0 ? -7 : -back);
  return shift(asOf, -back);
}

/** "on the 23rd", "the 23rd", "noong ika-23": this month when it has come, else last month. */
function dayOfMonthIn(text: string, asOf: IsoDate): IsoDate | null {
  const m = /\b(?:on\s+)?the\s+([12]\d|3[01]|0?[1-9])(?:st|nd|rd|th)\b/i.exec(text) ?? /\b(?:noong|nung|sa)\s+ika-?\s?([12]\d|3[01]|0?[1-9])\b/i.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const y = Number(asOf.slice(0, 4));
  const mo = Number(asOf.slice(5, 7));
  const fits = (yy: number, mm: number): IsoDate | null => {
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return day <= last ? `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
  };
  const here = fits(y, mo);
  if (here && here <= asOf) return here;
  return mo === 1 ? fits(y - 1, 12) : fits(y, mo - 1);
}

/** A part of today: "this morning", "tonight", "kaninang umaga". */
const PART_OF_TODAY = /\b(?:this\s+(?:morning|afternoon|evening|noon)|tonight|kaninang\s+(?:umaga|tanghali|hapon|gabi)|ngayong\s+(?:umaga|hapon|gabi))\b/i;

/**
 * The day the words name, or null when they name none of these. Callers
 * read "today", "yesterday" and a month with its day first.
 */
export function dayFromWords(text: string, asOf: IsoDate): IsoDate | null {
  const ago = daysAgoIn(text);
  if (ago !== null) return shift(asOf, -ago);
  const weekday = weekdayIn(text, asOf);
  if (weekday) return weekday;
  const dated = dayOfMonthIn(text, asOf);
  if (dated) return dated;
  if (PART_OF_TODAY.test(text)) return asOf;
  return null;
}

/** The same words taken out, so "2 days ago" and "the 23rd" are never read as money. */
export function withoutDayWords(text: string): string {
  return text
    .replace(/\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?)\s+ago\b/gi, " ")
    .replace(/\b(\d{1,2}|isang|dalawang|tatlong|apat|limang)\s+(araw|linggo)\s+(?:na\s+)?(?:ang\s+)?(?:nakalipas|nakaraan)\b/gi, " ")
    .replace(/\b(?:on\s+)?the\s+(?:[12]\d|3[01]|0?[1-9])(?:st|nd|rd|th)\b/gi, " ")
    .replace(/\b(?:noong|nung|sa)\s+ika-?\s?(?:[12]\d|3[01]|0?[1-9])\b/gi, " ");
}
