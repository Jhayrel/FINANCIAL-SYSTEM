/**
 * The chat's own answers about allocations (docs/17 A8): "how much is left
 * for gas", "my allocations", "allocation status", "if I spend my gas
 * allocation does it change safe to spend?". Worked out here, from the same
 * figures the Budget card shows, and handed to the model to word when one is
 * on; said as they are when none is.
 */

import { addDays, dayOfWeek, formatMedium, lastOfMonth } from "./dates";
import { formatMoney } from "./money";
import { daysWords, monthAfter, monthBefore, monthOfDay, monthWords, monthWordsFor, statusWords, type AllocationLine, type AllocationStatus, type MonthAllocations } from "./monthAllocation";
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

// ── How many times are left ─────────────────────────────────────────────────

/** "how many sessions are left", "sessions left", "ilan pa": a count asked, not an amount. */
const ASKS_COUNT = /\bhow\s+many\b|\b(?:sessions?|times?|visits?|classes?|rides?|trips?|days?)\s+(?:left|more|remaining|remain)\b|\bilan\s+(?:pa|na)\b/i;

const RATE_WORDS: Readonly<Record<string, number>> = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * How often the message says it happens, as times a week, or the weekdays it
 * names: "twice a week", "3 times a week", "every day", "every Monday and
 * Thursday". Null when it says neither.
 */
export function rateSaid(text: string): { readonly perWeek: number } | { readonly days: readonly number[] } | null {
  const t = text.toLowerCase();
  if (/\b(?:every\s*day|everyday|daily|araw-?araw)\b/.test(t)) return { perWeek: 7 };
  const weekly = /\b(once|twice|thrice|\d|one|two|three|four|five|six|seven)(?:\s+times?)?\s+(?:a|per|each|every)\s+week\b|\b(once|twice|thrice)\s+weekly\b/.exec(t);
  const said = weekly?.[1] ?? weekly?.[2];
  if (said) {
    const n = /^\d$/.test(said) ? Number(said) : (RATE_WORDS[said] ?? 0);
    if (n >= 1 && n <= 7) return { perWeek: n };
  }
  const named = WEEKDAYS.map((d, i) => (new RegExp(`\\b${d}[a-z]*(?:days?)?\\b`).test(t.replace(/\bsat(?:urday)?s?\b/g, (w) => w)) ? i : -1)).filter((i) => i >= 0);
  if (named.length > 0 && /\b(?:every|each|on|tuesdays?|thursdays?|mondays?|wednesdays?|fridays?|saturdays?|sundays?)\b/.test(t)) return { days: named };
  return null;
}

/**
 * The times a per-time or set-days allocation has left, three ways: what
 * the money left pays for at its share, what the allocation's count allows,
 * and what the schedule the owner gave needs before the month ends. Each
 * use that cost more than its share is named, and what the uses so far
 * cost on average, so the answer does not assume every session is at its
 * share when the last one was not.
 *
 * The owner, 9 November 2026: "I go gym twice a week and my budget per
 * session is ... how many session I have left before the month end". The
 * model was handed only what was left and how many of the times were used,
 * and answered with the same count twice as if it were two findings, never
 * said that the one session so far cost more than its share, and set the
 * daily safe to spend beside it as if the gym came out of it. Worked out here instead; null when the line
 * is not counted in times, or the month is not running.
 */
