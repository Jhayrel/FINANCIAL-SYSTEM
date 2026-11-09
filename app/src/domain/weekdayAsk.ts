/**
 * "Which day do I spend the most": the days of the week, each with what was
 * spent on it. It drew spending by kind (9 November 2026 sweep), answering
 * which thing rather than which day.
 */
import type { Chart, ChartRow } from "./charts";
import { addDays, dayOfWeek, formatMedium, WEEKDAY_NAMES } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

const WEEKDAY =
  /\b(?:which|what)\s+(?:day|days)\b[^?]{0,40}\b(?:spend|spent|spending|gastos|gumastos)\b|\b(?:spend|spent|spending)\b[^?]{0,30}\b(?:which|what)\s+day\b|\bdays?\s+of\s+the\s+week\b|\bby\s+(?:weekday|day of week)\b|\banong\s+araw\b/i;

export const asksWeekday = (text: string): boolean => WEEKDAY.test(text);

/** A window said in so many words: "this month", "last year", "october", "2026". "Day" alone is not one. */
export const saysWindow = (text: string): boolean =>
  /\b(?:this|last|past|previous)\s+(?:month|year|week|\d+\s+(?:weeks|months|days))\b|\b(?:january|february|march|april|june|july|august|september|october|november|december|20\d{2})\b/i.test(text);

export interface WeekdaySplit {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Sunday first, as `dayOfWeek` counts. */
  readonly days: readonly { readonly name: string; readonly amount: Centavos; readonly entries: number; readonly times: number }[];
  readonly total: Centavos;
}

/** Day-to-day spending (bills apart, as they fall on their own day) by day of the week. */
export function weekdaySplit(rows: readonly Transaction[], from: IsoDate, to: IsoDate): WeekdaySplit {
  const days = WEEKDAY_NAMES.map((name) => ({ name, amount: 0, entries: 0, times: 0 }));
  for (let d = from; d <= to; d = addDays(d, 1)) days[dayOfWeek(d)]!.times += 1;
  for (const t of rows) {
    if (t.date < from || t.date > to || (t as Transaction & { deletedAt?: string }).deletedAt || t.type !== "Spending" || t.category !== "Spending") continue;
    const cost = Math.max(0, costOf(t));
    if (cost === 0) continue;
    const day = days[dayOfWeek(t.date)]!;
    day.amount += cost;
    day.entries += 1;
  }
  return { from, to, days, total: days.reduce((s, d) => s + d.amount, 0) };
}

/** Monday first, the way a week is read. */
const mondayFirst = <T>(list: readonly T[]): T[] => [...list.slice(1), list[0] as T];

export function buildWeekdayChart(split: WeekdaySplit, windowName: string): Chart | null {
  if (split.total <= 0) return null;
  const top = Math.max(...split.days.map((d) => d.amount), 1);
  // Largest first: the question is which day, and the chart's reading names the largest row.
  const rows: ChartRow[] = mondayFirst(split.days)
    .map((d) => ({ label: d.name, value: d.amount, share: d.amount / top, count: d.entries }))
    .sort((a, b) => b.value - a.value);
  return { title: `Spending by day of the week, ${windowName}`, by: "item", kind: "bars", rows, total: split.total, othersCount: 0, direction: "spending", scope: "Day-to-day spending; bills and subscriptions are apart." };
}

export function weekdayWords(split: WeekdaySplit, windowName: string): string {
  if (split.total <= 0) return `Nothing was spent day to day in ${windowName}.`;
  const ranked = [...split.days].filter((d) => d.times > 0).sort((a, b) => b.amount - a.amount);
  const most = ranked[0]!;
  const least = ranked[ranked.length - 1]!;
  const each = (d: (typeof ranked)[number]): string => `${formatMoney(Math.round(d.amount / Math.max(1, d.times)))} a ${d.name} on average`;
  return [
    `**${most.name} is the day you spend the most: ${formatMoney(most.amount)} over ${windowName}, ${Math.round((most.amount * 100) / split.total)}% of day-to-day spending, ${each(most)}.**`,
    `${least.name} the least: ${formatMoney(least.amount)}, ${each(least)}.`,
    `From ${formatMedium(split.from)} to ${formatMedium(split.to)}, bills and subscriptions apart.`,
  ].join(" ");
}
