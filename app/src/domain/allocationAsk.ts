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

/** Below zero said as short: safe to spend after a change. */
const safeAfter = (c: number): string => (c >= 0 ? formatMoney(c) : `${formatMoney(-c)} short, below zero`);

/**
 * What it takes for a line counted in times to last until its month ends,
 * at its share and at what the uses so far cost, what each would set aside
 * from safe to spend, and any total or rate the message names.
 *
 * The owner, 10 November 2026, on a gym allocation counted in sessions, two
 * in, each dearer than its share: "is my allocation accurate?", "do I need
 * to add to the allocation", "can you make it until the months end", "like
 * how much to add?", "can we up the budget to" a figure, and "that would
 * cover" a price "per session and 3x per week". The model was given what was
 * spent and left, and worked the rest out itself: what was left paid for one
 * count of sessions in one answer and another in the next, and the new total
 * was split over the old count when the owner meant a new price three times
 * a week.
 * Null for a line not counted in times, or a month not running.
 */
export function coverWords(s: AllocationStatus, text: string, asOf: IsoDate, phase: MonthAllocations["phase"], safe: number | null): string | null {
  const line = s.line;
  if ((line.per !== "time" && line.per !== "day") || !line.each || !line.times || phase !== "running" || s.done) return null;
  const each = line.each;
  const uses = s.uses ?? [];
  const used = s.timesUsed ?? uses.length;
  const left = s.left;
  const rest = Math.max(0, line.times - used);
  const noun = /\b(session|class|visit|ride|trip|lesson|game|round)(?:e?s)?\b/i.exec(text)?.[1]?.toLowerCase() ?? (line.per === "day" ? "day" : "time");
  const end = lastOfMonth(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)));
  const out: string[] = [`To last until ${formatMedium(end)}: ${rest} more ${plural(rest, noun)} counted (${line.times} less the ${used} used), with ${formatMoney(Math.max(0, left))} left.`];
  const option = (price: number, why: string): { readonly total: number; readonly more: number } => {
    const need = rest * price;
    const more = Math.max(0, need - Math.max(0, left));
    const total = line.amount + more;
    out.push(
      more === 0
        ? `- At ${formatMoney(price)} each, ${why}: ${formatMoney(need)} for the ${rest}, so it is enough, with ${formatMoney(Math.max(0, left) - need)} to spare.`
        : `- At ${formatMoney(price)} each, ${why}: ${formatMoney(need)} for the ${rest}, ${formatMoney(more)} more than is left, so ${formatMoney(total)} in all.`,
    );
    return { total, more };
  };
  const atShare = option(each, "its share");
  const usedCost = uses.reduce((sum, u) => sum + u.cost, 0);
  const average = uses.length > 0 ? Math.round(usedCost / uses.length) : 0;
  const atAverage = average > each ? option(average, `what ${uses.length === 1 ? "the one so far" : `the ${uses.length} so far`} cost${uses.length === 1 ? "" : " on average"}`) : null;
  if (safe !== null) {
    const after = [atShare, ...(atAverage ? [atAverage] : [])].filter((o) => o.more > 0);
    if (after.length > 0) {
      out.push(`Raising it sets the extra aside now, out of safe to spend (${formatMoney(safe)}): ${after.map((o) => `${safeAfter(safe - o.more)} at ${formatMoney(o.total)}`).join("; ")}.`);
    }
  }
  // A total the message names: "up the budget to 750".
  const totals = [...text.matchAll(/(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+|\d{3,6})(?:\.\d{1,2})?(?!\s*(?:x|times|a\s+week|per\s+week|pesos?\s+(?:per|a|each)|per|each|a\s+(?:session|time|visit)))/gi)]
    .map((m) => Number((m[1] ?? "").replace(/,/g, "")) * 100)
    .filter((c) => c >= 10_000 && c !== line.amount);
  for (const total of [...new Set(totals)].slice(0, 2)) {
    const free = total - s.spent;
    const more = total - line.amount;
    out.push(
      `At ${formatMoney(total)} in all: ${more >= 0 ? `${formatMoney(more)} more` : `${formatMoney(-more)} less`} than now, ${formatMoney(Math.max(0, free))} left after the ${formatMoney(s.spent)} spent, which pays for ${Math.floor(Math.max(0, free) / each)} at ${formatMoney(each)}${average > each ? ` or ${Math.floor(Math.max(0, free) / average)} at ${formatMoney(average)}` : ""}${safe !== null && more > 0 ? `; safe to spend would be ${safeAfter(safe - more)}` : ""}.`,
    );
  }
  // A price and a rate the message names: "60 pesos per session and 3x per week".
  const price = /(?:₱|php\s*)?(\d{1,5})(?:\.\d{1,2})?\s*(?:pesos?\s*)?(?:per|a|each|every)\s+(?:session|time|visit|class|day)\b/i.exec(text);
  const rate = rateSaid(text.replace(/(\d)\s*x\s*(?=(?:a|per|each|every)\s+week)/gi, "$1 times "));
  if (price?.[1] && rate && "perWeek" in rate) {
    const p = Number(price[1]) * 100;
    const span: IsoDate[] = [];
    for (let d = uses.some((u) => u.date === asOf) ? addDays(asOf, 1) : asOf; d <= end; d = addDays(d, 1)) span.push(d);
    const fromNow = Math.round((rate.perWeek * span.length) / 7);
    const monthDays = Number(end.slice(8, 10));
    const wholeMonth = rate.perWeek * Math.floor(monthDays / 7);
    out.push(
      `At ${formatMoney(p)} a ${noun}, ${rate.perWeek} a week: from ${span[0] ? formatMedium(span[0]) : "now"} to ${formatMedium(end)} (${span.length} days) is about ${fromNow} ${plural(fromNow, noun)}, ${formatMoney(fromNow * p)}; with the ${formatMoney(s.spent)} already spent the month comes to ${formatMoney(s.spent + fromNow * p)}. Four whole weeks at that rate is ${wholeMonth} ${plural(wholeMonth, noun)}, ${formatMoney(wholeMonth * p)}.`,
    );
  }
  return out.join("\n");
}

