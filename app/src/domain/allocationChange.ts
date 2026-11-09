/**
 * Allocations changed from the chat (docs/17 A9): add, change, extend, stop,
 * remove, put back, mark done, hold again and copy, said in words (owner, 9
 * November 2026: "allocation if I want to extend or add or change ... ai
 * should able to do it ... be careful also in keywords").
 *
 * Careful by design. Nothing is read unless the message says "allocation"
 * (or "envelope"), or names a live allocation by its own name with a verb
 * that changes it. A question or a what-if is never a change: it is left to
 * the answers. What is read becomes a card worked out by the same function
 * Budget uses (`applyAllocationChange`), so nothing is saved until the owner
 * presses it, and what the card says is what will be saved. Anything unclear
 * is asked, never guessed.
 *
 * Pure: words in, a change and its card out. Money is integer centavos.
 */
import { applyAllocationChange, heldChange, type ApplyContext } from "./allocationApply";
import { kindFromHistory } from "./planner";
import { formatMoney, withoutYears, type Centavos } from "./money";
import {
  allocatableKinds,
  amountIn,
  cleanDays,
  covers,
  inputOfLine,
  lineName,
  linesIn,
  lineSummary,
  monthAfter,
  monthBefore,
  monthOfDay,
  monthWords,
  paceWords,
  removedLines,
  spanWords,
  timesIn,
  type AllocationChange,
  type AllocationInput,
  type AllocationLine,
  type AllocationPace,
} from "./monthAllocation";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export interface AllocationCardRow {
  readonly label: string;
  readonly value: string;
}

export type AllocationRead =
  | { readonly kind: "change"; readonly change: AllocationChange; readonly words: string; readonly rows: readonly AllocationCardRow[]; readonly action: string }
  | { readonly kind: "ask"; readonly text: string };

export interface ChangeContext {
  /** Every allocation, removed ones too. */
  readonly lines: readonly AllocationLine[];
  readonly reference: Pick<ReferenceLists, "spendingTypes" | "bills" | "subscriptions" | "wallets" | "savings">;
  readonly transactions: readonly Transaction[];
  readonly asOf: IsoDate;
}

const money = formatMoney;

/** Says "allocation" by name: the one gate every change passes. */
const SAYS = /\b(?:allocat\w*|alocat\w*|envelopes?|naka-?allocate)\b/i;
/** A question or a what-if: answered, never acted on. */
const QUESTION = /\b(?:what\s+if|what\s+happens?|what\s+would|if\s+i\b|should\s+i|can\s+i|could\s+i|do\s+i|how\s+much|how\s+many|how\s+does|how\s+do|is\s+it|is\s+my|is\s+there|are\s+my|are\s+there|will\s+it|does\s+it|why|kung\s+(?:mag|i)|ano|magkano|gaano)\b/i;
const ASKING_FOR = /\b(?:can\s+you|could\s+you|would\s+you|will\s+you|pwede|paki|please|pls)\b/i;

