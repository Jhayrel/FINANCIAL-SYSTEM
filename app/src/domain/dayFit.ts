/**
 * What today's figure buys, and an answer that says it buys more than it does.
 *
 * ── The conversation this exists for ──────────────────────────────────────
 *
 * The owner, 7 October 2026, with safe to spend at PHP 80.64 a day:
 *
 *   Like the food prices, etc does 80 pesos still useful?
 *     -> "Yes, PHP 80.64 is useful because food items like a PHP 25.00
 *        bottle of water or a PHP 95.00 meal are within that daily limit"
 *   How do you even buy a meal of 95 but your safe spend is 80?
 *     -> "You cannot buy a PHP 95.00 meal today ..."
 *   But why you suggested it?
 *     -> how PHP 80.64 was worked out, as if the first answer had stood
 *
 * PHP 95.00 is more than PHP 80.64. Every figure in the first answer was
 * real, so the check for invented figures (`aiFigures.ts`) let it through:
 * the fault was the comparison, and comparing is arithmetic, which the model
 * is not trusted with. So the app does it, three ways:
 *
 *   - `everydayPrices` and `pricesAgainstDay`: the owner's own everyday
 *     purchases, each set against today's figure and the rate from tomorrow,
 *     handed to the model as worked facts.
 *   - `fitSlips`: an answer that calls an amount within a daily figure it
 *     is above gets a line underneath saying so. Reported, never rewritten,
 *     like every other check here.
 *   - `challengesAnswer`: "why did you say that" is checked against the
 *     answer it points at, so the reply starts by owning the mistake.
 */