export function timesWords(s: AllocationStatus, text: string, asOf: IsoDate, phase: MonthAllocations["phase"]): string | null {
  const line = s.line;
  if ((line.per !== "time" && line.per !== "day") || !line.each || !line.times || phase !== "running" || s.done) return null;
  const each = line.each;
  const used = s.timesUsed ?? 0;
  const uses = s.uses ?? [];
  const left = Math.max(0, s.left);
  const byMoney = Math.floor(left / each);
  const spare = left - byMoney * each;
  const byCount = Math.max(0, line.times - used);
  const out: string[] = [];
  // The owner's own word for it: "session", "class", "visit".
  const noun = /\b(session|class|visit|ride|trip|lesson|game|round)(?:e?s)?\b/i.exec(text)?.[1]?.toLowerCase();
  const unit = noun ?? (line.per === "day" ? "day" : "time");

  out.push(`${s.name}: ${formatMoney(line.amount)} for ${line.times} ${plural(line.times, unit)} at ${formatMoney(each)} each${line.per === "day" ? ` (${daysWords(line.days ?? [])})` : ""}.`);
  if (uses.length === 0) {
    out.push(`Nothing counted against it yet this month.`);
  } else {
    const dear = uses.filter((u) => u.cost > each);
    const usedCost = uses.reduce((sum, u) => sum + u.cost, 0);
    out.push(
      `Used ${used} ${plural(used, unit)} so far, ${formatMoney(usedCost)}${dear.length > 0 ? `. ${dear.map((u) => `The one on ${formatMedium(u.date)} cost ${formatMoney(u.cost)}, ${formatMoney(u.cost - each)} more than its ${formatMoney(each)}`).join(". ")}` : ""}.`,
    );
  }
  if (s.over > 0) {
    out.push(`It is ${formatMoney(s.over)} past its ${formatMoney(line.amount)}: nothing is left of it, so every further ${unit} comes out of safe to spend.`);
  } else {
    out.push(
      `Left: ${formatMoney(left)} and ${byCount} ${plural(byCount, unit)} of the ${line.times}. At ${formatMoney(each)} a ${unit}, ${formatMoney(left)} pays for ${byMoney}${byMoney > 0 ? ` (${formatMoney(byMoney * each)})` : ""}${spare > 0 ? `, with ${formatMoney(spare)} to spare` : ""}${byCount > byMoney ? `; the allocation counts ${byCount}, so the last ${byCount - byMoney === 1 ? "one" : `${byCount - byMoney}`} would need ${formatMoney(byCount * each - left)} more` : ""}.`,
    );
  }

  // The schedule: the line's own days, or what the message says.
  const end = lastOfMonth(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)));
  const usedToday = uses.some((u) => u.date === asOf);
  const from = usedToday ? addDays(asOf, 1) : asOf;
  const rate = line.per === "day" ? { days: line.days ?? [] } : rateSaid(text);
  let needLow: number | null = null;
  let needHigh: number | null = null;
  let scheduleSaid = "";
  if (rate && from <= end) {
    const span: IsoDate[] = [];
    for (let d = from; d <= end; d = addDays(d, 1)) span.push(d);
    if ("days" in rate) {
      const n = span.filter((d) => rate.days.includes(dayOfWeek(d))).length;
      needLow = n;
      needHigh = n;
      scheduleSaid = `${daysWords(rate.days)} from ${usedToday ? "tomorrow" : "today"} to ${formatMedium(end)} is ${n} ${plural(n, unit)}`;
    } else {
      const weeks = Math.floor(span.length / 7);
      const rest = span.length % 7;
      needLow = rate.perWeek * weeks;
      needHigh = needLow + Math.min(rate.perWeek, rest);
      const how = rate.perWeek === 7 ? "Every day" : rate.perWeek === 1 ? "Once a week" : rate.perWeek === 2 ? "Twice a week" : `${rate.perWeek} times a week`;
      const length = `${span.length} days${weeks > 0 ? `: ${weeks} ${weeks === 1 ? "week" : "weeks"}${rest > 0 ? ` and ${rest} ${rest === 1 ? "day" : "days"}` : ""}` : ""}`;
      scheduleSaid = `${how} from ${usedToday ? "tomorrow" : "today"} to ${formatMedium(end)} (${length}) is ${needLow === needHigh ? `${needLow} ${plural(needLow, unit)}` : `${needLow} ${plural(needLow, unit)}, or ${needHigh} if ${needHigh - needLow === 1 ? "one falls" : "they fall"} on the last ${rest === 1 ? "day" : `${rest} days`}`}`;
    }
  }
  if (needLow !== null && needHigh !== null && s.over === 0) {
    const fits = Math.min(byMoney, byCount);
    const cost = (n: number): string => formatMoney(n * each);
    const verdict =
      fits >= needHigh
        ? `it covers ${needHigh === needLow ? "them" : "even the higher count"}, with ${formatMoney(left - needHigh * each)} to spare`
        : fits >= needLow
          ? `it covers ${needLow}, with ${formatMoney(left - needLow * each)} to spare; a ${needHigh === needLow + 1 ? `${ordinal(needHigh)}` : "further one"} would need ${formatMoney(Math.max(0, needHigh * each - left))} more`
          : byMoney < needLow
            ? `${cost(needLow)} for ${needLow}: ${formatMoney(needLow * each - left)} short, so ${needLow - byMoney} would come out of safe to spend`
            : `the allocation counts ${byCount} more: the other ${needLow - byCount} would be ordinary spending, out of safe to spend`;
    out.push(`${scheduleSaid}: ${verdict}.`);
  } else if (!rate && s.over === 0) {
    out.push(`Say how often you go ("twice a week") and I can say whether it lasts to ${formatMedium(end)}.`);
  }

  // What the uses so far cost on average, when it is more than the share.
  const usedCost = uses.reduce((sum, u) => sum + u.cost, 0);
  const average = uses.length > 0 ? Math.round(usedCost / uses.length) : 0;
  if (average > each && s.over === 0) {
    const atAverage = Math.floor(left / average);
    out.push(`At ${formatMoney(average)} a ${unit}, what ${uses.length === 1 ? "the last one" : "they have"} cost${uses.length === 1 ? "" : " on average"}, ${formatMoney(left)} pays for ${atAverage}${needLow !== null && atAverage < needLow ? `: ${needLow} would need ${formatMoney(needLow * average - left)} more` : ""}.`);
  }
  out.push(`This money is already set aside: ${plural(2, unit)} within it do not come out of safe to spend. Only what goes past ${formatMoney(left)} does.`);
  return out.join(" ");
}

