/**
 * The day read off a screenshot, held against the day the phone saved it.
 *
 * The owner, 27 October 2026: a Maya receipt reading "27 Oct 2026, 09:34 AM",
 * saved as `Screenshot_20261027_093437_Maya.jpg`, came back dated October 7,
 * with 09:34 beside it. The file name is not a guess: the phone wrote it when
 * the screenshot was taken.
 *
 * Two readings are corrected, and nothing else:
 *
 * - A day after the screenshot. A payment cannot be shown before it happened.
 * - A day earlier than the screenshot whose time is the screenshot's own,
 *   within twenty minutes, and whose day is the screenshot's with a digit
 *   lost (27 read as 7, 21 as 1). A receipt screenshotted the moment it was
 *   paid is that day's.
 *
 * An older payment in a history screenshot keeps its own day.
 */
import { formatMedium } from "./dates";
import { dayInFileName } from "./ocrText";
import type { IsoDate } from "./types";

/** The time in a file name a phone writes: `Screenshot_20261027_093437` is 09:34. */
export function timeInFileName(name: string): { readonly hours: number; readonly minutes: number } | null {
  const m = /20\d{6}[_\- ]?(\d{2})(\d{2})(\d{2})/.exec(name);
  if (!m?.[1] || !m[2]) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

/** A time written on the card: "09:34", "9:34 AM", "21:05". */
function timeIn(text: string): { readonly hours: number; readonly minutes: number } | null {
  const m = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(text);
  if (!m?.[1] || !m[2]) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const half = m[3]?.toLowerCase();
  if (half === "pm" && hours < 12) hours += 12;
  if (half === "am" && hours === 12) hours = 0;
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

export function pictureDay(
  read: { readonly date: IsoDate; readonly notes: string; readonly description: string },
  source: string,
): { readonly date: IsoDate; readonly note: string } | null {
  const taken = dayInFileName(source);
  if (!taken || !/^\d{4}-\d{2}-\d{2}$/.test(read.date) || read.date === taken) return null;
  if (read.date > taken) {
    return { date: taken, note: `Dated ${formatMedium(taken)}, the day the screenshot was saved: it read ${formatMedium(read.date)}, after the screenshot, which cannot be.` };
  }
  const shot = timeInFileName(source);
  const paid = timeIn(`${read.notes} ${read.description}`);
  if (!shot || !paid) return null;
  const apart = Math.abs(shot.hours * 60 + shot.minutes - (paid.hours * 60 + paid.minutes));
  const day = String(Number(read.date.slice(8, 10)));
  const takenDay = String(Number(taken.slice(8, 10)));
  const digitLost = read.date.slice(0, 7) === taken.slice(0, 7) && takenDay.length === 2 && day.length === 1 && takenDay.includes(day);
  if (apart > 20 || !digitLost) return null;
  return { date: taken, note: `Dated ${formatMedium(taken)}: it read ${formatMedium(read.date)}, but the screenshot was saved on ${formatMedium(taken)} at the time on the receipt.` };
}
