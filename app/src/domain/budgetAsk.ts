/**
 * Setting a budget from the chat.
 *
 * It used to be refused: "Budgets are set on the Budget screen, not here." The
 * owner asked on 2026-09-17 for the assistant to be able to change everything
 * except Settings, and a budget is not a setting. So the chat reads the
 * request, works out the change with the Budget screen's own rules
 * (`budgetLock.ts`: a running month changes freely, a closed month only as a
 * correction with a reason, every change kept in the month's history), and
 * shows it on a card to apply.
 *
 *   "set my budget to 8000"                     spending, this month
 *   "set bills budget for october to 2500"      bills and subscriptions
 *   "limit food to 3000 for the rest of the year"
 *   "same budget as last month"
 */

import { budgetForMonth, budgetForYear } from "./budget";
import { monthLock, revisionSummary, saveLimit, saveTracks, type SaveOutcome } from "./budgetLock";
import type { PlanScope } from "./budgetView";
import { MONTH_NAMES } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { Budgets, IsoDate, ReferenceLists } from "./types";

export type BudgetAsk = (
  | {
      readonly kind: "tracks";
      readonly year: number;
      readonly month: number;
      readonly spending?: Centavos | undefined;
      readonly billsSubs?: Centavos | undefined;
      readonly scope: PlanScope;
    }
  | { readonly kind: "copy"; readonly year: number; readonly month: number; readonly scope: PlanScope }
  | {
      readonly kind: "limit";
      readonly year: number;
      readonly month: number;
      readonly name: string;
      readonly value: Centavos;
      readonly scope: PlanScope;
    }
) & {
  /** The last month of a range ("September to December"), written month by month. */
  readonly toMonth?: number | undefined;
};

const SET = /\b(set|make|change|update|increase|raise|lower|reduce|put|copy|use|same|limit|cap)\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function figure(text: string): Centavos | null {
  const m = /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k)?\b/i.exec(text);
  if (!m?.[1]) return null;
  const [pesos = "0", cents = ""] = m[1].replace(/,/g, "").split(".");
  const value = (Number(pesos) * 100 + Number((cents + "00").slice(0, 2))) * (m[2] ? 1000 : 1);
  return value;
}

/**
 * A month named in words, whole or cut to three letters, and nothing that
 * merely starts like one: "decide" is not December and "separate" is not
 * September, which the first version of this read them as.
 */
const MONTH_TOKEN = String.raw`(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)`;

/** Edits between two short words: letters added, dropped or changed. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}

const LONG_MONTHS = ["january", "february", "august", "september", "october", "november", "december"];

/**
 * The month and verb misspellings that came in, read as the word.
 *
 * "how about add it to sseptember to december" (26 September 2026) was read
 * as December alone, and "chnage the budget last month" as no request at
 * all. A long month name is matched within an edit or two, but only a word
 * that starts with the same letter, so "remember" never becomes December.
 */
export function respell(text: string): string {
  return text
    .replace(/\b(chnage|chnge|cahnge|chane|chage|chang|chaneg)\b/gi, "change")
    .replace(/\b(udpate|updte|upadte|updat)\b/gi, "update")
    .replace(/\b[a-z]{5,11}\b/gi, (word) => {
      const lower = word.toLowerCase();
      if (LONG_MONTHS.includes(lower)) return word;
      const near = LONG_MONTHS.find(
        (m) => m[0] === lower[0] && distance(lower, m) <= (m.length >= 7 && lower.length >= 7 ? 2 : 1),
      );
      return near ?? word;
    });
}

/** "may" the verb, which is not the month: "it may be", "I may need". */
const notTheMonth = (text: string): string =>
  respell(text).replace(/\bmay\b(?=\s+(?:be|have|need|not|also|still|want|help|go|get|use|spend|pay|buy|i|we|you|it|as|want)\b)/gi, "might");

function monthIn(raw: string, asOf: IsoDate): { year: number; month: number } {
  const text = notTheMonth(raw);
  const year = Number(asOf.slice(0, 4));
  const now = Number(asOf.slice(5, 7));
  if (/\bnext month\b/i.test(text)) return now === 12 ? { year: year + 1, month: 1 } : { year, month: now + 1 };
  if (/\blast month\b/i.test(text) && !/\b(same|as|copy|like)\b.*\blast month\b/i.test(text)) {
    return now === 1 ? { year: year - 1, month: 12 } : { year, month: now - 1 };
  }
  const named = new RegExp(String.raw`\b${MONTH_TOKEN}\b(?:\s+(20\d{2}))?`, "i").exec(text.replace(/\blast month\b/gi, " "));
  if (named?.[1]) return { year: named[2] ? Number(named[2]) : year, month: MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1 };
  return { year, month: now };
}

