/**
 * The stretch of time Insights is looking at, and the figures every part of
 * the screen reads from it.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The owner, 27 September 2026: "I can't even use range properly if I want
 * to see data of the year", and the other charts and parts should follow the
 * range too, "like if I want to navigate 2024 March".
 *
 * Insights was built around one month. A range meant tapping a first day,
 * moving the month, and tapping a last day, twelve months apart for a year,
 * and only the panel beside the calendar followed it: the brief, where it
 * went and where it came from all stayed on the month above.
 *
 * So the screen has one period now, chosen one of three ways (a month, a
 * whole year, or any two dates), and a pick inside it (a day on the
 * calendar, a bar on the chart) narrows it. Everything under it reads the
 * same window from here: the totals, the trend, where it went against the
 * period before, where it came from, budget against spending, and the bills.
 * The definitions are the ones every other screen uses: `costOf` for what a
 * row cost, `incomeOf` for what came in, `costByKind` for where it went,
 * `budgetSummary` for a month's budget.
 */

import { budgetSummary } from "./budget";
import {
  addDays,
  addMonths,
  daysBetween,
  firstOfMonth,
  getDay,
  getMonth,
  getYear,
  lastOfMonth,
  MONTH_NAMES_SHORT,
  monthName,
} from "./dates";
import { describeRange, rangeOf, type DayRange } from "./dayRange";
import type { Debt } from "./debt";
import { costByKind } from "./kinds";
import type { Centavos } from "./money";
import { costOf, incomeOf } from "./totals";
import type { Budgets, IsoDate, RankedAmount, Transaction } from "./types";

export type Period =
  | { readonly kind: "month"; readonly year: number; readonly month: number }
  | { readonly kind: "year"; readonly year: number }
  | { readonly kind: "range"; readonly start: IsoDate; readonly end: IsoDate };

/** The first and last day a period covers. A year and a month are whole, ahead included. */
export function windowOf(p: Period): DayRange {
  if (p.kind === "month") return { start: firstOfMonth(p.year, p.month), end: lastOfMonth(p.year, p.month) };
  if (p.kind === "year") return { start: `${p.year}-01-01`, end: `${p.year}-12-31` };
  return rangeOf(p.start, p.end);
}

/** "March 2024", "2024", "January 5 to February 20, 2026". */
export function periodWords(p: Period): string {
  if (p.kind === "month") return `${monthName(p.month)} ${p.year}`;
  if (p.kind === "year") return String(p.year);
  return windowWords(windowOf(p));
}

/** A window in words, naming a whole month or a whole year as that. */
export function windowWords(w: DayRange): string {
  const whole = wholeMonths(w);
  if (whole) {
    if (whole.length === 1) return `${monthName(whole[0]!.month)} ${whole[0]!.year}`;
    const first = whole[0]!;
    const last = whole[whole.length - 1]!;
    if (whole.length === 12 && first.month === 1 && first.year === last.year) return String(first.year);
    return first.year === last.year
      ? `${monthName(first.month)} to ${monthName(last.month)} ${last.year}`
      : `${monthName(first.month)} ${first.year} to ${monthName(last.month)} ${last.year}`;
  }
  return describeRange(w);
}

/** The months a window covers, whole or in part, oldest first. */
export function monthsIn(w: DayRange): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = getYear(w.start);
  let m = getMonth(w.start);
  const endY = getYear(w.end);
  const endM = getMonth(w.end);
  // A bound on the loop: a century of months is more than any ledger.
  for (let i = 0; i < 1200 && (y < endY || (y === endY && m <= endM)); i += 1) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The months, when the window is exactly whole months; otherwise null. */
export function wholeMonths(w: DayRange): { year: number; month: number }[] | null {
  if (getDay(w.start) !== 1) return null;
  if (w.end !== lastOfMonth(getYear(w.end), getMonth(w.end))) return null;
  return monthsIn(w);
}

/**
 * The period before, for "against" figures.
 *
 * A month is compared with the month before it and a year with the year
 * before. A month so far is compared with the same days of the month before
 * (August 1 to 29 against July 1 to 29, not against all of July, which had
 * two more days to spend in), and a year so far with the same part of the
 * year before. Whole months go against as many whole months before, and
 * anything else against the same number of days just before it.
 */