const plural = (n: number, unit: string): string => (n === 1 ? unit : /(?:s|ss|sh|ch|x)$/.test(unit) ? `${unit}es` : `${unit}s`);

const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
};

/** Whether the message asks how many times are left, for a line counted in times. */
export const asksTimesLeft = (text: string): boolean => ASKS_COUNT.test(text);

/** The answer, said plainly. */
export function allocationWords(text: string, month: MonthAllocations, safe: { readonly safe: number; readonly perDay: number } | null, asOf?: IsoDate): string {
  if (month.lines.length === 0) {
    // A month that has ended cannot take one, so it is not offered.
    if (month.phase === "past") return `You had no allocations for ${monthWords(month.month)}.`;
    return `You have no allocations for ${monthWords(month.month)}. Add one on Budget, under Allocations: for example Gas, ${formatMoney(120000)}, ${formatMoney(30000)} a week. ${SAFE_RULE}`;
  }
  const named = linesNamed(text, month.lines.map((s) => s.line));
  const parts: string[] = [];
  let timesSaid = false;
  if (named.length > 0) {
    for (const l of named) {
      const s = month.lines.find((x) => x.line.id === l.id);
      if (!s) continue;
      // "How many sessions are left": counted three ways, said once each (`timesWords`).
      const times = asOf && asksTimesLeft(text) ? timesWords(s, text, asOf, month.phase) : null;
      if (times) timesSaid = true;
      parts.push(times ?? statusWords(s, month.phase));
    }
  } else {
    parts.push(monthWordsFor(month));
  }
  if (month.phase === "running") {
    if (!timesSaid) parts.push(SAFE_RULE);
    if (safe) parts.push(`Safe to spend now, after the allocations: ${formatMoney(Math.max(0, safe.safe))}; today, ${formatMoney(Math.max(0, safe.perDay))}. That is for everything else: the allocations are already taken out of it.`);
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

