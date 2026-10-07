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
import { limitable } from "./kinds";
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
      /** The figures are changes to what is set ("raise spending by 1000"), signed, not the new amounts. */
      readonly by?: boolean | undefined;
    }
  | { readonly kind: "copy"; readonly year: number; readonly month: number; readonly scope: PlanScope }
  | {
      readonly kind: "limit";
      readonly year: number;
      readonly month: number;
      readonly name: string;
      readonly value: Centavos;
      readonly scope: PlanScope;
      /** The figure is a change to the limit set ("raise my food limit by 500"), signed, not the new limit. */
      readonly by?: boolean | undefined;
    }
) & {
  /** The last month of a range ("September to December"), written month by month. */
  readonly toMonth?: number | undefined;
};

const SET = /\b(set|make|change|update|increase|raise|lower|reduce|put|copy|use|same|limit|cap|save|apply|adjust|edit|modify|fix|allocate|assign|decrease|cut)\b/i;

const NUM = String.raw`(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(\s*k\b)?`;
const BILLS_LABEL = String.raw`(?:bills?(?:\s*(?:and|&|\/|\+|n)\s*subs(?:criptions?)?)?|subscriptions?|subs)`;
const SPENDING_LABEL = String.raw`(?:spending|spend|expenses?|day[- ]to[- ]day)`;

const pesosOf = (digits: string, k: string | undefined): Centavos => {
  const [whole = "0", cents = ""] = digits.replace(/,/g, "").split(".");
  return (Number(whole) * 100 + Number((cents + "00").slice(0, 2))) * (k ? 1000 : 1);
};

/**
 * The two budget lines in one message, each with its own figure.
 *
 * 28 September 2026: "Set October's bills and subscriptions budget to
 * ₱1,641 and spending budget to ₱6,359" made a card with the bills figure
 * and PHP 0.00 for spending, because one figure was read per sentence and
 * the word "bills" decided which line it went to. And the same two lines
 * typed as a form, "Bills and subscriptions: 1641 / Spending: 6359 / Save
 * to: Oct only", has no word "budget" in it and became a PHP 1,641.00
 * spending entry. Each line is read with the figure beside it, either way
 * round ("1641 for bills", "bills: 1641").
 */
export function tracksIn(said: string): { spending?: Centavos; billsSubs?: Centavos } {
  const text = said.toLowerCase().replace(/\b20\d{2}\b/g, " ").replace(/\b\d{1,2}\s+months?\b/g, " ");
  const read = (label: string): Centavos | undefined => {
    const before = new RegExp(String.raw`${NUM}\s*(?:pesos?\s*)?(?:for|on|to|sa|as|in|of)\s+(?:the\s+|my\s+|ang\s+)?${label}\b`).exec(text);
    if (before?.[1]) return pesosOf(before[1], before[2]);
    const after = new RegExp(String.raw`\b${label}\b(?:\s+budget)?[^\d\n]{0,28}?${NUM}`).exec(text);
    if (after?.[1]) return pesosOf(after[1], after[2]);
    return undefined;
  };
  const billsSubs = read(BILLS_LABEL);
  // "bills and subscriptions spending" is one label, not both.
  const spending = read(SPENDING_LABEL);
  return { ...(spending !== undefined ? { spending } : {}), ...(billsSubs !== undefined ? { billsSubs } : {}) };
}

/** Both lines with a figure each, laid out like a form: a budget, whether or not it says so. */
export function isBudgetForm(said: string): boolean {
  const t = tracksIn(said);
  return t.spending !== undefined && t.billsSubs !== undefined && !/\b(paid|spent|bought|bayad|received)\b/i.test(said);
}
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

/**
 * "may" the verb, which is not the month: "it may be", "you may cover it".
 *
 * The month only where a month is meant: after "in", "for", "next" and the
 * like, before a year or a day, or in a range. 5 October 2026, an answer's
 * "you may ..." put a budget change on May 2027.
 */
