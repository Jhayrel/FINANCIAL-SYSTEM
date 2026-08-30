/**
 * Dates: plain `YYYY-MM-DD` strings, never Date objects in the domain.
 *
 * A ledger date is a calendar day, not an instant. Using Date here would drag
 * in the local timezone and shift entries across midnight for anyone east or
 * west of UTC. ISO strings compare and sort lexicographically, which is
 * exactly the ordering we want.
 */

import type { IsoDate } from "./types";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export const DAY_NAMES_SHORT = ["S", "M", "T", "W", "TH", "F", "S"] as const;

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === "string" && ISO_PATTERN.test(value);
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Build an ISO date from parts. `month` is 1-12. */
export function makeDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export const getYear = (d: IsoDate): number => Number(d.slice(0, 4));
/** 1-12. */
export const getMonth = (d: IsoDate): number => Number(d.slice(5, 7));
export const getDay = (d: IsoDate): number => Number(d.slice(8, 10));

/** Today, in the viewer's local calendar. */
export function today(): IsoDate {
  const now = new Date();
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Days in a month. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Day of week, 0 = Sunday. */
export function dayOfWeek(d: IsoDate): number {
  return new Date(getYear(d), getMonth(d) - 1, getDay(d)).getDay();
}

export function firstOfMonth(year: number, month: number): IsoDate {
  return makeDate(year, month, 1);
}

export function lastOfMonth(year: number, month: number): IsoDate {
  return makeDate(year, month, daysInMonth(year, month));
}

/** Add days, crossing month and year boundaries correctly. */
export function addDays(d: IsoDate, days: number): IsoDate {
  const date = new Date(getYear(d), getMonth(d) - 1, getDay(d) + days);
  return makeDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Add months, clamping to the end of the target month.
 * Jan 31 + 1 month -> Feb 28/29, matching the Excel's bill-due prediction.
 */
export function addMonths(d: IsoDate, months: number): IsoDate {
  const y = getYear(d);
  const m = getMonth(d) - 1 + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const day = Math.min(getDay(d), daysInMonth(targetYear, targetMonth + 1));
  return makeDate(targetYear, targetMonth + 1, day);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const ms =
    Date.UTC(getYear(b), getMonth(b) - 1, getDay(b)) -
    Date.UTC(getYear(a), getMonth(a) - 1, getDay(a));
  return Math.round(ms / 86_400_000);
}

/** Inclusive on both ends. */
export function isWithin(d: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return d >= start && d <= end;
}

export function isInMonth(d: IsoDate, year: number, month: number): boolean {
  return getYear(d) === year && getMonth(d) === month;
}

/** Days remaining in the month, counting today. Never negative. */
export function daysLeftInMonth(from: IsoDate): number {
  const total = daysInMonth(getYear(from), getMonth(from));
  return Math.max(0, total - getDay(from) + 1);
}

/** Month name from a 1-12 number. */
export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? "";
}

/** 1-12 from a month name, or 0 if unrecognised. Case-insensitive. */
export function monthNumber(name: string): number {
  const idx = MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === name.trim().toLowerCase(),
  );
  return idx + 1;
}

/** "28 August 2026" */
export function formatLong(d: IsoDate): string {
  return `${getDay(d)} ${monthName(getMonth(d))} ${getYear(d)}`;
}

/** "August 28, 2026" */
export function formatMedium(d: IsoDate): string {
  return `${monthName(getMonth(d))} ${getDay(d)}, ${getYear(d)}`;
}

/** "08/28/2026": matches the Excel's display format. */
export function formatShort(d: IsoDate): string {
  return `${pad(getMonth(d))}/${pad(getDay(d))}/${getYear(d)}`;
}

/** Every date in an inclusive range. */
export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
