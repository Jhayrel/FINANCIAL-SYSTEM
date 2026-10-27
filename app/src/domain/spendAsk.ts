/**
 * "How much did I spend on food in August?", answered on the device.
 *
 * A sum over the ledger is the one thing the model must never do, and the
 * one thing a free model most often gets wrong or loses: when a request is
 * trimmed to fit, the rows it would have counted are the first to go. The
 * answer is a filter and a sum, so the app does it, with the same windows
 * the charts read (`charts.ts`, `windowOf`) and the same per-row cost the
 * Insights screen adds up (`totals.ts`, `costOf`), so all three agree.
 *
 * It answers only when it is sure. A thing it cannot find on the owner's own
 * list ("how much did I spend on the gym") goes to the model with the rest
 * of the conversation, rather than being answered as nothing.
 */

import { windowOf } from "./charts";
import { daysIn } from "./readEntry";
import { addDays, dayInWords, formatMedium } from "./dates";
import { dayFromWords } from "./dayWords";
import { formatMoney, type Centavos } from "./money";
import { itemHintIn } from "./filipino";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

export interface SpendAsk {
  /** The item, as the ledger names it, or null for everything. */
  readonly item: string | null;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly name: string;
  /** "What did I buy last friday?": the entries, not only their sum. */
  readonly list?: boolean;
  /**
   * The word asked about when it only points at the kind: "grab" is Travel,
   * but the question is the Grab rides, not a funeral trip filed as Travel
   * (27 October 2026 sweep). The answer counts the entries that say it.
   */
  readonly word?: string;
}

/** Common slips, only in the words this reader looks for. */
const SLIPS: readonly (readonly [RegExp, string])[] = [
  [/\bhw\b/gi, "how"],
  [/\b(?:mch|muc|mutch)\b/gi, "much"],
  [/\b(?:spnt|spen|spnd|spendt|spended)\b/gi, "spent"],
  [/\b(?:wek|weeek|wk)\b/gi, "week"],
  [/\b(?:mnth|montb|moth)\b/gi, "month"],
  [/\b(?:nung|noong|nitong|ngayong)\b/gi, "in"],
  [/\bbuwan na ito\b|\bngayong buwan\b/gi, "this month"],
  [/\bnakaraang buwan\b|\blast mo\b/gi, "last month"],
  [/\bkahapon\b/gi, "yesterday"],
  [/\bngayon\b/gi, "today"],
];