const RESTORE = /\b(?:put\s+(?:it\s+)?back|put\s+.{1,40}?\s+back|restore|bring\s+(?:it\s+)?back|bring\s+.{1,40}?\s+back|un-?remove|ibalik)\b/i;
const HOLD_AGAIN = /\b(?:hold\s+(?:it\s+|.{1,40}?\s+)?again|not\s+done|undo\s+(?:the\s+)?done|un-?done)\b/i;
const DONE = /\b(?:done\s+with|(?:is|are|it'?s|its)\s+done|mark\s+(?:it\s+|.{1,40}?\s+)?(?:as\s+)?done|finished\s+with|i'?m\s+finished|release|free\s+(?:up\s+)?(?:the\s+)?(?:rest|what'?s\s+left|what\s+is\s+left|it))\b/i;
const REMOVE = /\b(?:remove|delete|cancel|drop|get\s+rid\s+of|stop|discontinue|tanggalin|alisin)\b/i;
const COPY = /\bcopy\b/i;
const EXTEND = /\b(?:extend|continue|keep\s+(?:it\s+)?going|carry\s+(?:it\s+)?on|repeat|renew)\b/i;
const CHANGE = /\b(?:change|edit|make|set|update|adjust|raise|increase|lower|decrease|reduce|cut|bump|top\s*up|switch|move)\b/i;
const ADD = /\b(?:add|allocate|create|new|set\s+up|start|mag-?allocate|gawa)\b/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_WORD = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, once: 1, twice: 2, thrice: 3 };
const countOf = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : (COUNT_WORDS[w.toLowerCase()] ?? null));

/** A month said by name, the first such month on or after `base`: "march" in November 2026 is March 2027. */
function namedMonth(word: string, year: string | undefined, base: string): string | null {
  const i = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  if (i < 0) return null;
  const mm = String(i + 1).padStart(2, "0");
  if (year) return `${year}-${mm}`;
  const y = Number(base.slice(0, 4));
  return `${i + 1 < Number(base.slice(5, 7)) ? y + 1 : y}-${mm}`;
}

/** "next month", "this month", "last month", or a month by name after a word that says it is one ("in December", "for March"). */
function monthIn(phrase: string, base: string): string | null {
  const t = phrase.toLowerCase();
  if (/\bnext\s+month\b|\bsusunod\s+na\s+buwan\b/.test(t)) return monthAfter(base);
  if (/\bthis\s+month\b|\bngayong\s+buwan\b/.test(t)) return base;
  if (/\blast\s+month\b|\bprevious\s+month\b/.test(t)) return monthBefore(base);
  const m = new RegExp(`\\b(${MONTH_WORD})\\b(?:\\s+(20\\d{2}))?`, "i").exec(t);
  // "may" alone is a verb more often than a month: only after a word that makes it one.
  if (m && (m[1]!.toLowerCase() !== "may" || /\b(?:in|for|of|on|from|until|till|to|through)\s+may\b/.test(t))) return namedMonth(m[1]!, m[2], base);
  return null;
}

/** The days of the week said: "tuesday and thursday", "tue/thu", "weekdays", "every day". */
export function daysSaid(text: string): number[] {
  const t = text.toLowerCase();
  if (/\b(?:every\s*day|daily|araw-?araw)\b/.test(t)) return [1, 2, 3, 4, 5, 6, 0];
  const out = new Set<number>();
  if (/\bweekdays?\b/.test(t)) [1, 2, 3, 4, 5].forEach((d) => out.add(d));
  if (/\bweekends?\b/.test(t)) [6, 0].forEach((d) => out.add(d));
  const names: [RegExp, number][] = [
    [/\b(?:mon(?:day)?s?|lunes)\b/, 1],
    [/\b(?:tue(?:s(?:day)?)?s?|martes)\b/, 2],
    [/\b(?:wed(?:nesday)?s?|miyerkules|myerkules)\b/, 3],
    [/\b(?:thu(?:r(?:s(?:day)?)?)?s?|huwebes)\b/, 4],
    [/\b(?:fri(?:day)?s?|biyernes)\b/, 5],
    [/\b(?:sat(?:urday)?s?|sabado)\b/, 6],
    [/\b(?:sun(?:day)?s?)\b/, 0],
  ];
  for (const [re, d] of names) if (re.test(t)) out.add(d);
  return cleanDays([...out]);
}

interface Figure {
  readonly cents: Centavos;
  readonly pace: AllocationPace | "month" | null;
}

/** The money in a message, each with the pace said after it: "300 a week", "50 each", "1200 for the month". Counts and dates are left out. */
export function figuresIn(text: string): Figure[] {
  // Years only where they are years ("March 2027", "in 2026"): ₱2,000.00 is money (`withoutYears`).
  const t = ` ${withoutYears(text).toLowerCase()} `
    .replace(new RegExp(`\\b${MONTH_WORD}\\s+20\\d{2}\\b`, "gi"), " ")
    .replace(new RegExp(`\\b${MONTH_WORD}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"), " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/g, " ")
    .replace(/\bfor\s+\d{1,2}\s+(?:more\s+)?(?:weeks?|months?|times?|days?)\b/g, " ")
    .replace(/\b\d{1,2}\s*(?:x|times?)\b/g, " ")
    .replace(/\b\d{1,2}\s+(?:more\s+)?(?:weeks?|months?|days?)\b/g, " ");
  const out: Figure[] = [];
  const re = /(?:₱|php\s*|\bp)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k\b)?/gi;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const whole = Number(m[1]!.replace(/,/g, ""));
    if (!Number.isFinite(whole) || whole <= 0) continue;
    const cents = (whole * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0)) * (m[3] ? 1000 : 1);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const pace: Figure["pace"] = /^\s*(?:pesos?\s+)?(?:a|per|each|every|\/|kada|bawat)\s*(?:week|wk)\b|^\s*(?:pesos?\s+)?weekly\b/.test(after)
      ? "week"
      : /^\s*(?:pesos?\s+)?(?:a|per|each|every|\/|kada|bawat)\s*(?:time|visit|session|go)\b/.test(after)
        ? "time"
        : /^\s*(?:pesos?\s+)?(?:(?:a|per|each|every|\/|kada|bawat)\s*day\b|daily\b|each\b|every\s+(?:mon|tue|wed|thu|fri|sat|sun|week(?:day|end))|on\s+(?:mon|tue|wed|thu|fri|sat|sun|week(?:day|end))|tuwing\b)/.test(after)
          ? "day"
          : /^\s*(?:pesos?\s+)?(?:(?:a|per|for\s+the|this|\/)\s*month\b|monthly\b)/.test(after)
            ? "month"
            : null;
    out.push({ cents, pace });
  }
  return out;
}

/** How many weeks or times was said: "for 3 weeks", "8 times", "twice a week" (as times in four weeks). */
function countsIn(text: string): { readonly weeks: number | null; readonly times: number | null; readonly perWeek: number | null } {
  const t = text.toLowerCase();
  const w = /\bfor\s+(\d{1,2}|one|two|three|four|five)\s+weeks?\b/.exec(t);
  const perWeek = /\b(once|twice|thrice|\d|one|two|three|four|five)\s*(?:x|times?)?\s+(?:a|per|every)\s+week\b/.exec(t);
  const times = /\b(?:for\s+)?(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(?:x|times)\b(?!\s+(?:a|per|every)\s+week)/.exec(t);
  return { weeks: w ? countOf(w[1]!) : null, times: times ? countOf(times[1]!) : null, perWeek: perWeek ? countOf(perWeek[1]!) : null };
}

interface Span {
  readonly repeat?: boolean;
  readonly until?: string | undefined;
  /** "for 2 more months": counted from where it ends now. */
  readonly more?: number;
  /** "for 3 months": counted from where it starts. */
  readonly months?: number;
}

/** How long was said: every month, until a month, for some months, or this month only. */
function spanIn(text: string, base: string): Span | null {
  const t = text.toLowerCase();
  if (/\b(?:this\s+month\s+only|only\s+(?:for\s+)?this\s+month|just\s+(?:for\s+)?this\s+month|one\s+month\s+only|not\s+every\s+month)\b/.test(t)) return { repeat: false };
  const until = new RegExp(`\\b(?:until|till|til|up\\s+to|through|thru|hanggang|to)\\s+(?:the\\s+end\\s+of\\s+)?(next\\s+month|${MONTH_WORD})\\b(?:\\s+(20\\d{2}))?`, "i").exec(t);
  if (until) {
    const m = /^next/.test(until[1]!) ? monthAfter(base) : namedMonth(until[1]!, until[2], base);
    // "to" alone is only a span with a word that extends: "extend it to March", never "change it to 500".
    if (m && (!/^to$/i.test(t.slice(until.index, until.index + 2)) || EXTEND.test(t) || /\bkeep\b/.test(t))) return { repeat: true, until: m };
  }
  const more = /\bfor\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+more\s+months?\b|\b(\d{1,2}|one|two|three|four|five|six)\s+more\s+months?\b|\b(?:one|a)\s+more\s+month\b/.exec(t);
  if (more) return { repeat: true, more: more[1] ? (countOf(more[1]) ?? 1) : more[2] ? (countOf(more[2]) ?? 1) : 1 };
  const months = /\bfor\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months\b/.exec(t);
  if (months) return { repeat: true, months: countOf(months[1]!) ?? 1 };
  if (/\b(?:every\s+month|each\s+month|monthly|buwan-?buwan|from\s+now\s+on|indefinitely|for\s+good|repeating|repeat\s+it|keep\s+it\s+going)\b/.test(t)) return { repeat: true };
  return null;
}

/** An account said after "from", "paid from", "using" or "via". */
function walletIn(text: string, accounts: readonly string[]): string | null {
  const t = text.toLowerCase();
  const sorted = [...accounts].sort((a, b) => b.length - a.length);
  for (const a of sorted) {
    const name = a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b(?:from|paid\\s+from|using|via|out\\s+of|in)\\s+(?:my\\s+)?${name}(?![a-z0-9])`).test(t)) return a;
  }
  return null;
}

