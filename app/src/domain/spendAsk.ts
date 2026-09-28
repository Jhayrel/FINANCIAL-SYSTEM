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
  /\b(?:how much|magkano|what did i spend|what have i spent|total (?:spending|spent|expenses?))\b[^?.!]*\b(?:spent|spend|spending|nagastos|ginastos|gastos|nagastusan|gastusin|used|paid)\b|\b(?:magkano|how much)\b[^?.!]*\b(?:nagastos|ginastos|gastos)\b|\bmy (?:total )?spending (?:on|for)\b|^\s*(?:what(?:'s| is| was)\s+)?(?:my\s+)?total (?:spending|spent|expenses?)\b/i;

/** Asking what it could cost, or whether to, rather than what it did. */
const NOT_THIS = /\b(afford|should|would|will|could|budget|save|saving|left|remaining|if i|what if|plan|limit|owe|debt|credit)\b|\bhow much (?:can|may|might) i\b/i;

/**
 * The spending question in a sentence, or null when it is not one this can
 * answer exactly. `items` is every item name the ledger uses.
 */
export function readSpendAsk(said: string, items: readonly string[], asOf: IsoDate): SpendAsk | null {
  let text = said.trim();
  for (const [slip, word] of SLIPS) text = text.replace(slip, word);
  if (!ASKS.test(text) || NOT_THIS.test(text)) return null;

  // The thing, after "on", "for" or "sa": a name on the owner's list, or a word that means one.
  const after = /\b(?:on|for|sa|sa mga|in the way of)\s+(?:my\s+|the\s+|mga\s+)?([a-z][a-z &'-]{1,40}?)(?=\s+(?:in|during|last|this|from|since|over|for|between|today|yesterday|so far|ngayon)\b|[?.!,]|$)/i.exec(text);
  const lower = text.toLowerCase();
  const byName = [...items]
    .filter((name) => name.trim().length > 1)
    .sort((a, b) => b.length - a.length)
    .find((name) => new RegExp(`\\b${name.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(lower));
  const hint = itemHintIn(text);
  const byHint = hint ? items.find((name) => name.trim().toLowerCase() === hint) : undefined;
  const item = byName ?? byHint ?? null;

  // Something was named that is not on the list: not a question to answer as nothing.
  if (!item && after?.[1]) {
    const named = after[1].trim().toLowerCase();
    const period = /^(?:the\s+)?(?:last|this|past|whole|entire|all|everything|today|yesterday|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|week|month|year|20\d{2})\b/;
    if (!period.test(named)) return null;
  }

  const w = windowOf(text, asOf);
  return { item, from: w.from, to: w.to, name: w.name };
}

/** What was spent, in one or two sentences, with the figure bolded. */
export function spendAnswer(ask: SpendAsk, transactions: readonly Transaction[], asOf: IsoDate): string {
  const live = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt);
  const to = ask.to > asOf ? asOf : ask.to;
  const matches = (t: Transaction): boolean => ask.item === null || t.item.trim().toLowerCase() === ask.item.trim().toLowerCase();
  const rows = live.filter((t) => t.date >= ask.from && t.date <= to && matches(t) && costOf(t) > 0);
  const total: Centavos = rows.reduce((sum, t) => sum + costOf(t), 0);
  const money = (c: Centavos): string => formatMoney(c).replace(/^₱/, "PHP ");
  const what = ask.item ? ` on ${ask.item}` : "";
  const when = /^(?:yesterday|today)$|^the (?:last|past)\b/i.test(ask.name) ? ask.name : /\bto\b/.test(ask.name) ? `from ${ask.name}` : `in ${ask.name}`;

  if (rows.length === 0) {
    return `Nothing${what} ${when}: no spending entry${ask.item ? ` for ${ask.item}` : ""} between ${ask.from > "1000" ? ask.from : "the start"} and ${to}.`;
  }
  const biggest = [...rows].sort((a, b) => costOf(b) - costOf(a))[0];
  const out = [
    `You spent **${money(total)}**${what} ${when}, over ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`,
  ];
  if (biggest && rows.length > 1) {
    out.push(`The largest was ${money(costOf(biggest))} on ${biggest.date}${biggest.description.trim() ? ` (${biggest.description.trim().slice(0, 50)})` : ""}.`);
  }

  // A whole calendar month is compared with the one before it.
  const whole = /^\d{4}-\d{2}-01$/.test(ask.from) && ask.from.slice(0, 7) === ask.to.slice(0, 7);
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