export function previousWindow(w: DayRange): DayRange {
  const sy = getYear(w.start);
  const sameYear = sy === getYear(w.end);

  // A year so far: the same dates a year before.
  // January alone is a month, and goes against December.
  if (w.start === `${sy}-01-01` && sameYear && getMonth(w.end) > 1 && w.end !== `${sy}-12-31`) {
    const m = getMonth(w.end);
    const d = Math.min(getDay(w.end), getDay(lastOfMonth(sy - 1, m)));
    return { start: `${sy - 1}-01-01`, end: `${sy - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  }

  const whole = wholeMonths(w);
  if (whole) return { start: addMonths(w.start, -whole.length), end: addDays(w.start, -1) };

  // A month so far: the same days of the month before.
  if (getDay(w.start) === 1 && sameYear && getMonth(w.start) === getMonth(w.end)) {
    const start = addMonths(w.start, -1);
    const lastDay = lastOfMonth(getYear(start), getMonth(start));
    const end = `${start.slice(0, 8)}${String(getDay(w.end)).padStart(2, "0")}`;
    return { start, end: end > lastDay ? lastDay : end };
  }

  const days = daysBetween(w.start, w.end) + 1;
  return { start: addDays(w.start, -days), end: addDays(w.start, -1) };
}

/** "July", "2025", "the same days of July", "the 14 days before": the period before, in a sentence. */
export function previousWords(w: DayRange): string {
  const prev = previousWindow(w);
  const whole = wholeMonths(prev);
  const py = getYear(prev.start);
  if (w.start.endsWith("-01-01") && getMonth(w.end) > 1 && prev.start.endsWith("-01-01") && py === getYear(w.start) - 1 && !w.end.endsWith("-12-31"))
    return `the same part of ${py}`;
  if (whole) {
    if (whole.length === 1) return py === getYear(w.start) ? monthName(whole[0]!.month) : `${monthName(whole[0]!.month)} ${whole[0]!.year}`;
    return windowWords(prev);
  }
  if (getDay(prev.start) === 1 && getDay(w.start) === 1) {
    const name = monthName(getMonth(prev.start));
    return `the same days of ${py === getYear(w.start) ? name : `${name} ${py}`}`;
  }
  const days = daysBetween(prev.start, prev.end) + 1;
  return days === 1 ? "the day before" : `the ${days} days before`;
}

export type Bucket = "day" | "week" | "month";

/** Days up to two months, weeks up to half a year, months beyond. */
export function bucketFor(w: DayRange): Bucket {
  const days = daysBetween(w.start, w.end) + 1;
  if (days <= 62) return "day";
  if (days <= 190) return "week";
  return "month";
}

export interface TrendPoint {
  readonly start: IsoDate;
  readonly end: IsoDate;
  /** For the axis: "5", "Mar 3", "Mar". */
  readonly label: string;
  /** For the reading: "Tuesday, March 5, 2024", "Week of March 3", "March 2024". */
  readonly title: string;
  readonly spent: Centavos;
  readonly cameIn: Centavos;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayTitle(d: IsoDate): string {
  const weekday = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? "";
  return `${weekday}, ${monthName(getMonth(d))} ${getDay(d)}, ${getYear(d)}`;
}

const shortDate = (d: IsoDate): string => `${MONTH_NAMES_SHORT[getMonth(d) - 1] ?? ""} ${getDay(d)}`;

/** Monday on or before a day: weeks start on Monday, as the calendar's "This week" does. */
export function mondayOf(d: IsoDate): IsoDate {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}

/**
 * What went out and came in, bucket by bucket, over the window.
 *
 * Every bucket is clipped to the window, so the first and last weeks of a
 * range count only the days inside it, and the buckets add up to the
 * window's own totals exactly.
 */
export function trendOf(transactions: readonly Transaction[], w: DayRange, by: Bucket = bucketFor(w)): TrendPoint[] {
  const points: { start: IsoDate; end: IsoDate; label: string; title: string }[] = [];
  if (by === "day") {
    for (let d = w.start, i = 0; d <= w.end && i < 400; d = addDays(d, 1), i += 1) {
      const sameMonth = getMonth(w.start) === getMonth(w.end) && getYear(w.start) === getYear(w.end);
      points.push({ start: d, end: d, label: sameMonth ? String(getDay(d)) : shortDate(d), title: dayTitle(d) });
    }
  } else if (by === "week") {
    for (let d = mondayOf(w.start), i = 0; d <= w.end && i < 60; d = addDays(d, 7), i += 1) {
      const start = d < w.start ? w.start : d;
      const last = addDays(d, 6);
      const end = last > w.end ? w.end : last;
      points.push({ start, end, label: shortDate(start), title: describeRange({ start, end }) });
    }
  } else {
    const oneYear = getYear(w.start) === getYear(w.end);
    for (const { year, month } of monthsIn(w)) {
      const first = firstOfMonth(year, month);
      const last = lastOfMonth(year, month);
      const start = first < w.start ? w.start : first;
      const end = last > w.end ? w.end : last;
      const short = MONTH_NAMES_SHORT[month - 1] ?? "";
      points.push({
        start,
        end,
        label: oneYear ? short : `${short} ${String(year).slice(2)}`,
        title: start === first && end === last ? `${monthName(month)} ${year}` : describeRange({ start, end }),
      });
    }
  }

  const spent = new Array<Centavos>(points.length).fill(0);
  const came = new Array<Centavos>(points.length).fill(0);
  for (const t of transactions) {
    if (t.date < w.start || t.date > w.end) continue;
    // Buckets are in order and touch, so the first whose end reaches the date holds it.
    const i = points.findIndex((p) => t.date <= p.end);
    if (i < 0) continue;
    spent[i] = (spent[i] ?? 0) + costOf(t);
    came[i] = (came[i] ?? 0) + incomeOf(t);
  }
  return points.map((p, i) => ({ ...p, spent: spent[i] ?? 0, cameIn: came[i] ?? 0 }));
}

export interface KindAgainst extends RankedAmount {
  /** The same kind in the period before. */
  readonly before: Centavos;
}

/** Where it went in the window, each kind beside what it was in the period before. */
export function kindsAgainst(
  transactions: readonly Transaction[],
  debts: readonly Debt[],
  w: DayRange,
): KindAgainst[] {
  const prev = previousWindow(w);
  const now = costByKind(transactions.filter((t) => t.date >= w.start && t.date <= w.end), debts);
  const then = new Map(
    costByKind(transactions.filter((t) => t.date >= prev.start && t.date <= prev.end), debts).map((k) => [k.name, k.amount]),
  );
  return now.map((k) => ({ ...k, before: then.get(k.name) ?? 0 }));
}

/** Where it came from in the window: income by source, starting balances left out. */
export function incomeBySource(transactions: readonly Transaction[], w: DayRange): RankedAmount[] {
  const bySource = new Map<string, Centavos>();
  for (const t of transactions) {
    if (t.date < w.start || t.date > w.end) continue;
    const amount = incomeOf(t);
    if (amount <= 0) continue;
    const key = t.item.trim() || "Unnamed";
    bySource.set(key, (bySource.get(key) ?? 0) + amount);
  }
  return [...bySource]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, amount]) => ({ name, amount }));
}

export interface MonthAgainstBudget {
  readonly year: number;
  readonly month: number;
  readonly budget: Centavos;
  readonly spent: Centavos;
}

/** Each month the window touches, its whole budget against what the budget counts. */
export function budgetByMonth(
  transactions: readonly Transaction[],
  budgets: Budgets,
  w: DayRange,
): MonthAgainstBudget[] {
  const byYear = new Map<number, ReturnType<typeof budgetSummary>>();
  return monthsIn(w).map(({ year, month }) => {
    let rows = byYear.get(year);
    if (!rows) {
      rows = budgetSummary(transactions, budgets, year);
      byYear.set(year, rows);
    }
    const row = rows[month - 1];
    return { year, month, budget: row?.budget ?? 0, spent: row?.spent ?? 0 };
  });
}

export interface PaidBill {
  readonly item: string;
  readonly category: "Bills" | "Subscriptions";
  readonly times: number;
  readonly total: Centavos;
  readonly last: IsoDate;
}

/** Bills and subscriptions paid in the window, by name, largest first. */
export function billsPaidIn(transactions: readonly Transaction[], w: DayRange): PaidBill[] {
  const by = new Map<string, { item: string; category: "Bills" | "Subscriptions"; times: number; total: Centavos; last: IsoDate }>();
  for (const t of transactions) {
    if (t.type !== "Spending" || (t.category !== "Bills" && t.category !== "Subscriptions")) continue;
    if (t.date < w.start || t.date > w.end) continue;
    const item = t.item.trim() || t.category;
    const key = `${t.category}|${item.toLowerCase()}`;
    const had = by.get(key);
    if (had) {
      had.times += 1;
      had.total += t.total;
      if (t.date > had.last) had.last = t.date;
    } else {
      by.set(key, { item, category: t.category, times: 1, total: t.total, last: t.date });
    }
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.item.localeCompare(b.item));
}

/** Ranges people mean by words, counted back from today. */
export function presetRanges(asOf: IsoDate): { id: string; label: string; range: DayRange }[] {
  const year = getYear(asOf);
  return [
    { id: "7d", label: "Last 7 days", range: { start: addDays(asOf, -6), end: asOf } },
    { id: "30d", label: "Last 30 days", range: { start: addDays(asOf, -29), end: asOf } },
    { id: "3m", label: "Last 3 months", range: { start: addDays(addMonths(asOf, -3), 1), end: asOf } },
    { id: "6m", label: "Last 6 months", range: { start: addDays(addMonths(asOf, -6), 1), end: asOf } },
    { id: "12m", label: "Last 12 months", range: { start: addDays(addMonths(asOf, -12), 1), end: asOf } },
    { id: "ytd", label: "This year so far", range: { start: `${year}-01-01`, end: asOf } },
    { id: "ly", label: `All of ${year - 1}`, range: { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` } },
    { id: "next30", label: "Next 30 days", range: { start: addDays(asOf, 1), end: addDays(asOf, 30) } },
  ];
}
