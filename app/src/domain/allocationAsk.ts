/**
 * The chat's own answers about allocations (docs/17 A8): "how much is left
 * for gas", "my allocations", "allocation status", "if I spend my gas
 * allocation does it change safe to spend?". Worked out here, from the same
 * figures the Budget card shows, and handed to the model to word when one is
 * on; said as they are when none is.
 */

import { formatMoney } from "./money";
import { monthAfter, monthBefore, monthOfDay, monthWords, monthWordsFor, statusWords, type AllocationLine, type MonthAllocations } from "./monthAllocation";
import type { IsoDate } from "./types";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Said about allocations by name: "allocation", "allocated", "envelope", "naka-allocate". */
const SAYS_ALLOCATION = /\b(?:allocat\w*|alocat\w*|envelopes?|naka-?allocate)\b/i;

/** "How much is left for gas", "how much left in my gas", "gas left", "natira sa gas". */
const LEFT_FOR = /\b(?:left|remaining|remain|natira|natitira)\b/i;

/** The month a question is about: named, "last month", "next month", or the running one. */
export function monthAsked(text: string, asOf: IsoDate): string {
  const now = monthOfDay(asOf);
  if (/\b(?:last|previous)\s+month\b|\bnoong\s+isang\s+buwan\b/i.test(text)) return monthBefore(now);
  if (/\bnext\s+month\b|\bsusunod\s+na\s+buwan\b/i.test(text)) return monthAfter(now);
  const t = text.toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    const name = MONTHS[i]!;
    if (new RegExp(`\\b(?:${name}|${name.slice(0, 3)})\\b`).test(t)) {
      const y = Number(now.slice(0, 4));
      return `${y}-${String(i + 1).padStart(2, "0")}`;
    }
  }
  return now;
}

/** The lines of a month a question names, by their name, kind or words. */
export function linesNamed(text: string, lines: readonly AllocationLine[]): AllocationLine[] {
  const t = text.toLowerCase();
  const said = (w: string): boolean => {
    const word = w.trim().toLowerCase();
    if (word.length < 2) return false;
    return new RegExp(`(?<![a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t);
  };
  return lines.filter((l) => said(l.name) || said(l.kind) || l.words.split(/[,;]+/).some(said));
}

/**
 * Whether a message asks about allocations. A plain "how much is left for
 * gas" counts only when gas has an allocation, so a limit's question is left
 * to the limit's answer.
 */
export function asksAllocations(text: string, month: MonthAllocations): boolean {
  if (SAYS_ALLOCATION.test(text)) return true;
  if (!LEFT_FOR.test(text)) return false;
  return linesNamed(text, month.lines.map((s) => s.line)).length > 0;
}

/** What spending out of an allocation does to safe to spend: the owner's question of 8 November 2026. */
export const SAFE_RULE =
  "Spending within an allocation does not change safe to spend, today's figure or the budget's day figure: that money was already set aside, so it leaves the wallet and the allocation together. Only what goes past an allocation comes out of safe to spend.";

/** The answer, said plainly. */
export function allocationWords(text: string, month: MonthAllocations, safe: { readonly safe: number; readonly perDay: number } | null): string {
  if (month.lines.length === 0) {
    // A month that has ended cannot take one, so it is not offered.
    if (month.phase === "past") return `You had no allocations for ${monthWords(month.month)}.`;
    return `You have no allocations for ${monthWords(month.month)}. Add one on Budget, under Allocations: for example Gas, ${formatMoney(120000)}, ${formatMoney(30000)} a week. ${SAFE_RULE}`;
  }
  const named = linesNamed(text, month.lines.map((s) => s.line));
  const parts: string[] = [];
  if (named.length > 0) {
    for (const l of named) {
      const s = month.lines.find((x) => x.line.id === l.id);
      if (s) parts.push(statusWords(s, month.phase));
    }
  } else {
    parts.push(monthWordsFor(month));
  }
  if (month.phase === "running") {
    parts.push(SAFE_RULE);
    if (safe) parts.push(`Safe to spend now, after the allocations: ${formatMoney(Math.max(0, safe.safe))}; today, ${formatMoney(Math.max(0, safe.perDay))}.`);
  } else if (month.phase === "ahead") {
    parts.push(`Nothing is held for ${monthWords(month.month)} until it starts.`);
  }
  return parts.join("\n\n");
}

/**
 * "How much is left for gas" when gas has no allocation: the kind it names,
 * from the owner's own kinds, or null. It went to the model and, with none,
 * said only "The AI model is not working" (heavy test, 9 November 2026).
 */
export function kindAsked(text: string, kinds: readonly string[], month: MonthAllocations): string | null {
  if (!LEFT_FOR.test(text)) return null;
  const t = text.toLowerCase();
  const kind = [...kinds]
    .sort((a, b) => b.length - a.length)
    .find((k) => k.trim().length >= 2 && new RegExp(`(?<![a-z0-9])${k.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(t));
  if (!kind) return null;
  // One with an allocation is `allocationWords`'s.
  return month.lines.some((s) => s.line.kind.trim().toLowerCase() === kind.trim().toLowerCase()) ? null : kind;
}

/** What is left for a kind with no allocation: what it has spent, its limit if it has one, and how to set money aside for it. */
export function kindLeftWords(
  kind: string,
  month: MonthAllocations,
  spent: number,
  limit: number | null,
  safe: { readonly safe: number; readonly perDay: number } | null,
): string {
  const name = monthWords(month.month);
  const parts = [`${kind} has no allocation for ${name}, so nothing is set aside for it: ${formatMoney(spent)} spent on it so far.`];
  if (limit !== null && limit > 0) {
    parts.push(spent > limit ? `It is ${formatMoney(spent - limit)} over its ${formatMoney(limit)} limit.` : `It has a ${formatMoney(limit)} limit: ${formatMoney(limit - spent)} left of it.`);
  }
  if (safe && month.phase === "running") parts.push(`What you can still spend on it comes out of safe to spend: ${formatMoney(Math.max(0, safe.safe))} until ${name.split(" ")[0]} ends, ${formatMoney(Math.max(0, safe.perDay))} today.`);
  parts.push(`To set money aside for ${kind}, add an allocation on Budget, under Allocations.`);
  return parts.join(" ");
}