/** "may" the verb read as "might", so only May the month is a month (also `budgetAdvice.ts`, `adviceMonthIn`). */
export const notTheMonth = (text: string): string =>
  respell(text).replace(/\bmay\b/gi, (word, at: number, whole: string) => {
    const before = whole.slice(Math.max(0, at - 12), at).toLowerCase();
    const after = whole.slice(at + word.length, at + word.length + 14).toLowerCase();
    const isMonth =
      /\b(?:in|for|of|this|next|last|until|till|to|from|by|since|on|during|before|after|thru|through|and|or|early|late|mid|end of)\s+$|[,(-]\s*$/.test(before) ||
      /^\s*(?:\d|20\d{2}|to\b|until\b|till\b|[-\u2010-\u2015]|onwards?\b|budget\b|spending\b|bills?\b)/.test(after) ||
      /^\s*$/.test(after);
    return isMonth ? word : "might";
  });

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

const SCOPE_WORDS = /\b(whole|all|entire)\s+year\b|\bevery month (of|in) \d{4}\b|\b(rest of the year|from now on|every month|each month|onwards|until december)\b/i;

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
    /*
     * "until december" names where it ends, not where it starts: read as the
     * month, it set December only (7 October 2026 limits audit). From this
     * month, unless another month is named as the start.
     */
    const others = text.replace(/\b(?:until|till|to)\s+december\b/g, " ");
    if (others !== text && !new RegExp(String.raw`\b${MONTH_WORD}\b|\b(this|next) month\b`, "i").test(others)) {
      return { year, month: now, scope: "rest", anchored: true };
    }
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
/**
 * Asking what to do, not saying to do it.
 *
 * "should I set my budget to 9000?" named a verb, the word budget and a
 * figure, and would have made a card: a question read as a command. It is
 * the model's to answer. A polite command ("can you set my budget to 9000",
 * "please set it") is still a command.
 */
export function asksRatherThanTells(said: string): boolean {
  const t = said.toLowerCase();
  const polite = /\b(?:can|could|would|will) you\b|\bplease\b|\bpls\b|\bkindly\b|\bpaki/.test(t);
  const opinion =
    /\b(?:should i|should we|shall i|what if|would it be|is it (?:good|ok|okay|wise|better|enough|realistic|smart|too)|is that (?:good|ok|okay|enough|realistic)|do you think|good idea|too (?:much|little|low|high)|worth it|makes sense|wise to|dapat ba|pwede ba|how (?:can|could|should|do|would) i|(?:this is a |it'?s a |a )?question)\b/.test(t) ||
    // "if I received my salary ... how can I budget it": what if, not what to set (2 October 2026).
    /^\s*(?:if|kung)\s+(?:i|ako)\b/.test(t);
  return opinion && !polite;
}

/**
 * What a "limit X to ..." sentence limits, when it is not a kind a limit can
 * count.
 *
 * 7 October 2026 limits audit: "limit money send to 500" and "limit grab to
 * 500" became a card setting the whole spending budget to PHP 500.00, since
 * only the kinds on Settings' list were known; "limit subscriptions to 500"
 * made a limit no row could ever reach, since subscriptions are not filed as
 * a kind of spending. "structural" names a track (subscriptions, bills),
 * "unknown" a kind with no rows and no list entry.
 */
export function limitTalk(said: string, kinds: readonly string[]): { readonly kind: "structural" | "unknown"; readonly name: string } | null {
  const m = /\b(?:limit|cap)\s+(?:on\s+|for\s+)?(?:my\s+|the\s+|ang\s+)?([a-z][a-z' ]{0,30}?)\s+(?:to|at|of|=)\s/i.exec(` ${respell(said)} `);
  const target = m?.[1]?.trim() ?? "";
  if (!target || /^(?:spending|spend|budget|my budget|the budget|spending budget|monthly|month|overall|total|it|that|this)$/i.test(target)) return null;
  if (/^(?:bills?|subscriptions?|subs|bills and subscriptions)$/i.test(target)) return { kind: "structural", name: target };
  const norm = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (kinds.some((k) => norm(k) === norm(target))) return null;
  return { kind: "unknown", name: target };
}

/** Kinds a limit can be set on: the list, the two transfer kinds, and any kind already limited. */
export function limitKinds(reference: Pick<ReferenceLists, "spendingTypes">, known: readonly string[] = []): string[] {
  const all = [...reference.spendingTypes.map((t) => t.name), "Money Send", "Transaction Fee", ...known];
  return [...new Set(all.map((k) => k.trim()).filter((k) => k && limitable(k)))];
}

export function readBudgetAsk(said: string, reference: ReferenceLists, asOf: IsoDate, known: readonly string[] = []): BudgetAsk | null {
  if (asksRatherThanTells(said)) return null;
  // "add buget same as last month": the misspellings that came in, read as the word.
  const text = respell(said).replace(/\b(buget|budjet|bugdet|budgt|budet|bujet|budgets?)\b/gi, "budget");
  const form = isBudgetForm(text);
  const labelled = tracksIn(text);
  const namesLine = labelled.spending !== undefined || labelled.billsSubs !== undefined;
  if (!form && (!/\b(budget|limit|cap)\b/i.test(text) || !(SET.test(text) || /\badd\b/i.test(text) || (namesLine && /\bbudget\b/i.test(text))))) return null;
  const span = spanIn(text, asOf);
  const { year, month } = span ?? monthIn(text, asOf);
  const scope = span?.scope ?? scopeIn(text);
  const toMonth = span?.toMonth;

  if (/\b(same|copy|use)\b.*\b(as|from)?\s*last month('?s)?\b/i.test(text) && !/\d/.test(text.replace(/20\d{2}/g, ""))) {
    return { kind: "copy", year, month, scope, ...(toMonth ? { toMonth } : {}) };
  }

  const kinds = limitKinds(reference, known).sort((a, b) => b.length - a.length);
  const flat = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const wordsOf = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // "foods", "transaction fees": a plural is the kind (7 October 2026 limits audit).
  const kind = kinds.find((k) => [` ${wordsOf(k)} `, ` ${wordsOf(k)}s `, ` ${wordsOf(k)}es `].some((w) => flat.includes(w)));
  // A limit on something no kind is called never becomes a change to the whole spending budget.
  if (/\b(limit|cap)\b/i.test(text) && !kind && limitTalk(text, kinds) !== null) return null;
  /*
   * Dates and counts of months are not the figure: "for the next 3 months"
   * is not PHP 3.00. A year is a year beside a month or after in, of or for;
   * after "to", "at", "a" or "limit" it is money, so "limit food to 2000" is
   * PHP 2,000.00 and not the year (7 October 2026 limits audit).
   */
  const withoutDates = text
    .replace(/\b20\d{2}\b/g, (y: string, at: number, whole: string) => {
      const before = whole.slice(Math.max(0, at - 14), at);
      const money = /(?:\bto|\bat|\ba|₱|\bphp|\blimit(?: of)?|\bcap(?: of)?|\bbudget(?: of)?|\bby)\s*$/i.test(before);
      const dated = new RegExp(String.raw`\b${MONTH_TOKEN}\s*$`, "i").test(before);
      return money && !dated ? y : " ";
    })
    .replace(/\b\d{1,2}\s+months?\b/gi, " ")
    .replace(new RegExp(String.raw`\b${MONTH_TOKEN}\s+\d{1,2}\b`, "gi"), " ");
  const value = figure(withoutDates);
  // "raise spending by 1000", "cut bills by 200": a change to what is there, not a new figure.
  const by = /\bby\s+(?:₱|php\s*)?\d/i.test(text) ? (/\b(lower|reduce|cut|decrease|less|minus|bawas)\w*/i.test(text) ? -1 : /\b(increase|raise|add|more|plus|dagdag)\w*/i.test(text) ? 1 : 0) : 0;
  /*
   * "set food budget to 3000" is a limit on Food: it replaced the month's
   * whole spending budget with PHP 3,000.00 (7 October 2026 limits audit).
   */
  const kindWords = kind ? wordsOf(kind) : "";
  const kindBudget =
    kind !== undefined &&
    !/\b(spending|bills?|subscriptions?)\s+budget\b/i.test(text) &&
    (flat.includes(` ${kindWords} budget `) || flat.includes(` ${kindWords}s budget `) || new RegExp(String.raw`\bbudget (?:for|on|of|sa) (?:my |the )?${kindWords}\b`).test(flat));

  if ((/\b(limit|cap)\b/i.test(text) || kindBudget) && kind) {
    // A question about a limit is answered, never made into a card: "did I go over my 3000 food limit?"
    const polite = /\b(?:can|could|would|will) you\b|\bplease\b|\bpls\b/i.test(said);
    if ((/\?\s*$/.test(said) || /^\s*(?:did|am|is|are|was|were|how|what|do|does|have|has|why|when|which)\b/i.test(said)) && !polite) return null;
    // Remove means remove, whatever figure the sentence also names: "remove the 3000 limit on food".
    const removing = /\b(remove|clear|no limit|delete|take off|drop)\b/i.test(text);
    if (value === null && !removing) return null;
    /*
     * With no months said, a limit is set, or taken off, from this month to
     * December, as the Budget screen does. "remove the food limit" cleared
     * October only and the limit came back on 1 November (7 October 2026
     * limits audit).
     */
    const saidScope = span?.scope ?? (/\b(?:this month|only|just)\b/i.test(text) ? "month" : SCOPE_WORDS.test(text) ? scopeIn(text) : null);
    const limitScope: PlanScope = saidScope ?? (month < 12 ? "rest" : "month");
    const amount = removing ? 0 : (value ?? 0);
    return {
      kind: "limit",
      year,
      month,
      name: kind,
      value: by !== 0 && !removing ? by * amount : amount,
      scope: limitScope,
      ...(by !== 0 && !removing ? { by: true } : {}),
      ...(toMonth ? { toMonth } : {}),
    };
  }
  if (namesLine) {
    const sign = (c: Centavos | undefined): Centavos | undefined => (c === undefined ? undefined : by < 0 ? -c : c);
    return {
      kind: "tracks",
      year,
      month,
      ...(labelled.spending !== undefined ? { spending: by !== 0 ? sign(labelled.spending) : labelled.spending } : {}),
      ...(labelled.billsSubs !== undefined ? { billsSubs: by !== 0 ? sign(labelled.billsSubs) : labelled.billsSubs } : {}),
      ...(by !== 0 ? { by: true } : {}),
      scope,
      ...(toMonth ? { toMonth } : {}),
    };
  }
  if (value === null) return null;
  if (/\b(bills?|subscriptions?|subs)\b/i.test(text)) return { kind: "tracks", year, month, billsSubs: by < 0 ? -value : value, ...(by !== 0 ? { by: true } : {}), scope, ...(toMonth ? { toMonth } : {}) };
  return { kind: "tracks", year, month, spending: by < 0 ? -value : value, ...(by !== 0 ? { by: true } : {}), scope, ...(toMonth ? { toMonth } : {}) };
}

/** The figures typed on a budget card, a month. */
export type CardFigures = { readonly spending: Centavos; readonly billsSubs: Centavos } | { readonly limit: Centavos };

/**
 * The ask a budget card is planned from, with the owner's own figures in it.
 *
 * 3 October 2026, of a card the assistant made: "make sure it's editable
 * too". The months and their span stay as asked; the figures are the ones
 * typed, as amounts, never as changes to what is set. A limit card keeps
 * its kind of spending and takes the new limit.
 */
export function editedAsk(ask: BudgetAsk, figures: CardFigures): BudgetAsk {
  const span = { year: ask.year, month: ask.month, scope: ask.scope, ...(ask.toMonth ? { toMonth: ask.toMonth } : {}) };
  if ("limit" in figures) {
    // A typed figure is the new limit, not a change to it.
    if (ask.kind !== "limit") return ask;
    const { by: _change, ...rest } = ask;
    return { ...rest, value: Math.max(0, figures.limit) };
  }
  return { kind: "tracks", ...span, spending: Math.max(0, figures.spending), billsSubs: Math.max(0, figures.billsSubs) };
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
    // "raise my food limit by 500": the limit set, moved by the figure, never below nothing.
    const was = plan.categories?.[ask.name]?.[ask.month - 1] ?? 0;
    const value = ask.by ? Math.max(0, was + ask.value) : ask.value;
    outcome = saveLimit(plan, ask.year, ask.month, ask.name, value, ask.scope, asOf, at);
    words =
      value > 0
        ? `${ask.name} limited to ${formatMoney(value)} a month${ask.by ? `, was ${formatMoney(was)}` : ""}, ${span}.`
        : `The limit on ${ask.name} removed, ${span}.`;
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
  if (ask.kind === "tracks" && ask.by) {
    // A change to what each month already has, never below nothing.
    return { spending: Math.max(0, current.spending + (ask.spending ?? 0)), billsSubs: Math.max(0, current.billsSubs + (ask.billsSubs ?? 0)) };
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
        ? saveLimit(plan, ask.year, m, ask.name, ask.by ? Math.max(0, (plan.categories?.[ask.name]?.[m - 1] ?? 0) + ask.value) : ask.value, "month", asOf, at)
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
      ? ask.by
        ? `${ask.name} limit ${ask.value >= 0 ? "raised" : "lowered"} by ${formatMoney(Math.abs(ask.value))} a month, ${span}.`
        : ask.value > 0
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