function scopeIn(text: string): PlanScope {
  if (/\b(whole|all|entire)\s+year\b|\bevery month (of|in) \d{4}\b/i.test(text)) return "year";
  if (/\b(rest of the year|from now on|every month|each month|onwards|until december)\b/i.test(text)) return "rest";
  return "month";
}

/** Which months a budget sentence covers. */
export interface BudgetSpan {
  readonly year: number;
  readonly month: number;
  /** The last month of a range, when the sentence named one ("September to December"). */
  readonly toMonth?: number;
  readonly scope: PlanScope;
  /**
   * Whether the sentence itself said when it starts. "make it long term" does
   * not, so a card it moves keeps its own first month rather than jumping to
   * this one.
   */
  readonly anchored?: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const MONTH_WORD = MONTH_TOKEN;

/**
 * The months a sentence means, when it means more than one or names any.
 *
 * ── Why spans ─────────────────────────────────────────────────────────────
 *
 * The owner, 26 September 2026, after a budget card for October: "how about
 * add it to september to december", and then "in applying budget it should
 * know even if like long term". The reader knew one month, "the rest of the
 * year" and "the whole year", and a range was read as nothing at all, so the
 * sentence fell to the entry reader. It reads these now:
 *
 *   "september to december", "from oct until dec", "oct-dec"    a range
 *   "for the next 3 months", "for three months"                a count
 *   "long term", "from now on", "every month", "for good"      to December
 *   "the whole year", "all of 2026"                            the year
 *
 * Null when the sentence names no month and no span, so the caller can tell
 * "for October" from saying nothing about when.
 */
export function spanIn(said: string, asOf: IsoDate): BudgetSpan | null {
  const text = notTheMonth(said).toLowerCase();
  const year = Number(asOf.slice(0, 4));
  const now = Number(asOf.slice(5, 7));
  const monthNumber = (word: string): number => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;

  const range = new RegExp(String.raw`\b${MONTH_WORD}\b(?:\s+(20\d{2}))?\s*(?:to|until|till|through|thru|up to|[-\u2010-\u2015])\s*\b${MONTH_WORD}\b`, "i").exec(text);
  if (range?.[1] && range[3]) {
    const from = monthNumber(range[1]);
    const to = monthNumber(range[3]);
    const inYear = range[2] ? Number(range[2]) : year;
    // A range that runs past December stops at December: a budget belongs to its year.
    return to > from ? { year: inYear, month: from, toMonth: to, scope: "month", anchored: true } : { year: inYear, month: from, scope: "rest", anchored: true };
  }

  if (/\b(whole|all|entire)\s+year\b|\ball of 20\d{2}\b|\bevery month (of|in) 20\d{2}\b/.test(text)) {
    return { year, month: 1, scope: "year", anchored: true };
  }

  const start = (): { year: number; month: number } => monthIn(said, asOf);
  const anchored = new RegExp(String.raw`\b${MONTH_WORD}\b|\b(this|next|last) month\b`, "i").test(text);

  const count = /\b(?:for\s+)?(?:the\s+)?(next|coming|following)?\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?\b/.exec(text);
  if (count?.[2]) {
    const n = NUMBER_WORDS[count[2]] ?? Number(count[2]);
    if (n >= 1 && n <= 12) {
      const first = count[1] ? (now === 12 ? { year: year + 1, month: 1 } : { year, month: now + 1 }) : start();
      const last = Math.min(12, first.month + n - 1);
      const isAnchored = Boolean(count[1]) || anchored;
      return last > first.month ? { ...first, toMonth: last, scope: "month", anchored: isAnchored } : { ...first, scope: "month", anchored: isAnchored };
    }
  }

  // "from october on", "starting october": that month and every one after it.
  if (new RegExp(String.raw`\b(?:from|starting|beginning)\s+(?:in\s+)?${MONTH_WORD}\b(?:\s+on(?:wards?)?\b)?`, "i").test(text) && !/\b(?:to|until|till|through)\b/.test(text)) {
    return { ...start(), scope: "rest", anchored: true };
  }

  if (/\b(long[- ]?term|from now on|onwards?|moving forward|going forward|for good|permanently|every month|each month|monthly from now|rest of (?:the )?year|until december|till december|to december|all (?:the )?(?:remaining|coming|next) months)\b/.test(text)) {
    return { ...start(), scope: "rest", anchored };
  }

  if (anchored) {
    return { ...start(), scope: "month", anchored: true };
  }
  return null;
}

/**
 * A budget command that names no figure of its own.
 *
 * ── The conversation this comes from, 21 September 2026 ────────────────────
 *
 *   "so based on my spending and current balance what do you propose??"
 *   ... a budget is proposed ...
 *   "ok thanks. can you add those to my budget?"
 *   "Yes, the entries will be added to your budget."
 *   "so is it added?"
 *   "Yes, the app will add those budget entries when you press the button."
 *   "the budget still not change"
 *
 * `readBudgetAsk` wants a figure and the sentence has none, because the
 * figure is in the answer above it, which is how anyone would say this. So
 * it returned null, no card was made, and the model filled the silence with
 * a yes.
 *
 * This is the first half of the gate, without the figure: enough to know
 * the owner is asking for the budget to change, so the app can go and look
 * for the figure rather than saying nothing.
 */
export function namesBudgetCommand(said: string): boolean {
  const text = respell(said).replace(/\b(buget|budjet|bugdet|budgt|budet|bujet|budgets?)\b/gi, "budget");
  if (!/\b(budget|limit|cap)\b/i.test(text)) return false;

  /*
   * Asking for advice about the budget is not asking for it to change.
   * "should I raise my budget?" wants an answer; "can you set my budget?"
   * wants a card. The verbs of degree, raise and lower and increase, are
   * left out on purpose: they nearly always come with a figure, which
   * `readBudgetAsk` already handles, and without one they are usually a
   * question about whether to.
   */
  if (/\b(should|shall|would|might|worth it|do you think|is it|are you able)\b/i.test(text)) return false;

  return /\b(add|set|change|update|copy|make|put|apply|use|same)\b/i.test(text);
}

/**
 * A short yes to whatever was just proposed: "ok add it", "yes apply that".
 *
 * On 26 September 2026 the answer above was "PHP 41,694.36 is the
 * recommended budget for next month", the owner said "ok add it", and the
 * chat replied "I could not find an entry in that" and asked how much it
 * was. The sentence never says "budget", because it did not need to: the
 * thing to add was the last thing said. This is only half the gate. The
 * caller also needs the answer above it to have proposed a budget, so a yes
 * after anything else is left alone.
 */
export function confirmsProposal(said: string): boolean {
  const text = said.trim().toLowerCase().replace(/[.!?,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /\d/.test(text) || text.split(" ").length > 7) return false;
  if (/\b(no|not|don'?t|dont|never|wait|stop|cancel|hindi|huwag|wag)\b/.test(text)) return false;
  return /^(?:(?:ok(?:ay)?|yes|yeah|yep|sure|sige|oo|go|please|pls|then|now|so|alright|fine)\s+)*(?:(?:please|pls)\s+)?(?:add|set|apply|use|do|save|put|make)\s+(?:it|that|this|those|them|the\s+budget|that\s+one)(?:\s+(?:please|pls|now|in|then|for\s+me|to\s+my\s+budget))*$|^(?:yes|yeah|yep|sige|oo|go\s+ahead|do\s+it)(?:\s+(?:please|pls|go\s+ahead|do\s+it))*$/.test(text);
}

/**
 * The budget an answer proposed, when it named one.
 *
 * Only a figure the sentence itself calls a budget. An answer about the
 * month is full of figures, the overage and the daily rate and last month's
 * total, and picking the first of them would set a budget to a number
 * nobody proposed. "a budget of PHP 53,710.80 for next month" says which
 * one it means, and nothing else here counts.
 */
export function proposedBudgetIn(text: string): Centavos | null {
  return proposalIn(text)?.value ?? null;
}

/**
 * The month a proposal is for, when the sentence that proposes it names one.
 *
 * "I recommend a budget of PHP 9,000.00 for October 2026" was applied to the
 * running month, because only "next month" was looked for. Read from the
 * proposing sentence alone, so a month the answer mentions elsewhere ("you
 * spent this in September") is not taken for it.
 */
export function proposedMonthIn(text: string, asOf: IsoDate): BudgetSpan | null {
  const found = proposalIn(text);
  return found?.sentence ? spanIn(found.sentence, asOf) : null;
}

function proposalIn(text: string): { readonly value: Centavos; readonly sentence: string } | null {
  const MONEY = String.raw`(?:₱|php\s*)?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|(?:₱|php\s*)\d+(?:\.\d{1,2})?`;

  /*
   * By sentence first: the sentence that recommends, and the first figure in
   * it that is not about what already happened.
   *
   * "Recommended budget next month is PHP 8,814.58, based on the August 2026
   * spending total. September was over by PHP 33,494.36 against a PHP 7,700
   * budget" (26 September 2026). The patterns below read "a PHP 7,700
   * budget" from the second sentence, and "add it" made a card for PHP
   * 7,700.00. The recommendation is the sentence that says it recommends;
   * a figure after "over by", "spent" or "against" in it is context, not the
   * proposal. Strong words first across the whole answer ("recommend",
   * "suggest"), then the weaker "a budget of", so an answer that mentions
   * the old budget before recommending a new one still reads the new one.
   */
  const plain = text.replace(/\*\*|__/g, "");
  const sentences = plain.split(/(?<=[.!?])\s+|\n+/);
  const STRONG = /\b(recommend(?:ed|s|ation)?|suggest(?:ed|s|ion)?|propos(?:e|ed|al)|should set|would set|i'?d set|aim for|realistic|reasonable|sensible)\b/i;
  const WEAK = /\bbudget\s+(?:of|for next month|next month)\b|\bnext month'?s budget\b/i;
  const PAST = /(over|exceeded|short|deficit|shortfall|spent|against|was|were|used|already)[^.]{0,18}$/i;
  const money = new RegExp(MONEY, "gi");
  for (const cue of [STRONG, WEAK]) {
    for (const sentence of sentences) {
      if (!cue.test(sentence)) continue;
      for (const m of sentence.matchAll(money)) {
        const before = sentence.slice(Math.max(0, (m.index ?? 0) - 28), m.index ?? 0);
        if (PAST.test(before)) continue;
        const value = figure(m[0]);
        if (value !== null && value > 0) return { value, sentence };
      }
    }
  }

  // The bold markers are optional: the model uses them sometimes and not others.
  const B = String.raw`\*{0,2}`;
  /*
   * The recommending words first, because they are the proposal. "PHP
   * 41,694.36 is the recommended budget for next month" was the answer on
   * 26 September 2026, and neither pattern below it read that: a word stood
   * between the figure and "budget". Read first, they also win over an
   * earlier figure the answer merely mentions ("your budget of PHP 7,700.00
   * was exceeded... the recommended budget is PHP 9,000.00").
   */
  const PROPOSING = String.raw`(?:recommended|suggested|proposed|realistic|reasonable|sensible|new|better)`;
  const patterns = [
    new RegExp(String.raw`${B}(${MONEY})${B}\s+(?:is|would\s+be|as)\s+(?:a|the|your|my)?\s*${PROPOSING}\s+(?:monthly\s+)?budget`, "i"),
    new RegExp(String.raw`${PROPOSING}\s+(?:monthly\s+)?budget(?:\s+for\s+(?:next|the\s+next|this|each)\s+month)?\s*(?:of|is|at|to|would\s+be|:)?\s*${B}(${MONEY})`, "i"),
    new RegExp(String.raw`(?:recommend|suggest|propose)\s+(?:a\s+|the\s+)?(?:monthly\s+)?(?:budget\s+(?:of\s+)?)?${B}(${MONEY})`, "i"),
    new RegExp(String.raw`budget(?:\s+of)?\s+(?:is\s+|at\s+|to\s+|would\s+be\s+)?${B}(${MONEY})`, "i"),
    new RegExp(String.raw`${B}(${MONEY})${B}\s+(?:a\s+month\s+|for\s+next\s+month\s+|per\s+month\s+)?(?:as\s+(?:a|the|your)\s+)?budget`, "i"),
  ];

  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found?.[1]) {
      const value = figure(found[1]);
      if (value !== null && value > 0) return { value, sentence: sentences.find((x) => x.includes(found[1]!.replace(/\*/g, ""))) ?? "" };
    }
  }
  return null;
}

/** Read a budget request, or return null when the sentence is not one. */
export function readBudgetAsk(said: string, reference: ReferenceLists, asOf: IsoDate): BudgetAsk | null {
  // "add buget same as last month": the misspellings that came in, read as the word.
  const text = respell(said).replace(/\b(buget|budjet|bugdet|budgt|budet|bujet|budgets?)\b/gi, "budget");
  if (!/\b(budget|limit|cap)\b/i.test(text) || !(SET.test(text) || /\badd\b/i.test(text))) return null;
  const span = spanIn(text, asOf);
  const { year, month } = span ?? monthIn(text, asOf);
  const scope = span?.scope ?? scopeIn(text);
  const toMonth = span?.toMonth;

  if (/\b(same|copy|use)\b.*\b(as|from)?\s*last month('?s)?\b/i.test(text) && !/\d/.test(text.replace(/20\d{2}/g, ""))) {
    return { kind: "copy", year, month, scope, ...(toMonth ? { toMonth } : {}) };
  }

  const kinds = [...reference.spendingTypes.map((t) => t.name)].sort((a, b) => b.length - a.length);
  const flat = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const kind = kinds.find((k) => flat.includes(` ${k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `));
  // Dates and counts of months are not the figure: "for the next 3 months" is not PHP 3.00.
  const withoutDates = text
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\s+months?\b/gi, " ")
    .replace(new RegExp(String.raw`\b${MONTH_TOKEN}\s+\d{1,2}\b`, "gi"), " ");
  const value = figure(withoutDates);

  if (/\b(limit|cap)\b/i.test(text) && kind) {
    if (value === null && !/\b(remove|clear|no limit|delete)\b/i.test(text)) return null;
    return { kind: "limit", year, month, name: kind, value: value ?? 0, scope, ...(toMonth ? { toMonth } : {}) };
  }
  if (value === null) return null;
  if (/\b(bills?|subscriptions?|subs)\b/i.test(text)) return { kind: "tracks", year, month, billsSubs: value, scope, ...(toMonth ? { toMonth } : {}) };
  return { kind: "tracks", year, month, spending: value, scope, ...(toMonth ? { toMonth } : {}) };
}

export interface BudgetPlan {
  readonly year: number;
  readonly outcome: SaveOutcome;
  /** What it would do, in a sentence. */
  readonly words: string;
  /** One line per month it would change, for the activity trail. */
  readonly changes: readonly string[];
}

/** The change, worked out with the Budget screen's own rules. Nothing is saved. */
export function planBudget(ask: BudgetAsk, budgets: Budgets, asOf: IsoDate, at: string): BudgetPlan {
  const plan = budgetForYear(budgets, ask.year);
  const name = `${MONTH_NAMES[ask.month - 1] ?? ""} ${ask.year}`;

  /*
   * A span that starts in a month already closed, or runs over several, is
   * written month by month: the closed ones are left as they were and said
   * so (rule B6), and the rest take the change. Through `saveTracks` with
   * "rest", a closed first month refused the whole change instead, so "from
   * August on" in late September changed nothing at all.
   */
  const firstClosed = monthLock(ask.year, ask.month, asOf).state === "closed";
  const last = ask.toMonth && ask.toMonth > ask.month ? ask.toMonth : ask.scope === "rest" && firstClosed ? 12 : null;
  if (last !== null) return planRange(ask, budgets, plan, last, asOf, at);

  const span = ask.scope === "month" ? name : ask.scope === "rest" ? `${name} to December` : `every month of ${ask.year} still ahead`;
  let outcome: SaveOutcome;
  let words: string;

  if (ask.kind === "limit") {
    outcome = saveLimit(plan, ask.year, ask.month, ask.name, ask.value, ask.scope, asOf, at);
    words = ask.value > 0 ? `${ask.name} limited to ${formatMoney(ask.value)} a month, ${span}.` : `The limit on ${ask.name} removed, ${span}.`;
  } else {
    const current = budgetForMonth(budgets, ask.year, ask.month);
    const value = valueFor(ask, budgets, ask.month);
    outcome = saveTracks(plan, ask.year, ask.month, value, ask.scope, asOf, at);
    words =
      ask.kind === "copy"
        ? `${span}: the same budget as the month before, ${formatMoney(value.spending)} for spending and ${formatMoney(value.billsSubs)} for bills and subscriptions.`
        : `${span}: ${formatMoney(value.spending)} for spending and ${formatMoney(value.billsSubs)} for bills and subscriptions, was ${formatMoney(
            current.spending,
          )} and ${formatMoney(current.billsSubs)}.`;
  }

  const changes = outcome.revisions.map((r, i) => revisionSummary(ask.year, outcome.written[i] ?? ask.month, r));
  return { year: ask.year, outcome, words, changes };
}

/** The two tracks one month would take under this ask. */
function valueFor(ask: BudgetAsk, budgets: Budgets, month: number): { spending: Centavos; billsSubs: Centavos } {
  const current = budgetForMonth(budgets, ask.year, month);
  if (ask.kind === "copy") {
    const prevYear = ask.month === 1 ? ask.year - 1 : ask.year;
    const prevMonth = ask.month === 1 ? 12 : ask.month - 1;
    return budgetForMonth(budgets, prevYear, prevMonth);
  }
  if (ask.kind === "tracks") return { spending: ask.spending ?? current.spending, billsSubs: ask.billsSubs ?? current.billsSubs };
  return current;
}

/** "September to December": each month on its own, closed ones left alone. */
function planRange(ask: BudgetAsk, budgets: Budgets, start: ReturnType<typeof budgetForYear>, last: number, asOf: IsoDate, at: string): BudgetPlan {
  let plan = start;
  const written: number[] = [];
  const skipped: number[] = [];
  const revisions: SaveOutcome["revisions"][number][] = [];

  for (let m = ask.month; m <= last; m += 1) {
    if (monthLock(ask.year, m, asOf).state === "closed") {
      skipped.push(m);
      continue;
    }
    const out =
      ask.kind === "limit"
        ? saveLimit(plan, ask.year, m, ask.name, ask.value, "month", asOf, at)
        : saveTracks(plan, ask.year, m, valueFor(ask, budgets, m), "month", asOf, at);
    if (out.refused) {
      skipped.push(m);
      continue;
    }
    plan = out.plan;
    written.push(...out.written);
    revisions.push(...out.revisions);
  }

  const from = MONTH_NAMES[ask.month - 1] ?? "";
  const to = MONTH_NAMES[last - 1] ?? "";
  const span = `${from} to ${to} ${ask.year}`;
  const value = valueFor(ask, budgets, ask.month);
  const words =
    ask.kind === "limit"
      ? ask.value > 0
        ? `${ask.name} limited to ${formatMoney(ask.value)} a month, ${span}.`
        : `The limit on ${ask.name} removed, ${span}.`
      : ask.kind === "copy"
        ? `${span}: the same budget as ${MONTH_NAMES[(ask.month + 10) % 12] ?? "the month before"}, ${formatMoney(value.spending)} for spending and ${formatMoney(value.billsSubs)} for bills and subscriptions each month.`
        : `${span}: ${formatMoney(value.spending)} for spending and ${formatMoney(value.billsSubs)} for bills and subscriptions each month.`;
  const allClosed = written.length === 0 && skipped.length > 0 && skipped.every((m) => monthLock(ask.year, m, asOf).state === "closed");
  const outcome: SaveOutcome = {
    plan,
    written,
    skipped,
    revisions,
    ...(allClosed ? { refused: `Every month from ${from} to ${to} ${ask.year} is closed. Closed months are corrected one at a time on the Budget screen, with a reason.` } : {}),
  };
  const changes = revisions.map((r, i) => revisionSummary(ask.year, written[i] ?? ask.month, r));
  return { year: ask.year, outcome, words, changes };
}

/**
 * A figure of money in a message, once its dates are gone.
 *
 * Years, days of a month ("September 13", "13 Sept", "9/13") and counts of
 * months ("for 3 months") are taken out first; any number left counts. It
 * needed three digits, so "the amount is 4.25" read as no figure at all, and
 * a sentence about cash back became a budget change (26 September 2026).
 */
export function namesMoneyFigure(text: string): boolean {
  const left = text
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\s+months?\b/gi, " ")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b/gi, " ")
    .replace(/\b\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ");
  return /(?:₱|php\s*)?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s*k\b/i.test(left);
}

/**
 * Money moving, in the owner's words: an entry or a question about one,
 * never a budget. Received, paid, spent, bought, cash back, sent, a
 * withdrawal, a reimbursement, a loan.
 */
export function saysMoneyMoved(text: string): boolean {
  return /\b(re?cei?e?ve?d?|recieved|got|paid|pay|spent|spend|bought|buy|purchased?|cash ?back|sent|send|transferr?ed|withdr[ae]w\w*|deposit\w*|earned|salary|allowance|reimburs\w*|refund\w*|borrowed|lent|loan)\b/i.test(
    text,
  );
}

