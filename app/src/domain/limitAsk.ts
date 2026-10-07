/**
 * Questions about the limits on kinds of spending, answered on the device
 * with the Budget screen's own figures.
 *
 * 7 October 2026 limits audit: "did I go over my 3000 food limit?" made a
 * card setting the limit, and was answered "Nothing to change: the budget
 * already reads that way"; "how much food budget is left" went to the model,
 * which had never been told a limit. Food was PHP 4,691.00 of PHP 3,000.00.
 */

import { categoryLimits } from "./budgetView";
import { daysLeftInMonth, firstOfMonth, lastOfMonth, MONTH_NAMES } from "./dates";
import type { Debt } from "./debt";
import { spendingTrackByKind } from "./kinds";
import { formatMoney, type Centavos } from "./money";
import type { Budgets, IsoDate, Transaction } from "./types";

export interface LimitLine {
  readonly kind: string;
  readonly limit: Centavos;
  readonly spent: Centavos;
}

/** Every limit set for the month, with what the kind has spent, the Budget screen's figures. */
export function limitLines(
  transactions: readonly Transaction[],
  budgets: Budgets,
  debts: readonly Debt[],
  year: number,
  month: number,
): LimitLine[] {
  const limits = categoryLimits(budgets[String(year)], month);
  if (limits.size === 0) return [];
  const spent = spendingTrackByKind(transactions, { start: firstOfMonth(year, month), end: lastOfMonth(year, month) }, debts);
  return [...limits].map(([kind, limit]) => ({ kind, limit, spent: spent.get(kind) ?? 0 }));
}

/** Asking about a limit rather than setting one: "did I go over my food limit?", "how much of my limit is left". */
export function asksAboutLimit(text: string, kinds: readonly string[] = []): boolean {
  const t = text.trim();
  // A limit, or a kind's own budget ("food budget"); "my budget" is the month's, never a limit.
  const flat = ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const kindBudget = kinds.some((k) => {
    const w = k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return w.length > 0 && (flat.includes(` ${w} budget `) || flat.includes(` ${w}s budget `));
  });
  if (!/\b(?:limits?|cap)\b/i.test(t) && !kindBudget) return false;
  if (/\b(?:set|make|change|raise|lower|remove|delete|clear|increase|decrease|cut)\b/i.test(t) && !/\b(?:did|have|has)\b/i.test(t)) return false;
  return /\?\s*$/.test(t) || /^\s*(?:did|am|is|are|was|were|how|what|which|do|does|have|has)\b/i.test(t) || /\b(?:left|over|remaining|natitira|lagpas)\b/i.test(t);
}

/**
 * The answer, about the kind the question names, or every limit when it
 * names none. Null when the question names a kind with no limit and no
 * other limit is set, so the caller can say there is none.
 */
export function limitAnswer(question: string, lines: readonly LimitLine[], month: number, asOf: IsoDate, kinds: readonly string[] = []): string {
  const name = MONTH_NAMES[month - 1] ?? "This month";
  const said = ` ${question.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const names = (k: string): boolean => {
    const w = k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return w.length > 0 && (said.includes(` ${w} `) || said.includes(` ${w}s `));
  };
  const named = lines.filter((l) => names(l.kind));
  const unlimited = kinds.find((k) => names(k) && !lines.some((l) => l.kind === k));
  const days = asOf.slice(0, 7) === `${asOf.slice(0, 4)}-${String(month).padStart(2, "0")}` ? daysLeftInMonth(asOf) : 0;
  const one = (l: LimitLine): string =>
    l.spent > l.limit
      ? `${l.kind}: ${formatMoney(l.spent)} of its ${formatMoney(l.limit)} limit, ${formatMoney(l.spent - l.limit)} over.`
      : `${l.kind}: ${formatMoney(l.spent)} of its ${formatMoney(l.limit)} limit, ${formatMoney(l.limit - l.spent)} left${days > 0 ? `, ${formatMoney(Math.floor((l.limit - l.spent) / days))} a day for the ${days} ${days === 1 ? "day" : "days"} left` : ""}.`;
  if (lines.length === 0) {
    return `No kind of spending has a limit in ${name}. Set one on the Budget screen, or say "limit ${(unlimited ?? "food").toLowerCase()} to 3000".`;
  }
  const wantsOne = named.length > 0;
  if (!wantsOne && unlimited) {
    return `${unlimited} has no limit in ${name}. The limits set:\n${lines.map((l) => `- ${one(l)}`).join("\n")}`;
  }
  const shown = wantsOne ? named : lines;
  const over = shown.filter((l) => l.spent > l.limit);
  const head = wantsOne
    ? ""
    : over.length > 0
      ? `${over.length === 1 ? `${over[0]?.kind} is` : `${over.length} kinds are`} over ${over.length === 1 ? "its limit" : "their limits"} in ${name}.\n\n`
      : `Every kind with a limit is within it in ${name}.\n\n`;
  return `${head}${shown.map((l) => (shown.length > 1 ? `- ${one(l)}` : one(l))).join("\n")}`;
}
