/**
 * "How much did I pay for gas last time?", "when did I last buy Jollibee?",
 * "how much do I usually pay for load?", answered from the entries (26
 * October 2026: "I want it to do more").
 *
 * The thing is an item on the owner's list ("gas"), or else a word the
 * descriptions use ("jollibee", "carwash"). The answer is the last entry,
 * the ones before it, and what it usually costs: the middle of the last
 * ten, so one big day does not move it.
 */
import { dayInWords } from "./dates";
import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface LastTimeAsk {
  /** An item on the list, matched exactly, or a word from the descriptions. */
  readonly item: string | null;
  readonly word: string | null;
  /** "How much do I usually pay": the usual first, then the last. */
  readonly usual: boolean;
}

const ASKS =
  /\b(?:last\s+time|when\s+did\s+i\s+last|when\s+was\s+the\s+last|the\s+last\s+(?:time\s+)?i\s+(?:bought|paid|spent|got|had)|how\s+much\s+(?:do|did)\s+i\s+usually\s+(?:pay|spend)|how\s+much\s+is\s+(?:my\s+)?usual)\b/i;

const LITTLE = new Set("the a an my i me on for at in of to and how much did do was is when last time usually usual pay paid spend spent buy bought got had what it this that".split(" "));

/**
 * "How much I spent last time?", naming nothing: the thing is the one the
 * conversation is about. Answered with September's total, then with the
 * gym's price today, before the third try got the gym's last time (26
 * October 2026).
 */
export function asksLastTime(text: string): boolean {
  const t = text.trim();
  return ASKS.test(t) && !/\d/.test(t) && !/\byou\b/i.test(t);
}

/** The longest item on the list a sentence names, as a whole word. */
export function itemNamed(text: string, items: readonly string[]): string | null {
  const lower = text.toLowerCase();
  return (
    [...items]
      .filter((n) => n.trim().length > 2 && !/^(?:unknown|random|spending|revenue|transfer)$/i.test(n.trim()))
      .sort((a, b) => b.length - a.length)
      .find((n) => new RegExp(`\\b${n.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(lower)) ?? null
  );
}

export function readLastTimeAsk(text: string, items: readonly string[]): LastTimeAsk | null {
  const t = text.trim();
  // "same as last time 200" is an entry, and "last time you said" is about the answer, not the money.
  if (!ASKS.test(t) || /\d/.test(t) || /\byou\b/i.test(t)) return null;
  const lower = t.toLowerCase();
  const item =
    [...items]
      .filter((n) => n.trim().length > 1)
      .sort((a, b) => b.length - a.length)
      .find((n) => new RegExp(`\\b${n.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(lower)) ?? null;
  const words = lower.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !LITTLE.has(w));
  const word = item ? null : (words[words.length - 1] ?? null);
  if (!item && !word) return null;
  return { item, word, usual: /\busual(?:ly)?\b/i.test(t) };
}

export function lastTimeAnswer(ask: LastTimeAsk, transactions: readonly Transaction[], asOf: IsoDate, money: (c: Centavos) => string): string {
  const said = ask.item ?? ask.word ?? "";
  const matches = (t: Transaction): boolean =>
    t.type === "Spending" &&
    t.date <= asOf &&
    (ask.item ? t.item.trim().toLowerCase() === ask.item.trim().toLowerCase() : `${t.item} ${t.description}`.toLowerCase().includes(said.toLowerCase()));
  const rows = transactions.filter(matches).sort((a, b) => b.date.localeCompare(a.date) || b.recordNumber - a.recordNumber);
  if (rows.length === 0) return `Nothing in your entries ${ask.item ? `is ${ask.item}` : `mentions "${said}"`}, so there is no last time to go by.`;

  const no = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;
  const last = rows[0]!;
  const recent = rows.slice(0, 10).map((t) => t.total).sort((a, b) => a - b);
  const usual = recent[Math.floor((recent.length - 1) / 2)] ?? last.total;
  const from = new Map<string, number>();
  for (const t of rows.slice(0, 10)) from.set(t.fromWallet, (from.get(t.fromWallet) ?? 0) + 1);
  const wallet = [...from].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const lastLine = `The last time: ${no(last)} on ${dayInWords(last.date)}${last.date.slice(0, 4) !== asOf.slice(0, 4) ? ` ${last.date.slice(0, 4)}` : ""}, ${last.item || "Spending"}${last.description.trim() && last.description.trim().toLowerCase() !== last.item.trim().toLowerCase() ? ` (${last.description.trim().slice(0, 50)})` : ""}, ${money(last.total)} from ${last.fromWallet || "no wallet"}.`;
  const usualLine =
    rows.length > 1
      ? `Usually ${money(usual)}, going by the last ${recent.length} (${money(recent[0] ?? usual)} to ${money(recent[recent.length - 1] ?? usual)})${wallet ? `, mostly from ${wallet}` : ""}.`
      : "That is the only one.";
  const before = rows.slice(1, 4).map((t) => `${dayInWords(t.date)} ${money(t.total)}`);
  return [ask.usual ? `**${usualLine}**` : `**${lastLine}**`, ask.usual ? lastLine : usualLine, before.length > 0 ? `Before that: ${before.join(", ")}.` : ""].filter(Boolean).join("\n");
}
