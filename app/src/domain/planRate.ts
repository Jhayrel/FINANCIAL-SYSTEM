/**
 * A spending plan said as a rate, worked out by the app: "250 per week",
 * "200 a day", "1000 a month".
 *
 * The owner, 4 October 2026: "What if I just control them in one week i have
 * 2 classes means 250 per week then I'll use 200 for gas and other too?
 * Wouldthat work?" The model added the figures itself, took them as PHP
 * 450.00 a week, worked out PHP 64.29 a day and PHP 1,030.95 left, and the
 * app could only say those were not its figures. The owner meant PHP 250.00.
 *
 * Here each figure the plan names is set beside what is left of the spending
 * budget, a day, a week and over the days left, in integer centavos, and so
 * is their sum, so the model chooses the reading and does no arithmetic.
 */

import { assessMonthFor } from "./budget";
import { daysLeft } from "./alerts";
import { formatMoney, type Centavos } from "./money";
import type { SafeToSpend } from "./monthPlan";
import type { Budgets, IsoDate, Transaction } from "./types";

export type Per = "day" | "week" | "month";

/** The period a plan is said over: "per week", "a day", "weekly", "in one week". */
export function periodIn(text: string): Per | null {
  const t = text.toLowerCase();
  if (/\b(?:per|a|an|each|every|in one|one|kada|isang)\s+(?:week|linggo)\b|\bweekly\b|\/\s*(?:wk|week)\b/.test(t)) return "week";
  if (/\b(?:per|a|each|every|kada|isang)\s+(?:day|araw)\b|\bdaily\b|\/\s*day\b|\barawaw?\b/.test(t)) return "day";
  if (/\b(?:per|a|each|every|kada|isang)\s+(?:month|buwan)\b|\bmonthly\b|\/\s*(?:mo|month)\b/.test(t)) return "month";
  return null;
}

/**
 * The money figures a message names: not counts ("2 classes", "3 days"), not
 * years, not anything under PHP 10.00.
 */
export function figuresIn(text: string): Centavos[] {
  const out: Centavos[] = [];
  const re = /(?:₱|php\s*)?(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d,])\s*(k\b)?(?!\s*(?:%|days?|weeks?|months?|years?|times?|classes|class|pcs|pieces|x\b|am\b|pm\b|people|persons|kids|items|hours?|hrs?|mins?|minutes?))/gi;
  for (const m of text.matchAll(re)) {
    const whole = Number((m[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(whole) || /^20\d{2}$/.test(m[1] ?? "")) continue;
    const pesos = m[3] ? whole * 1000 : whole;
    const centavos = Math.round(pesos * 100) + (m[2] && !m[3] ? Number(m[2].padEnd(2, "0")) : 0);
    if (centavos >= 1000) out.push(centavos);
  }
  return out;
}

const PERIOD_DAYS: Readonly<Record<Exclude<Per, "month">, number>> = { day: 1, week: 7 };

/**
 * The plan beside the spending budget, as figures for the model. Empty when
 * the message names no period (and none was said just before) or no figure.
 */
export function planWorked(
  text: string,
  data: {
    readonly transactions: readonly Transaction[];
    readonly budgets: Budgets;
    readonly asOf: IsoDate;
    /** The owner's messages just before, newest first, for "I said 250 not 450". */
    readonly before?: readonly string[];
    /**
     * The Dashboard's safe to spend (`monthPlan.ts`). A plan was set against
     * the spending budget only: "150 a day, would that work?" was told it
     * fit with PHP 627.95 to spare while PHP 80.42 a day was safe (6 October
     * 2026 audit). The money comes first now, the budget after, as the plan.
     */
    readonly safe?: Pick<SafeToSpend, "safe" | "spentToday" | "perDay" | "perDayAfter"> | null;
  },
): string {
  const per = periodIn(text) ?? (data.before ?? []).map(periodIn).find((p) => p !== null) ?? null;
  // "250 not 450": the figure after "not" is the one being put right, never part of the plan.
  const figures = figuresIn(text.replace(/\b(?:not|hindi)\s+(?:php\s*|₱)?\d[\d,.]*\s*k?\b/gi, " "));
  if (!per || figures.length === 0) return "";

  const { asOf } = data;
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const days = daysLeft(asOf);
  const inMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const spending = assessMonthFor(data.transactions, data.budgets, year, month).spending;
  const left: Centavos | null = spending.budget > 0 ? spending.remaining : null;

  const periodDays = per === "month" ? inMonth : PERIOD_DAYS[per];
  const line = (amount: Centavos, label: string): string => {
    const aDay = Math.round(amount / periodDays);
    const aWeek = Math.round((amount * 7) / periodDays);
    const overLeft = Math.round((amount * days) / periodDays);
    // Today at whichever is more, the plan's day or what today already spent: a day past the plan cannot be spent at it.
    const need = safe ? Math.max(aDay, safe.spentToday) + Math.round((amount * Math.max(0, days - 1)) / periodDays) : 0;
    const room = safe ? safe.safe + safe.spentToday : 0;
    const money = !safe
      ? ""
      : need <= room
        ? ` Against the money: it fits what is safe to spend, with ${formatMoney(room - need)} to spare.`
        : ` Against the money: it is ${formatMoney(need - room)} more than is safe to spend${safe.spentToday > aDay ? `, counting today at the ${formatMoney(safe.spentToday)} already spent` : ""}.`;
    const against =
      left === null
        ? ""
        : overLeft <= left
          ? ` Against the plan: it fits what is left of the spending budget, with ${formatMoney(left - overLeft)} to spare.`
          : ` Against the plan: it is ${formatMoney(overLeft - left)} more than what is left of the spending budget.`;
    return `${label} ${formatMoney(amount)} a ${per}: ${formatMoney(aDay)} a day, ${formatMoney(aWeek)} a week, ${formatMoney(overLeft)} over the ${days} ${days === 1 ? "day" : "days"} left in the month.${money}${against}`;
  };
  const safe = data.safe ?? null;

  const lines = [
    `A plan said ${per === "day" ? "by the day" : per === "week" ? "by the week" : "by the month"}, worked out by the app. Its figures are correct: use them and do no arithmetic of your own. Each figure the message names is set out on its own, and their sum after, because the message may mean either: answer the reading the message means, and when a correction says which figure, use that one.`,
    ...(safe
      ? [
          `What is safe to spend, the Dashboard's figure and the money: ${formatMoney(safe.safe)} until the month ends; ${formatMoney(safe.perDay)} today, then ${formatMoney(safe.perDayAfter)} a day from tomorrow. Say whether the plan fits this first.`,
        ]
      : []),
    left === null
      ? "No spending budget is set for the month, so nothing is said against one."
      : `What is left of the spending budget, the plan: ${formatMoney(left)} over the ${days} ${days === 1 ? "day" : "days"} left, ${formatMoney(Math.max(0, Math.floor(left / Math.max(days, 1))))} a day.`,
    ...figures.map((f) => line(f, "The plan's")),
  ];
  if (figures.length > 1) lines.push(line(figures.reduce((s, f) => s + f, 0), "All together,"));
  return lines.join("\n");
}