import { figuresIn } from "./aiFigures";
import { addDays } from "./dates";
import { figuresIn as figuresSaid, type Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

// ── The owner's everyday prices ────────────────────────────────────────────

export interface EverydayPrice {
  /** The item as the ledger spells it most recently. */
  readonly name: string;
  /** The middle single purchase, not the mean: one feast does not make lunch dearer. */
  readonly usual: Centavos;
  readonly low: Centavos;
  readonly high: Centavos;
  /** Purchases in the window. */
  readonly count: number;
}

const WINDOW_DAYS = 60;
const MIN_COUNT = 3;
const TOP = 8;

/**
 * The things bought often enough to have a usual price: ordinary spending
 * only (bills and subscriptions have their own lines), at least three times
 * in the last sixty days, most frequent first.
 */
export function everydayPrices(transactions: readonly Transaction[], asOf: IsoDate): EverydayPrice[] {
  const since = addDays(asOf, -WINDOW_DAYS);
  const byItem = new Map<string, { name: string; latest: string; amounts: Centavos[] }>();
  for (const t of transactions) {
    if (t.type !== "Spending" || t.category !== "Spending") continue;
    if (t.date < since || t.date > asOf || t.total <= 0) continue;
    const name = t.item.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const seen = byItem.get(key);
    if (!seen) byItem.set(key, { name, latest: t.date, amounts: [t.total] });
    else {
      seen.amounts.push(t.total);
      if (t.date >= seen.latest) {
        seen.latest = t.date;
        seen.name = name;
      }
    }
  }
  const out: EverydayPrice[] = [];
  for (const { name, amounts } of byItem.values()) {
    if (amounts.length < MIN_COUNT) continue;
    const sorted = [...amounts].sort((a, b) => a - b);
    const half = Math.floor(sorted.length / 2);
    const usual = sorted.length % 2 === 1 ? sorted[half]! : Math.round((sorted[half - 1]! + sorted[half]!) / 2);
    out.push({ name, usual, low: sorted[0]!, high: sorted[sorted.length - 1]!, count: sorted.length });
  }
  return out.sort((a, b) => b.count - a.count || a.usual - b.usual || a.name.localeCompare(b.name)).slice(0, TOP);
}

/**
 * Each price against today's figure and the rate from tomorrow, in words the
 * model quotes. `today` is what is left to spend today, `after` a day from
 * tomorrow; both from `monthPlan.ts`, so they are the Dashboard's.
 */
export function pricesAgainstDay(
  prices: readonly EverydayPrice[],
  day: { readonly today: Centavos; readonly after: Centavos; readonly daysLeft: number },
  php: (c: Centavos) => string,
): string[] {
  if (prices.length === 0) return [];
  const lines: string[] = [];
  for (const p of prices) {
    const range = p.low === p.high ? "" : `, ${php(p.low)} to ${php(p.high)}`;
    const now =
      day.today <= 0
        ? "Today's figure is used up, so it does not fit today."
        : p.usual <= day.today
          ? `Fits today's ${php(day.today)}, with ${php(day.today - p.usual)} to spare.`
          : `Does not fit today's ${php(day.today)}: it is ${php(p.usual - day.today)} more.`;
    const later =
      day.daysLeft <= 1 || day.after === day.today
        ? ""
        : p.usual <= day.after
          ? ` Fits ${php(day.after)} a day from tomorrow.`
          : ` Does not fit ${php(day.after)} a day from tomorrow: it is ${php(p.usual - day.after)} more.`;
    lines.push(`- ${p.name}: usually ${php(p.usual)} a time (${p.count} times in ${WINDOW_DAYS} days${range}). ${now}${later}`);
  }
  const fits = prices.filter((p) => day.today > 0 && p.usual <= day.today).length;
  lines.push(
    fits === prices.length
      ? `All ${prices.length} fit today's figure one at a time; two or more together may not.`
      : `${fits} of these ${prices.length} fit today's figure.`,
  );
  return lines;
}

/**
 * Whether the day's figure is enough, useful or realistic for what things
 * cost, or what it buys. Adds the prices to the chat's figures; a wrong
 * guess costs a few lines, so it leans towards yes.
 */
const PRICES =
  /\b(?:prices?|pricey|expensive|cheap|food|meals?|lunch|dinner|breakfast|merienda|snacks?|ulam|kain|grocer(?:y|ies)|fare|pamasahe|commute|gas|coffee|drinks?|water)\b/i;
const ENOUGH =
  /\b(?:enough|useful|realistic|reasonable|sapat|kasya|livable|liveable|survive|get by|make it|still (?:use|useful|good|ok|okay|enough|work)|is (?:that|it|this) (?:ok|okay|fine|good|enough|realistic)|what (?:can|does|will) (?:i|it|that|this|\d+(?:\.\d+)?(?:\s*pesos?)?) (?:buy|get|cover)|can (?:it|that|this|\d+(?:\.\d+)?(?:\s*pesos?)?) (?:buy|cover|get))\b/i;
const DAYISH = /\b(?:a day|per day|daily|today|day'?s|safe|allowance)\b|\d+(?:\.\d{1,2})?\s*(?:pesos?|php)\b|(?:php|₱)\s*\d/i;
const AGAINST_DAY = /\b(?:a day|per day|daily|safe|allowance|today'?s (?:figure|share|limit))\b/i;

export function asksWhatTheDayBuys(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (ENOUGH.test(t) && (DAYISH.test(t) || PRICES.test(t))) || (PRICES.test(t) && AGAINST_DAY.test(t));
}

// ── An answer that calls more than a figure within it ──────────────────────

export interface FitSlip {
  /** What the answer said fits. */
  readonly amount: Centavos;
  /** The day's figure it was said to fit. */
  readonly limit: Centavos;
}

/** A claim that something fits: within, under, covered by, affordable. */
/*
 * "Under", "below", "within" only before a figure or a limit: "recorded under
 * entry #3935" and "cash is below the PHP 500 warning" were read as fits,
 * and the answers carried a false "Check this" (13 October 2026).
 */
const FIT =
  /\b(?:(?:within|under|below|inside)\s+(?:the\s+|your\s+|today'?s\s+|tomorrow'?s\s+|that\s+|this\s+|a\s+)?(?=\*|₱|php\b|\d|figure|limit|budget|safe|allowance|daily|day'?s|amount|share)|fits?\b|fitting\b|covers?\b|covered\b|affordable\b|can (?:afford|buy|get|cover)\b|(?:is|are) enough\b|enough (?:for|to)\b|stays? (?:under|within)\b|kasya\b)/i;
/** Any of these and the clause is saying it does not fit, or is hedged. */
const NOT =
  /\b(?:overspend\w*|over-?spending|warning|deficit|burn\w*|not|never|no longer|cannot|exceeds?|exceeding|exceeded|above|beyond|more than|over (?:it|that|this|the|your|today)|shortfall|short|past|outside|too (?:much|expensive|high)|requires?|need(?:s)? (?:to )?sav\w*|saving up|unless|if you)\b|n'?t\b/i;
const TODAY_WORDS = /\b(?:today'?s|for today|today)\b/i;
const TOMORROW_WORDS = /\b(?:from tomorrow|tomorrow'?s|after today)\b/i;
const DAY_WORDS = /\b(?:a day|per day|daily|day'?s|safe[- ]to[- ]spend|safe spend\w*|that (?:limit|amount|figure|allowance)|the limit|allowance)\b/i;

/**
 * Amounts an answer says fit a day's figure they are above.
 *
 * Read clause by clause, so "covers the water, but not the PHP 95.00 meal"
 * is two claims and only the first is a fit. The figure a clause is held to
 * is the day's figure it names, else the one its words point at; a bigger
 * figure in the same clause ("PHP 2,016.01 covers a PHP 95.00 meal") may be
 * what it is measured against, so that clause is left alone.
 */
export function fitSlips(answer: string, day: { readonly today: Centavos; readonly after: Centavos }): FitSlip[] {
  const out: FitSlip[] = [];
  const seen = new Set<Centavos>();
  const dayFigures = new Set([day.today, day.after].filter((f) => f > 0));
  for (const sentence of answer.split(/(?<=[.!?])\s+|\n+/)) {
    for (const clause of sentence.split(/[;:]|,?\s+\b(?:though|but|while|whereas|however|although|except|unless|yet)\b/i)) {
      if (!FIT.test(clause) || NOT.test(clause)) continue;
      const figures = figuresIn(clause).map(Math.abs).filter((f) => f > 0);
      if (figures.length === 0) continue;
      const named = figures.filter((f) => dayFigures.has(f));
      const limit =
        named.length > 0
          ? Math.min(...named)
          : TOMORROW_WORDS.test(clause) && day.after > 0
            ? day.after
            : TODAY_WORDS.test(clause)
              ? day.today
              : DAY_WORDS.test(clause)
                ? Math.max(day.today, day.after)
                : null;
      if (limit === null) continue;
      for (const f of figures) {
        if (f <= limit || dayFigures.has(f) || seen.has(f)) continue;
        if (figures.some((g) => g !== f && g >= f)) continue;
        /*
         * A balance or money moved between accounts is not something bought:
         * "your wallets hold PHP 1,226.51, which covers the PHP 250.00 fee"
         * was flagged as PHP 1,226.51 that does not fit (13 October 2026).
         */
        const at = clause.indexOf(formatPlain(f));
        const before = at > 0 ? clause.slice(Math.max(0, at - 40), at) : "";
        if (/\b(?:hold|holds|holding|balance|wallets?|left|leaves|leaving|remaining|transfer(?:red)?\s+of|withdr\w*\s+of|aside)\b[^.]{0,12}$/i.test(before)) continue;
        // "within the PHP 27,700.00 budget" is the month's plan, not a purchase (13 October 2026, replayed 20 October).
        const after = at >= 0 ? clause.slice(at + formatPlain(f).length, at + formatPlain(f).length + 24) : "";
        if (/^[*\s]*(?:(?:spending|monthly|month'?s|october|november|december|\w+ber)\s+)?(?:budget|plan|limit|allowance)\b/i.test(after)) continue;
        seen.add(f);
        out.push({ amount: f, limit });
      }
    }
  }
  return out;
}

/** The line under an answer with a slip, or "" when every fit it claims holds. */
export function fitNote(answer: string, day: { readonly today: Centavos; readonly after: Centavos }, money: (c: Centavos) => string): string {
  const slips = fitSlips(answer, day);
  if (slips.length === 0) return "";
  return `Check this: ${slips.map((s) => `${money(s.amount)} is ${money(s.amount - s.limit)} more than ${money(s.limit)}`).join(", and ")}, so ${slips.length === 1 ? "it does" : "they do"} not fit that day's figure.`;
}

// ── "Why did you say that?" ────────────────────────────────────────────────

/**
 * The owner questioning an earlier answer: why it was said, how it can be,
 * or that it is wrong. Such a message is about that answer, so it is checked
 * before the reply, and the reply starts by saying whether it was wrong.
 */
const CHALLENGE =
  /\b(?:why (?:did |do |would |are |were )?you (?:say|said|saying|suggest\w*|recommend\w*|tell|told|mention\w*|includ\w*|put|think|thought)|why (?:suggest|say|recommend)\w*|how (?:do|did|can|could|would) you (?:even )?(?:say|buy|suggest|get|think|recommend|call|afford)|(?:that'?s|that is|it'?s|you'?re|you are|this is) (?:wrong|not right|incorrect|mistaken|a mistake|not true)|you (?:said|told me|suggested)|but you said|contradict\w*|(?:does ?n'?t|don'?t) make sense|makes no sense|you made a mistake|mali (?:ka|yan|iyan|yun))\b/i;

export const challengesAnswer = (text: string): boolean => CHALLENGE.test(text);

/**
 * What the app found in the answer being questioned, for the top of the
 * figures, and the fallback said when no model answers.
 */
export function challengeWorked(
  earlier: string,
  day: { readonly today: Centavos; readonly after: Centavos } | null,
  money: (c: Centavos) => string,
): { readonly text: string; readonly fallback?: string } {
  const slips = day ? fitSlips(earlier, day) : [];
  const head = "The owner is questioning your previous answer. Check every claim in it against these figures before you answer.";
  if (slips.length === 0) {
    return {
      text: `${head} If any part of it was wrong, say so in your first sentence, plainly, and give the right statement; then answer what they ask. If it was right, say why in one sentence from the figures. Never explain a wrong claim as if it stood.`,
    };
  }
  const found = slips.map((s) => `it said ${money(s.amount)} fits within ${money(s.limit)}, and it does not: ${money(s.amount)} is ${money(s.amount - s.limit)} more than ${money(s.limit)}`);
  const said = `The earlier answer was wrong: ${found.join("; ")}.`;
  return {
    text: `${head} The app checked it: ${found.join("; ")}. Begin by saying plainly that the earlier answer was wrong and what is right, then answer what they ask. Do not explain the wrong claim as if it stood.`,
    fallback: said,
  };
}

/**
 * Which earlier answer a challenge is about, among the last few (newest
 * first): the one holding a figure the owner names ("you said 65" finds the
 * answer that said PHP 64.29), else the newest one with a slip in it, else
 * the newest. Only the last answer was checked, so "But why you suggested
 * it?", asked after the slip had been owned, defended it (backup of 7
 * October 2026).
 */
export function challengedAnswer(
  question: string,
  answers: readonly string[],
  day: { readonly today: Centavos; readonly after: Centavos } | null,
  money: (c: Centavos) => string,
): { readonly text: string; readonly fallback?: string; readonly index: number } | null {
  const recent = answers.slice(0, 4);
  if (recent.length === 0) return null;
  // Bare figures too ("you said 65"), which the answer reader does not take.
  const named = figuresSaid(question).filter((f) => f >= 100);
  const holds = (answer: string): boolean => {
    const said = figuresIn(answer);
    return named.some((n) => said.some((f) => Math.abs(f - n) <= 200));
  };
  let index = named.length > 0 ? recent.findIndex(holds) : -1;
  if (index < 0) index = day ? recent.findIndex((a) => fitSlips(a, day).length > 0) : -1;
  if (index < 0) index = 0;
  const checked = challengeWorked(recent[index] ?? "", day, money);
  const which = index === 0 ? "" : `The answer being questioned is not the last one but the one ${index + 1} answers back, which began: "${(recent[index] ?? "").slice(0, 160).replace(/\s+/g, " ")}". `;
  return { ...checked, text: `${which}${checked.text}`, index };
}

/** A figure as an answer writes it, without the peso sign: 1,226.51. */
function formatPlain(c: Centavos): string {
  const pesos = Math.floor(Math.abs(c) / 100);
  return `${pesos.toLocaleString("en-US")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
}