const ASKS =
  /\bwhat (?:did|have) i (?:spend|spent|buy|bought|purchase|pay for)\b|\b(?:how much|magkano|what did i spend|what have i spent|total (?:spending|spent|expenses?))\b[^?.!]*\b(?:spent|spend|spending|nagastos|ginastos|gastos|nagastusan|gastusin|used|paid)\b|\b(?:magkano|how much)\b[^?.!]*\b(?:nagastos|ginastos|gastos)\b|\bmy (?:total )?spending (?:on|for)\b|^\s*(?:what(?:'s| is| was)\s+)?(?:my\s+)?total (?:spending|spent|expenses?)\b/i;

/** Asking what it could cost, or whether to, rather than what it did. */
// "how much money i can spend tommorow?" is a can question, never a past sum (backup of 7 October 2026).
const NOT_THIS = /\b(afford|should|would|will|could|budget|save|saving|left|remaining|if i|what if|plan|limit|owe|debt|credit)\b|\bhow much (?:money |cash |pesos? )?(?:i )?(?:can|could|may|might|pwede)\b/i;

/**
 * The spending question in a sentence, or null when it is not one this can
 * answer exactly. `items` is every item name the ledger uses.
 */
export function readSpendAsk(said: string, items: readonly string[], asOf: IsoDate): SpendAsk | null {
  let text = said.trim();
  for (const [slip, word] of SLIPS) text = text.replace(slip, word);
  // "Total summary of school spending": a sum too, once an item on the list is named (13 October 2026).
  const summed = /\b(?:total|summary|sum|overall)\b[^?.!]*\b(?:spending|spent|expenses?|gastos)\b/i.test(text);
  if (NOT_THIS.test(text) || (!ASKS.test(text) && !summed)) return null;

  // The thing, after "on", "for" or "sa": a name on the owner's list, or a word that means one.
  const after = /\b(?:on|for|at|sa|sa mga|in the way of)\s+(?:my\s+|the\s+|mga\s+)?([a-z][a-z &'-]{1,40}?)(?=\s+(?:in|during|last|this|from|since|over|for|between|today|yesterday|so far|ngayon)\b|[?.!,]|$)/i.exec(text);
  const lower = text.toLowerCase();
  const byName = [...items]
    .filter((name) => name.trim().length > 1)
    .sort((a, b) => b.length - a.length)
    .find((name) => new RegExp(`\\b${name.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(lower));
  const hint = itemHintIn(text);
  const byHint = hint ? items.find((name) => name.trim().toLowerCase() === hint) : undefined;
  const item = byName ?? byHint ?? null;
  if (!ASKS.test(text) && !item) return null;
  const pointed = !byName && byHint && after?.[1] ? after[1].trim().toLowerCase() : "";
  let word = pointed && /^[a-z][a-z'-]{2,20}$/.test(pointed) && pointed !== (byHint ?? "").toLowerCase() ? pointed : undefined;

  /*
   * Something named that is not on the list: the entries whose words say it.
   * "How much did I spend on shoes?" got the month's summary with the AI off
   * (27 October 2026 sweep); shoes are filed under Online Buy or Clothes, and
   * the description says shoes. More than two words is not a thing.
   */
  if (!item && after?.[1]) {
    const named = after[1].trim().toLowerCase();
    const period = /^(?:the\s+)?(?:last|this|past|whole|entire|all|everything|today|yesterday|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|week|month|year|20\d{2})\b/;
    if (!period.test(named)) {
      const thing = named.replace(/^(?:a|an|the|my|mga)\s+/, "");
      if (!/^[a-z][a-z'-]{2,20}(?:\s[a-z][a-z'-]{2,20})?$/.test(thing) || /^(?:it|that|this|them|things?|stuff|everything|anything|something|myself|me|you|average)$/.test(thing)) return null;
      word = thing;
    }
  }
  const withWord = <T extends SpendAsk>(a: T): T => (word ? { ...a, word } : a);

  /*
   * A run of days, however it is said ("in span of oct 10 to 12", "between
   * oct 5 and oct 10", "mula oct 1 hanggang oct 10", "the last 3 days"): the
   * same reader the entries use, so a question and an entry agree on the
   * days (12 October 2026). Anything else, the charts' windows.
   */
  // "this month vs last month": this month, and the answer says the month before beside it (19 October 2026).
  if (/\bthis month\b/i.test(text) && /\b(?:last|previous)\s+month\b/i.test(text)) {
    const w = windowOf("this month", asOf);
    return withWord({ item, from: w.from, to: w.to, name: w.name });
  }
  // One day by its weekday, "2 days ago" or "the 23rd": that day, not the days up to it (26 October 2026).
  const oneDay = dayFromWords(said, asOf);
  const list = /\bwhat (?:did|have) i (?:buy|bought|purchase|pay for)\b/i.test(text);
  if (oneDay && !/\b(?:since|from|until|to|hanggang)\b/i.test(text)) return withWord({ item, from: oneDay, to: oneDay, name: dayInWords(oneDay), list: true });
  const span = daysIn(text, asOf);
  if (span) return withWord({ item, from: span.from, to: span.to, name: `${formatMedium(span.from)} to ${formatMedium(span.to)}`, ...(list ? { list } : {}) });
  const w = windowOf(text, asOf);
  return withWord({ item, from: w.from, to: w.to, name: w.name, ...(list || w.from === w.to ? { list: true } : {}) });
}

/** What was spent, in one or two sentences, with the figure bolded. */
export function spendAnswer(ask: SpendAsk, transactions: readonly Transaction[], asOf: IsoDate): string {
  /*
   * A word that points at a kind: the entries that say it, and the whole
   * kind beside them, when they are not all of it.
   */
  if (ask.word && ask.item) {
    const word = ask.word;
    const said = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    const to = ask.to > asOf ? asOf : ask.to;
    const inKind = transactions.filter((t) => t.date >= ask.from && t.date <= to && t.item.trim().toLowerCase() === ask.item!.trim().toLowerCase() && costOf(t) > 0);
    const named = inKind.filter((t) => said.test(`${t.description} ${t.notes}`));
    if (named.length === 0 && inKind.length > 0) {
      const whole = inKind.reduce((s, t) => s + costOf(t), 0);
      return `No entry in that time says "${word}". ${ask.item}, where it is filed, came to ${formatMoney(whole).replace(/^₱/, "PHP ")} over ${inKind.length} ${inKind.length === 1 ? "entry" : "entries"}.`;
    }
    if (named.length > 0 && named.length < inKind.length) {
      const label = word.replace(/^./, (c) => c.toUpperCase());
      const { word: _said, ...plain } = ask;
      const own = spendAnswer({ ...plain, item: label }, named.map((t) => ({ ...t, item: label })), asOf);
      const whole = inKind.reduce((s, t) => s + costOf(t), 0);
      return `${own} All ${ask.item} in the same days: ${formatMoney(whole).replace(/^₱/, "PHP ")}.`;
    }
  }
  // Only a word, on no list: the entries that say it, and the year's when the period has none.
  if (ask.word && !ask.item) return wordAnswer({ ...ask, word: ask.word }, transactions, asOf);
  const live = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt);
  const to = ask.to > asOf ? asOf : ask.to;
  const matches = (t: Transaction): boolean => ask.item === null || t.item.trim().toLowerCase() === ask.item.trim().toLowerCase();
  const rows = live.filter((t) => t.date >= ask.from && t.date <= to && matches(t) && costOf(t) > 0);
  const total: Centavos = rows.reduce((sum, t) => sum + costOf(t), 0);
  const money = (c: Centavos): string => formatMoney(c).replace(/^₱/, "PHP ");
  const what = ask.item ? ` on ${ask.item}` : "";
  /*
   * "on Friday, October 23", "this week (Oct 19 to Oct 25)": "Nothing in
   * Friday, October 23 ... between October 23, 2026 and October 23, 2026"
   * and "from this week, Oct 19 to Oct 25" read badly (26 October 2026).
   */
  const weekday = /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),/.test(ask.name);
  const week = /^(this|last) week, (.+)$/.exec(ask.name);
  const when = /^(?:yesterday|today)$|^the (?:last|past)\b/i.test(ask.name)
    ? ask.name
    : weekday
      ? `on ${ask.name}`
      : week
        ? `${week[1]} week (${week[2]})`
        : /\bto\b/.test(ask.name)
          ? `from ${ask.name}`
          : `in ${ask.name}`;

  if (rows.length === 0) {
    return ask.from === to
      ? `Nothing${what} ${when}: no spending entry${ask.item ? ` for ${ask.item}` : ""} that day.`
      : `Nothing${what} ${when}: no spending entry${ask.item ? ` for ${ask.item}` : ""} between ${ask.from > "1000" ? formatMedium(ask.from) : "the start"} and ${formatMedium(to)}.`;
  }
  /*
   * One entry, however many days it covers: the days of a date range are
   * shares of one entry, never entries of their own, and the largest is the
   * entry, said with its days (12 October 2026 audit: "over 7 entries" for 5,
   * and a day's share named the largest with a broken ", )").
   */
  const entries = new Map<string, { cost: Centavos; first: Transaction; last: Transaction }>();
  for (const t of rows) {
    const key = t.coveredBy ?? t.id;
    const at = entries.get(key);
    if (!at) entries.set(key, { cost: costOf(t), first: t, last: t });
    else entries.set(key, { cost: at.cost + costOf(t), first: t.date < at.first.date ? t : at.first, last: t.date > at.last.date ? t : at.last });
  }
  const count = entries.size;
  const biggest = [...entries.values()].sort((a, b) => b.cost - a.cost)[0];
  const out = [
    `You spent **${money(total)}**${what} ${when}, over ${count} ${count === 1 ? "entry" : "entries"}.`,
  ];
  /*
   * Entries dated later in the window count on the Budget screen and in a
   * limit, so they are said rather than dropped silently: the chat gave Food
   * as PHP 4,691.00 "in October" beside the Budget's PHP 5,191.00 (7 October
   * 2026 limits audit). The total above stays to today.
   */
  if (ask.to > asOf) {
    const ahead = live.filter((t) => t.date > asOf && t.date <= ask.to && matches(t) && costOf(t) > 0);
    if (ahead.length > 0) {
      const sum = ahead.reduce((s, t) => s + costOf(t), 0);
      out.push(`That is up to today; ${money(sum)} more is entered for later ${ahead.length === 1 ? "date" : "dates"} in the same period, ${money(total + sum)} with it.`);
    }
  }
  // The entries themselves, for one day or "what did I buy" (26 October 2026).
  if (ask.list && count > 1 && count <= 10) {
    const each = [...entries.values()].sort((a, b) => a.first.date.localeCompare(b.first.date) || a.first.recordNumber - b.first.recordNumber);
    out.push(
      each
        .map((e) => `\n- #${String(e.first.recordNumber).padStart(4, "0")} ${e.first.item || "(no item)"}${e.first.description.trim() && e.first.description.trim().toLowerCase() !== e.first.item.trim().toLowerCase() ? `, ${e.first.description.trim().slice(0, 50)}` : ""}: ${money(e.cost)}${ask.from === to ? "" : `, ${formatMedium(e.first.date)}`}`)
        .join(""),
    );
    return out.join(" ").replace(/ \n/g, "\n");
  }
  if (biggest && count > 1) {
    const said = biggest.first.description.replace(/(?:, )?day \d+ of \d+$/, "").trim();
    const short = said.length > 50 ? `${said.slice(0, 50).trimEnd()}...` : said;
    const days = biggest.last.date > biggest.first.date ? `${formatMedium(biggest.first.date)} to ${formatMedium(biggest.last.date)}` : formatMedium(biggest.first.date);
    out.push(`The largest was ${money(biggest.cost)}, #${String(biggest.first.recordNumber).padStart(4, "0")} on ${days}${short ? ` (${short})` : ""}.`);
  }

  // A whole calendar month is compared with the one before it.
  const lastDay = new Date(Date.UTC(Number(ask.to.slice(0, 4)), Number(ask.to.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const whole = /^\d{4}-\d{2}-01$/.test(ask.from) && ask.from.slice(0, 7) === ask.to.slice(0, 7) && ask.to === lastDay;
  if (whole) {
    const y = Number(ask.from.slice(0, 4));
    const m = Number(ask.from.slice(5, 7));
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const before = live.filter((t) => t.date.startsWith(prev) && matches(t)).reduce((sum, t) => sum + costOf(t), 0);
    if (before > 0) {
      const diff = total - before;
      out.push(diff === 0 ? "The same as the month before." : `That is ${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than the month before (${money(before)}).`);
    }
  }
  return out.join(" ");
}

/**
 * A period said on its own, as a follow-up: "All years", "this year", "how
 * about 2025?". The phrase to add to the question before, or null.
 */
export function periodOnly(said: string): string | null {
  const m = /^\s*(?:(?:and|what about|how about|for|in|over|ok(?:ay)?|then|now|like|i mean|i meant|no|so|but|just|only),?\s+)*((?:all|every)\s+(?:years?|time)|all-time|ever|overall|(?:this|last|past)\s+(?:year|month|week)|20\d{2}|since\s+20\d{2}|from\s+20\d{2}|the\s+whole\s+(?:year|ledger|time)|since\s+the\s+(?:beginning|start))\s*[?.!]*\s*$/i.exec(said);
  return m?.[1] ? (/^20\d{2}$/.test(m[1]) ? `in ${m[1]}` : m[1].toLowerCase()) : null;
}

/** "shoes" says shoe and shoes, "glasses" says glass; "grab" says Grab. */
const saysWord = (word: string): RegExp => {
  const w = word.toLowerCase().trim();
  const forms = [...new Set([w, w.replace(/s$/, ""), w.replace(/es$/, "")])].filter((f) => f === w || f.length >= 4);
  const escaped = forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  return new RegExp(`\\b(?:${escaped.join("|")})(?:s|es)?\\b`, "i");
};

/**
 * What was spent on entries that say a word no list has: "shoes". When the
 * period asked has none, the last year is said beside it, since a thing bought
 * now and then is seldom in one month.
 */
function wordAnswer(ask: SpendAsk & { readonly word: string }, transactions: readonly Transaction[], asOf: IsoDate): string {
  const money = (c: Centavos): string => formatMoney(c).replace(/^₱/, "PHP ");
  const says = saysWord(ask.word);
  const spent = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt && costOf(t) > 0 && t.date <= asOf && says.test(`${t.description} ${t.notes}`));
  const to = ask.to > asOf ? asOf : ask.to;
  const inside = spent.filter((t) => t.date >= ask.from && t.date <= to);
  const sum = (rows: readonly Transaction[]): Centavos => rows.reduce((s, t) => s + costOf(t), 0);
  const kinds = (rows: readonly Transaction[]): string => {
    const names = [...new Set(rows.map((t) => t.item.trim()).filter(Boolean))];
    return names.length === 0 ? "" : ` Filed under ${names.slice(0, 3).join(", ")}${names.length > 3 ? " and others" : ""}.`;
  };
  const latest = (rows: readonly Transaction[]): string => {
    const last = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.recordNumber - a.recordNumber)[0];
    return last ? ` The latest was ${money(costOf(last))}, #${String(last.recordNumber).padStart(4, "0")} on ${formatMedium(last.date)}${last.description.trim() ? ` (${last.description.trim().slice(0, 50)})` : ""}.` : "";
  };
  const period = /\b(?:to|from)\b/.test(ask.name) ? `from ${ask.name}` : `in ${ask.name}`;
  if (inside.length > 0) {
    return `You spent **${money(sum(inside))}** on entries that say "${ask.word}" ${period}, over ${inside.length} ${inside.length === 1 ? "entry" : "entries"}.${kinds(inside)}${latest(inside)}`;
  }
  const yearAgo = addDays(asOf, -365);
  const year = spent.filter((t) => t.date >= yearAgo);
  if (year.length === 0) return `No spending entry says "${ask.word}" ${period}, or in the last year. If it was filed under another word, ask by its kind, like "how much did I spend on online buy".`;
  return `No spending entry says "${ask.word}" ${period}. In the last year: **${money(sum(year))}** over ${year.length} ${year.length === 1 ? "entry" : "entries"}.${kinds(year)}${latest(year)}`;
}