/**
 * The line week by week: what each week used, and what is still counted over
 * the weeks left, with how much of it the money left covers (owner, 10
 * November 2026: "make a allocation per week ... the week that already used
 * and the week still covered and the week need to add").
 */
export function weeksWords(s: AllocationStatus, asOf: IsoDate, phase: MonthAllocations["phase"]): string | null {
  const line = s.line;
  if ((line.per !== "time" && line.per !== "day") || !line.each || !line.times || phase !== "running" || s.done) return null;
  const each = line.each;
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const first = `${asOf.slice(0, 7)}-01` as IsoDate;
  const end = lastOfMonth(y, m);
  const weeks: { from: IsoDate; to: IsoDate }[] = [];
  for (let d = first; d <= end; ) {
    const sunday = addDays(d, (7 - dayOfWeek(d)) % 7);
    const to = sunday > end ? end : sunday;
    weeks.push({ from: d, to });
    d = addDays(to, 1);
  }
  const uses = s.uses ?? [];
  const used = s.timesUsed ?? uses.length;
  const rest = Math.max(0, line.times - used);
  const ahead = weeks.filter((w) => w.to >= asOf);
  const perWeek = ahead.length > 0 ? Math.ceil(rest / ahead.length) : 0;
  let covered = Math.floor(Math.max(0, s.left) / each);
  let still = rest;
  const lines = weeks.map((w) => {
    const inWeek = uses.filter((u) => u.date >= w.from && u.date <= w.to);
    const cost = inWeek.reduce((sum, u) => sum + u.cost, 0);
    const mon = (MONTHS[Number(w.from.slice(5, 7)) - 1] ?? "").slice(0, 3).replace(/^./, (c) => c.toUpperCase());
    const name = w.from === w.to ? `${mon} ${Number(w.from.slice(8, 10))}` : `${mon} ${Number(w.from.slice(8, 10))} to ${Number(w.to.slice(8, 10))}`;
    const done = inWeek.length > 0 ? `${inWeek.length} used, ${formatMoney(cost)}` : w.to < asOf ? "none used" : "";
    if (w.to < asOf) return `- ${name}: ${done}.`;
    const planned = Math.min(still, perWeek);
    still -= planned;
    const fits = Math.min(planned, covered);
    covered -= fits;
    const short = planned - fits;
    const plan = planned === 0 ? "" : short === 0 ? `${planned} still counted, covered by what is left` : `${planned} still counted, ${fits} covered, ${short} needing ${formatMoney(short * each)} more`;
    return `- ${name}: ${[done, plan].filter(Boolean).join("; ") || "nothing counted"}.`;
  });
  return `${s.name} week by week, at ${formatMoney(each)} a time, the ${rest} still counted spread over the ${ahead.length} weeks left:\n${lines.join("\n")}`;
}

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
  /*
   * For every line counted in times: what it takes to last the month, and
   * week by week when weeks are asked about (`coverWords`, `weeksWords`).
   */
  if (asOf) {
    const counted = (named.length > 0 ? month.lines.filter((x) => named.some((l) => l.id === x.line.id)) : month.lines);
    for (const s of counted) {
      const cover = coverWords(s, text, asOf, month.phase, safe ? safe.safe : null);
      if (cover) parts.push(cover);
      const weekly = /\bweek(?:s|ly)?\b|\blingguhan\b/i.test(text) ? weeksWords(s, asOf, month.phase) : null;
      if (weekly) parts.push(weekly);
    }
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


// ── A talk about one allocation ─────────────────────────────────────────────

/**
 * The one line the owner's recent messages named, latest first: "why gym is
 * off?" names Gym, and the messages after it are about Gym until another
 * line is named.
 */
export function lineTalkedAbout(said: readonly string[], live: readonly AllocationLine[]): AllocationLine | null {
  for (const text of [...said].reverse()) {
    const named = linesNamed(text, live);
    if (named.length === 1) return named[0] ?? null;
    if (named.length > 1) return null;
  }
  return null;
}

const MONTH_SAID = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|this month|next month|last month|month'?s)\b/i;

/**
 * "Budget" said of an allocation, read as the allocation.
 *
 * The owner, 10 November 2026, talking about the gym allocation: "make the
 * gym budget higher" with a figure became a card setting November's whole
 * budget to that figure, none of it for spending, and "can we up the budget
 * to" a figure was answered as a month's budget. A line named with "budget" is that
 * line; with none named, a figure well below any month's budget, in a talk
 * about one line, is that line too. Anything else is left as it was.
 */
export function allocationMeant(text: string, live: readonly AllocationLine[], talked: AllocationLine | null): string {
  if (!/\bbudget\b/i.test(text) || /\ballocat/i.test(text)) return text;
  const named = linesNamed(text.replace(/\bbudget\b/gi, " "), live);
  if (named.length === 1) return text.replace(/\bbudget\b/i, "allocation");
  if (!talked || named.length > 0 || MONTH_SAID.test(text)) return text;
  const figure = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/.exec(text);
  const pesos = figure?.[1] ? Number(figure[1].replace(/,/g, "")) : null;
  if (pesos === null || pesos <= 0 || pesos >= 3000) return text;
  if (!/\b(?:up|raise|higher|increase|lower|decrease|less|more|make|change|set|to|add)\b/i.test(text)) return text;
  return text.replace(/\b(?:the\s+|my\s+)?budget\b/i, `the ${talked.name.toLowerCase()} allocation`);
}

/**
 * A message that carries on a talk about allocations without saying the
 * word: "how much to add?", "can you make it until the months end?",
 * "what are you proposing?", "so is it safe to make it higher?". The
 * owner's, 10 November 2026: each went to the model without the
 * allocation's figures, and it worked them out itself, differently each time.
 */
export function followsAllocation(text: string): boolean {
  const t = text.trim();
  if (!t || t.startsWith("//") || t.split(/\s+/).length > 24) return false;
  // A month's budget set by name is the budget's: "set my november budget to 950".
  if (/^\s*(?:please\s+)?(?:set|change|update|copy|make)\b/i.test(t) && /\bbudget\b/i.test(t) && MONTH_SAID.test(t)) return false;
  // Another subject altogether: "how much did I spend on food this month" is not about the gym.
  if (/\b(?:spend|spent|spending|income|earn\w*|balance|bills?|subscriptions?|debts?|owe|planner|chart|graph|pie|trend|entries|transactions?|records?|last\s+(?:week|month|year)|yesterday|today)\b/i.test(t) && !/\b(?:allocat\w*|sessions?|visits?)\b/i.test(t)) return false;
  return /\b(?:add|up|raise|higher|lower|increase|decrease|more|less|cover|enough|afford|safe|propos\w*|recommend\w*|suggest\w*|per\s+(?:session|week|time|visit)|a\s+(?:session|week)|sessions?|visits?|budget|how\s+much|weeks?|weekly|month'?s?\s+end|end\s+of\s+the\s+month|until|last|calculation|computation|worked?\s+(?:it\s+)?out|accurate|off|short|solution|instead)\b/i.test(t);
}
