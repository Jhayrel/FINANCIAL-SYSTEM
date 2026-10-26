/**
 * The Activity screen's period and search, which the list and its PDF both
 * follow (owner, 27 October 2026: "the pdf in activity add filter").
 *
 * Days are the device's own calendar days, as the list's day headings are.
 */

import type { ActivityEvent } from "./activity";

export type Period = "all" | "today" | "week" | "month" | "lastMonth" | "year";

export const PERIODS: readonly { readonly id: Period; readonly label: string; readonly phrase: string }[] = [
  { id: "all", label: "Any time", phrase: "" },
  { id: "today", label: "Today", phrase: "today" },
  { id: "week", label: "The last 7 days", phrase: "in the last 7 days" },
  { id: "month", label: "This month", phrase: "this month" },
  { id: "lastMonth", label: "Last month", phrase: "last month" },
  { id: "year", label: "This year", phrase: "this year" },
];

/** The device's calendar day of a moment, YYYY-MM-DD. */
export function localDay(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The first and last day a period covers, both included; null for any time. */
export function periodDays(period: Period, now: Date): { readonly from: string; readonly to: string } | null {
  const today = localDay(now);
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = (d: Date): string => localDay(d);
  switch (period) {
    case "all":
      return null;
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: day(new Date(y, m, now.getDate() - 6)), to: today };
    case "month":
      return { from: day(new Date(y, m, 1)), to: today };
    case "lastMonth":
      return { from: day(new Date(y, m - 1, 1)), to: day(new Date(y, m, 0)) };
    case "year":
      return { from: `${y}-01-01`, to: today };
  }
}

export function inPeriod(e: Pick<ActivityEvent, "at">, period: Period, now: Date): boolean {
  const span = periodDays(period, now);
  if (!span) return true;
  const d = localDay(e.at);
  return d >= span.from && d <= span.to;
}

/**
 * Words, an amount or a record number: "tuition", "#3933", "3933", "9337".
 * Every word must be found somewhere in the event: its line, what it was
 * before and after, the model that proposed it.
 */
export function matchesSearch(e: ActivityEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const number = /^#?0*(\d+)$/.exec(q);
  if (number && e.recordNumber !== undefined && String(e.recordNumber) === number[1]) return true;
  const amount = e.amount !== undefined ? `${(e.amount / 100).toFixed(2)} ${Math.round(e.amount / 100)}` : "";
  const text = [e.summary, e.before ?? "", e.after ?? "", e.model ?? "", e.recordNumber !== undefined ? `#${String(e.recordNumber).padStart(4, "0")}` : "", amount].join(" ").toLowerCase().replace(/,/g, "");
  // "#42" and "#0042" are the same record, written the way the app writes it.
  const norm = (w: string): string => {
    const n = /^#0*(\d+)$/.exec(w);
    return n ? `#${(n[1] ?? "").padStart(4, "0")}` : w;
  };
  return q
    .replace(/,/g, "")
    .split(/\s+/)
    .every((w) => text.includes(norm(w)));
}