/** The lines a message names, best first: by their own name, then their words, then their kind. */
function linesSaid(text: string, lines: readonly AllocationLine[]): AllocationLine[] {
  const t = text.toLowerCase();
  const says = (w: string): boolean => {
    const word = w.trim().toLowerCase();
    return word.length >= 2 && new RegExp(`(?<![a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(t);
  };
  const byName = lines.filter((l) => l.name.trim() && says(l.name));
  if (byName.length > 0) return byName;
  const byWords = lines.filter((l) => l.words.split(/[,;]+/).some((w) => w.trim() && says(w)));
  if (byWords.length > 0) return byWords;
  return lines.filter((l) => says(l.kind));
}

/** The kind of spending an addition is for, and the words that narrow it: "gym" is Self Care entries that say gym. */
function kindSaid(text: string, ctx: ChangeContext): { readonly kind: string; readonly words: string; readonly name: string } | null {
  const kinds = allocatableKinds(ctx.reference);
  const t = text.toLowerCase();
  const esc = (s: string): string => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = [...kinds].sort((a, b) => b.length - a.length).find((k) => new RegExp(`(?<![a-z0-9])${esc(k)}(?![a-z0-9])`).test(t));
  // "for gym", "for the gym", "for parking": a word of its own that is not a kind.
  const forWord = /\bfor\s+(?:the\s+|my\s+|our\s+)?([a-z][a-z-]{2,20})\b/.exec(t)?.[1] ?? null;
  const skip = new Set(["the", "this", "next", "last", "every", "each", "month", "months", "week", "weeks", "time", "times", "day", "days", "allocation", "allocations", "it", "me", "now", "good", "only"]);
  const word = forWord && !skip.has(forWord) && !kinds.some((k) => k.toLowerCase() === forWord) && !MONTHS.includes(forWord.slice(0, 3)) ? forWord : null;
  if (named) {
    const under = word && new RegExp(`\\b(?:under|in|as)\\s+${esc(named)}`).test(t) ? word : "";
    return { kind: named, words: under, name: under ? under[0]!.toUpperCase() + under.slice(1) : "" };
  }
  if (!word) return null;
  const kind = kindFromEntries(word, ctx.transactions, kinds) ?? kindFromHistory(word, ctx.transactions, kinds);
  return kind ? { kind, words: word, name: word[0]!.toUpperCase() + word.slice(1) } : null;
}

/** The kind the owner's own entries file a word under, as a whole word: "gym" in "Gym", Self Care. */
function kindFromEntries(word: string, transactions: readonly Transaction[], kinds: readonly string[]): string | null {
  const re = new RegExp(`(?<![a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i");
  const count = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "Spending" || !kinds.includes(t.item)) continue;
    if (re.test(`${t.description} ${t.notes}`)) count.set(t.item, (count.get(t.item) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const ROW = (label: string, value: string): AllocationCardRow => ({ label, value });

/**
 * The input after what was said about amounts, days, counts, span and
 * wallet, on top of `start`. Null fields stay as they were. Returns why it
 * cannot be read, as words, when it is unclear.
 */
function shaped(
  text: string,
  start: AllocationInput,
  ym: string,
  ctx: ChangeContext,
  current: AllocationLine | null,
): { readonly input: AllocationInput; readonly changed: boolean } | { readonly ask: string } {
  const figs = figuresIn(text);
  const days = daysSaid(text);
  const counts = countsIn(text);
  const span = spanIn(text, ym);
  const wallet = walletIn(text, [...ctx.reference.wallets, ...ctx.reference.savings]);
  let input: AllocationInput = { ...start };
  let changed = false;
  const t = text.toLowerCase();
  const by = /\b(?:by|of)\s+(?:₱|php\s*)?\d/.test(t) || /\badd\s+(?:₱|php\s*)?\d/.test(t) || /\btake\s+(?:₱|php\s*)?\d[\d,.]*\s*k?\s+off\b/.test(t);
  const up = /\b(?:raise|increase|add|bump|top\s*up|more)\b/.test(t);
  const down = /\b(?:lower|decrease|reduce|cut|less|take)\b/.test(t);

  if (days.length > 0) {
    input = { ...input, per: "day", days, amount: null };
    changed = true;
  }
  const paced = figs.find((f) => f.pace && f.pace !== "month");
  const monthly = figs.find((f) => f.pace === "month");
  const bare = figs.find((f) => f.pace === null);
  const timesNow = current ? (timesIn(current, ym) ?? 0) : 0;

  if (by && (up || down) && figs.length > 0 && current) {
    // Raised or lowered by an amount: the month's total moves, the pace kept when it still divides evenly.
    const delta = figs[0]!.cents * (down && !up ? -1 : 1);
    const was = amountIn(current, ym);
    const total = was + delta;
    if (total <= 0) return { ask: `That takes ${lineName(current)} to ${money(Math.max(0, total))}. To end it, say "remove the ${lineName(current)} allocation".` };
    if (current.per && current.each && timesNow > 0) {
      if (total % timesNow !== 0) return { ask: `${money(total)} does not split evenly over ${timesNow} ${current.per === "week" ? "weeks" : current.per === "day" ? "days" : "times"}. Say it as an amount ${current.per === "week" ? "a week" : current.per === "day" ? "each day" : "a time"}, or "make it ${money(total).replace("₱", "")} for the month".` };
      input = { ...input, each: total / timesNow, ...(current.per === "day" ? {} : { times: timesNow }) };
    } else {
      input = { ...input, amount: total, per: undefined, each: null, times: null };
    }
    changed = true;
  } else if (paced) {
    const per = paced.pace as AllocationPace;
    if (per === "day" && days.length === 0 && !(current?.per === "day") && !(input.per === "day")) {
      return { ask: `Which days of the week? Say them: "${money(paced.cents)} every Tuesday and Thursday", or "every day".` };
    }
    const nextPer: AllocationPace = per === "day" ? "day" : per;
    const times =
      nextPer === "week" ? (counts.weeks ?? (current?.per === "week" ? current.times : null) ?? (monthly ? Math.round(monthly.cents / paced.cents) : 4)) : nextPer === "time" ? (counts.times ?? (counts.perWeek ? counts.perWeek * 4 : null) ?? (current?.per === "time" ? current.times : null) ?? (monthly ? Math.round(monthly.cents / paced.cents) : null)) : undefined;
    if (nextPer === "time" && !times) return { ask: `How many times in ${monthWords(ym)}? Say "${money(paced.cents)} a time, 8 times", or "twice a week".` };
    if (monthly && times && monthly.cents !== paced.cents * times) return { ask: `${money(monthly.cents)} for the month is not ${money(paced.cents)} times ${times}. Say one of them.` };
    input = { ...input, per: nextPer, each: paced.cents, amount: null, ...(nextPer === "day" ? { days: days.length > 0 ? days : (input.days ?? []) } : { times: times ?? null }) };
    changed = true;
  } else if (monthly || bare) {
    const cents = (monthly ?? bare)!.cents;
    const keepPace = !monthly && current?.per && timesNow > 0 && input.per === current.per && days.length === 0;
    if (input.per === "day" && days.length > 0 && !current) {
      // "50 every tuesday and thursday" with the pace after the days: each day.
      input = { ...input, each: cents };
    } else if (keepPace && current) {
      if (cents % timesNow !== 0) return { ask: `${lineName(current)} is ${paceWords(current) || "paced"}. Is ${money(cents)} ${current.per === "week" ? "a week" : current.per === "day" ? "each day" : "a time"}, or for the whole month? Say "${money(cents)} ${current.per === "week" ? "a week" : current.per === "day" ? "each day" : "a time"}" or "${money(cents)} for the month".` };
      input = { ...input, each: cents / timesNow };
    } else {
      input = { ...input, amount: cents, per: undefined, each: null, times: null, days: undefined };
    }
    changed = true;
  } else if (counts.weeks && (input.per === "week" || current?.per === "week")) {
    input = { ...input, times: counts.weeks };
    changed = true;
  } else if (counts.times && (input.per === "time" || current?.per === "time")) {
    input = { ...input, times: counts.times };
    changed = true;
  }

  if (span) {
    const base = current?.month ?? ym;
    const endNow = current?.repeat ? (current.until ?? null) : (current?.month ?? null);
    let until = span.until;
    if (span.more) {
      let m = endNow ?? ym;
      for (let i = 0; i < span.more; i += 1) m = monthAfter(m);
      until = m;
    } else if (span.months) {
      let m = base;
      for (let i = 1; i < span.months; i += 1) m = monthAfter(m);
      until = m;
    }
    input = span.repeat ? { ...input, repeat: true, until } : { ...input, repeat: false, until: undefined };
    changed = true;
  }
  if (wallet) {
    input = { ...input, wallet };
    changed = true;
  }
  return { input, changed };
}

/** What the change does to safe to spend this month, in words. */
function effectWords(before: readonly AllocationLine[], after: readonly AllocationLine[], ctx: ChangeContext): string {
  const h = heldChange(before, after, ctx.transactions, ctx.asOf);
  const d = h.after - h.before;
  if (d === 0) return "Safe to spend this month is unchanged.";
  return d > 0 ? `It sets aside ${money(d)} more now, so safe to spend is ${money(d)} lower.` : `It sets aside ${money(-d)} less now, so safe to spend is ${money(-d)} higher.`;
}

/** The card's rows for a line. */
function lineRows(l: AllocationLine, ym: string): AllocationCardRow[] {
  const pace = paceWords({ ...l, times: timesIn(l, ym) });
  return [
    ROW("Allocation", lineName(l)),
    ROW("Counts", `${l.kind}${l.words ? ` entries that say ${l.words}` : " entries"}`),
    ROW("Amount", `${money(amountIn(l, ym))} for ${monthWords(ym)}${pace ? `, ${pace}` : ""}`),
    ROW("How long", spanWords(l)),
    ...(l.wallet ? [ROW("Paid from", l.wallet)] : []),
  ];
}

/**
 * A change to the allocations said in the chat, as a card to press; a
 * question back when something is missing; or null when the message is not
 * one (a question, a what-if, or nothing about allocations).
 */
export function readAllocationChange(text: string, ctx: ChangeContext): AllocationRead | null {
  const t = text.trim();
  if (!t || /^\s*\/\//.test(t)) return null;
  const now = monthOfDay(ctx.asOf);
  const live = (ym: string): AllocationLine[] => linesIn(ctx.lines, ym);
  const saysIt = SAYS.test(t);
  // Not "allocation": only a live line of this month named by its own name, with a verb that changes it.
  const namedNow = linesSaid(t, live(now)).filter((l) => l.name.trim());
  if (!saysIt && !(namedNow.length > 0 && (REMOVE.test(t) || DONE.test(t) || EXTEND.test(t)) && /\b(?:the|my)\s/i.test(t))) return null;
  // A question or a what-if is never a change, however politely asked ("please ... what if": stress test, 9 November 2026).
  if (QUESTION.test(t)) return null;
  if (/\?\s*$/.test(t) && !ASKING_FOR.test(t)) return null;

  const apply = (change: AllocationChange): ReturnType<typeof applyAllocationChange> => applyAllocationChange(ctx.lines, change, { ...ctx, newId: () => "preview" } as ApplyContext);

  // "from next month", "from December": the month a stop or a change starts.
  const fromM = new RegExp(`\\b(?:from|starting|simula)\\s+(next\\s+month|this\\s+month|${MONTH_WORD})\\b(?:\\s+(20\\d{2}))?`, "i").exec(t);
  const fromMonth = fromM ? (/^next/i.test(fromM[1]!) ? monthAfter(now) : /^this/i.test(fromM[1]!) ? now : namedMonth(fromM[1]!, fromM[2], now)) : null;
  // The month spoken of, with "until ..." and "from ..." taken out: "allocate 300 a week for gas next month".
  const plain = t
    .replace(new RegExp(`\\b(?:until|till|til|up\\s+to|through|thru|hanggang|to)\\s+(?:the\\s+end\\s+of\\s+)?(?:next\\s+month|${MONTH_WORD})\\b(?:\\s+20\\d{2})?`, "gi"), " ")
    .replace(new RegExp(`\\b(?:from|starting|simula)\\s+(?:next\\s+month|this\\s+month|${MONTH_WORD})\\b(?:\\s+20\\d{2})?`, "gi"), " ");
  const ym = monthIn(plain, now) ?? fromMonth ?? now;

  // ── Copy ─────────────────────────────────────────────────────────────
  if (COPY.test(t)) {
    const toNext = /\b(?:to|into|for)\s+next\s+month\b/i.test(t);
    const from = toNext ? now : /\blast\s+month|previous\s+month\b/i.test(t) ? monthBefore(now) : monthBefore(ym === now ? now : ym);
    const to = toNext ? monthAfter(now) : ym === from ? monthAfter(from) : ym;
    const change: AllocationChange = { kind: "copy", from, to };
    const done = apply(change);
    if (!done.ok) return { kind: "ask", text: done.why };
    const copied = done.copied ?? [];
    return {
      kind: "change",
      change,
      action: "Copy them",
      words: `Copy ${copied.length} ${copied.length === 1 ? "allocation" : "allocations"} from ${monthWords(from)} into ${monthWords(to)}: amounts and pace, never what was left. ${to === now ? effectWords(ctx.lines, done.lines, ctx) : `They hold from ${monthWords(to)} 1.`} Nothing is saved until you press Copy them.`,
      rows: copied.map((l) => ROW(lineName(l), `${money(l.amount)}${paceWords(l) ? `, ${paceWords(l)}` : ""}`)),
    };
  }

  // ── Put back ────────────────────────────────────────────────────────
  if (RESTORE.test(t) && !HOLD_AGAIN.test(t)) {
    const gone = linesSaid(t, removedLines(ctx.lines));
    if (gone.length === 0) {
      const all = removedLines(ctx.lines);
      return { kind: "ask", text: all.length === 0 ? "No allocation is removed, so there is nothing to put back." : `Which one? Removed: ${all.map((l) => `${lineName(l)} (${monthWords(l.stoppedFrom ?? l.month)})`).join(", ")}.` };
    }
    if (gone.length > 1) return { kind: "ask", text: `Which one? ${gone.map((l) => `${lineName(l)}, ${monthWords(l.stoppedFrom ?? l.month)}`).join("; ")}.` };
    const l = gone[0]!;
    const change: AllocationChange = { kind: "restore", id: l.id };
    const done = apply(change);
    if (!done.ok) return { kind: "ask", text: done.why };
    return {
      kind: "change",
      change,
      action: "Put it back",
      words: `Put back the ${lineName(l)} allocation${done.unstopped && l.stoppedFrom ? ` from ${monthWords(l.stoppedFrom)} on` : ""}. ${effectWords(ctx.lines, done.lines, ctx)} Nothing is saved until you press Put it back.`,
      rows: lineRows(done.line ?? l, l.stoppedFrom ?? l.month),
    };
  }

  // The live lines of the month spoken of that the message names; with "from next month", this month's too.
  const namedThere = linesSaid(t, live(ym));
  const named = namedThere.length === 0 && fromMonth && ym !== now ? linesSaid(t, live(now)) : namedThere;
  const one = (verb: string): AllocationLine | AllocationRead => {
    if (named.length === 1) return named[0]!;
    if (named.length === 0) {
      const there = live(ym);
      return { kind: "ask", text: there.length === 0 ? `${monthWords(ym)} has no allocations to ${verb}.` : `Which allocation? ${monthWords(ym)} has ${there.map(lineName).join(", ")}.` };
    }
    return { kind: "ask", text: `Which one? ${named.map(lineName).join(" or ")}.` };
  };
  const isLine = (x: AllocationLine | AllocationRead): x is AllocationLine => "id" in x;

  // ── Hold again, done ───────────────────────────────────────────────
  if (HOLD_AGAIN.test(t) || DONE.test(t)) {
    const again = HOLD_AGAIN.test(t);
    const l = one(again ? "hold again" : "mark done");
    if (!isLine(l)) return l;
    if (ym !== now) return { kind: "ask", text: `Done is for the month that is running, ${monthWords(now)}. ${monthWords(ym)} is not running.` };
    const change: AllocationChange = { kind: again ? "undone" : "done", id: l.id, month: ym };
    const done = apply(change);
    if (!done.ok) return { kind: "ask", text: done.why };
    return again
      ? { kind: "change", change, action: "Hold it again", words: `Hold the ${lineName(l)} allocation again for ${monthWords(ym)}. ${effectWords(ctx.lines, done.lines, ctx)} Nothing is saved until you press Hold it again.`, rows: lineRows(l, ym) }
      : {
          kind: "change",
          change,
          action: "Mark it done",
          words: `Mark ${lineName(l)} done for ${monthWords(ym)}: the ${money(done.freed ?? 0)} it has left is freed today, what was spent stays counted, and ${l.kind} spent after today is ordinary spending.${l.repeat ? " Next month it holds again as usual." : ""} Nothing is saved until you press Mark it done.`,
          rows: [...lineRows(l, ym), ROW("Freed", money(done.freed ?? 0))],
        };
  }

  // ── Remove, or stop from a month ─────────────────────────────────────
  if (REMOVE.test(t) && !ADD.test(t.replace(/\ballocat\w*/gi, ""))) {
    const target = fromMonth && fromMonth > now ? fromMonth : ym;
    const l = one("remove");
    if (!isLine(l)) return l;
    if (fromMonth && fromMonth > l.month && !l.repeat) return { kind: "ask", text: `${lineName(l)} is for ${monthWords(l.month)} only, so it holds nothing in ${monthWords(fromMonth)} already. To remove it from ${monthWords(l.month)} too, say "remove the ${lineName(l)} allocation".` };
    const change: AllocationChange = { kind: "remove", id: l.id, month: target };
    const done = apply(change);
    if (!done.ok) return { kind: "ask", text: done.why };
    return done.from
      ? {
          kind: "change",
          change,
          action: "Stop it",
          words: `Stop the ${lineName(l)} allocation from ${monthWords(done.from)}: ${monthWords(l.month)} to ${monthWords(monthBefore(done.from))} keep it, with what was spent. It is kept under Removed on Budget and in the Bin, to put back. Nothing is saved until you press Stop it.`,
          rows: [...lineRows(l, l.month), ROW("Stops from", monthWords(done.from))],
        }
      : {
          kind: "change",
          change,
          action: "Remove it",
          words: `Remove the ${lineName(l)} allocation for ${monthWords(l.month)}. ${effectWords(ctx.lines, done.lines, ctx)} It is kept under Removed on Budget and in the Bin, to put back; entries are not changed. To keep it with what was spent and free only what is left, say "${lineName(l)} is done" instead. Nothing is saved until you press Remove it.`,
          rows: lineRows(l, ym),
        };
  }

  // ── Change or extend a line there is ────────────────────────────────
  const editing = named.length > 0 && (CHANGE.test(t) || EXTEND.test(t) || /\b(?:add|raise|increase|lower|reduce|cut)\b.*\d/i.test(t) || spanIn(t, ym) !== null || (!ADD.test(t) && figuresIn(t).length > 0));
  if (editing) {
    const l = one("change");
    if (!isLine(l)) return l;
    const start = inputOfLine(l);
    const read = shaped(t, start, fromMonth ?? ym, ctx, l);
    if ("ask" in read) return { kind: "ask", text: read.ask };
    if (!read.changed) return { kind: "ask", text: `What should change on ${lineName(l)}? Say the amount ("make it 1500", "400 a week", "60 each time"), the days ("Tuesday and Thursday"), how long ("every month", "until March", "for 2 more months"), or where it is paid from.` };
    // "From next month" on a line for this month only: next month gets its own, this month keeps it.
    if (fromMonth && fromMonth > l.month && !l.repeat && !covers(l, fromMonth)) {
      const change: AllocationChange = { kind: "add", month: fromMonth, input: { ...read.input, repeat: read.input.repeat ?? false } };
      const done = apply(change);
      if (!done.ok) return { kind: "ask", text: done.why };
      return { kind: "change", change, action: "Add the allocation", words: `${lineName(l)} is for ${monthWords(l.month)} only, so ${monthWords(fromMonth)} gets its own: ${lineSummary(done.line!)}. ${monthWords(l.month)} keeps what it has. Nothing is saved until you press Add the allocation.`, rows: lineRows(done.line!, fromMonth) };
    }
    const change: AllocationChange = { kind: "edit", id: l.id, input: read.input, month: fromMonth ?? ym };
    const done = apply(change);
    if (!done.ok) return { kind: "ask", text: done.why };
    const after = done.line!;
    const shown = done.from ?? ym;
    return {
      kind: "change",
      change,
      action: "Save the change",
      words: `Change ${lineName(l)}${done.from ? ` from ${monthWords(done.from)} on (the months before keep what they had)` : ""}: ${money(amountIn(l, shown))}${paceWords({ ...l, times: timesIn(l, shown) }) ? ` (${paceWords({ ...l, times: timesIn(l, shown) })})` : ""}, ${spanWords(l)}, becomes ${money(amountIn(after, shown))}${paceWords({ ...after, times: timesIn(after, shown) }) ? ` (${paceWords({ ...after, times: timesIn(after, shown) })})` : ""}, ${spanWords(after)}. ${effectWords(ctx.lines, done.lines, ctx)} Nothing is saved until you press Save the change.`,
      rows: [ROW("Now", lineSummary(l)), ROW("After", lineSummary(after))],
    };
  }

  // ── Add ─────────────────────────────────────────────────────────────
  if (ADD.test(t) || /\ballocate\b/i.test(t) || figuresIn(t).length > 0) {
    const what = kindSaid(t, ctx);
    if (!what) {
      const kinds = allocatableKinds(ctx.reference);
      return { kind: "ask", text: `For which kind of spending? Say it with the amount: "allocate 300 a week for Gas", or for part of a kind, "allocate 50 every Tuesday and Thursday for gym under Self Care". Your kinds: ${kinds.slice(0, 12).join(", ")}${kinds.length > 12 ? ", and more" : ""}.` };
    }
    // Already there for the month: said as a change of it, never a second one.
    const twin = live(ym).find((l) => l.kind.toLowerCase() === what.kind.toLowerCase() && l.words.trim().toLowerCase() === what.words.toLowerCase());
    if (twin) return { kind: "ask", text: `${monthWords(ym)} has an allocation for ${lineName(twin)} already: ${lineSummary(twin)}. To change it, say "change the ${lineName(twin)} allocation to ..." with the new amount.` };
    const read = shaped(t, { name: what.name, kind: what.kind, words: what.words, amount: null }, ym, ctx, null);
    if ("ask" in read) return { kind: "ask", text: read.ask };
    if (read.input.amount === null && !read.input.each) return { kind: "ask", text: `How much for ${what.name || what.kind}? Say "1200 for the month", "300 a week", "50 a time, 8 times", or "50 every Tuesday and Thursday".` };
    const change: AllocationChange = { kind: "add", month: ym, input: read.input };
    const done = apply(change);
    if (!done.ok) return { kind: "ask", text: done.why };
    const line = done.line!;
    return {
      kind: "change",
      change,
      action: "Add the allocation",
      words: `Allocate ${lineSummary(line)}.${line.from ? ` It counts from today, ${line.from}: the days before were not in it.` : ""} ${ym === now ? effectWords(ctx.lines, done.lines, ctx) : `It holds from ${monthWords(ym)} 1.`} Nothing is saved until you press Add the allocation.`,
      rows: lineRows(line, ym),
    };
  }

  // Said "allocation" with no change in it ("my allocations"): a question, for the answers.
  if (!(CHANGE.test(t) || EXTEND.test(t) || ADD.test(t))) return null;
  return {
    kind: "ask",
    text: 'Allocations can be added, changed, extended, marked done, stopped, removed and put back from here. For example: "allocate 300 a week for gas", "allocate 50 every Tuesday and Thursday for gym", "change the gas allocation to 1500", "make the gym allocation every month", "extend gas until March", "the gym allocation is done", "remove the parking allocation", "put back the gas allocation", "copy last month\'s allocations".',
  };
}

