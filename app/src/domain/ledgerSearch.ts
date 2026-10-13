/**
 * "Can you search Framelink Media": the ledger searched, in the chat.
 *
 * 13 October 2026, answered "I'm not able to perform searches": the model
 * cannot, the app can. Every entry whose words hold every word asked for,
 * with what came in and went out and the newest few. "Find the difference"
 * and "find where" are their own readers and are left alone.
 */
import { formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { costOf, incomeOf } from "./totals";
import type { Transaction } from "./types";

const ASK = /^\s*(?:(?:can|could) you\s+|please\s+|pls\s+)?(?:search|look up|lookup|find)\s+(?:for\s+|me\s+)?(?:all\s+|my\s+|the\s+)*(?:entries\s+(?:for|with|about)\s+)?(.{3,60}?)\s*[?.!]*\s*$/i;
const NOT_THIS = /\b(?:difference|where|why|out|missing|gap|duplicate|twins?|cheaper|best|online|internet|google|deleted|bin|restore|remove|undo|delete)\b/i;
const SMALL = new Set(["the", "and", "for", "with", "all", "my", "entries", "entry", "in", "on", "of", "a"]);

export function readLedgerSearch(said: string): string | null {
  const m = ASK.exec(said);
  if (!m?.[1] || NOT_THIS.test(said)) return null;
  return m[1].trim();
}

export function searchLedger(phrase: string, transactions: readonly Transaction[]): string {
  const words = phrase.toLowerCase().split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 2 && !SMALL.has(w));
  if (words.length === 0) return `Say what to search for: a name, an item or a word from the description.`;
  const live = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt);
  const find = (ws: readonly string[]): Transaction[] =>
    live.filter((t) => {
      const text = [t.item, t.description, t.notes, t.category, t.fromWallet, t.toWallet].join(" ").toLowerCase();
      return ws.every((w) => text.includes(w));
    });
  /*
   * Every word first; then fewer, dropping from the end: "framelink media"
   * where the entries say "Framelink" found nothing (13 October 2026).
   */
  let hits = find(words);
  let asked = phrase;
  for (let keep = words.length - 1; hits.length === 0 && keep >= 1; keep -= 1) {
    const fewer = words.slice(0, keep);
    if (fewer.every((w) => w.length < 4)) break;
    hits = find(fewer);
    asked = fewer.join(" ");
  }
  if (hits.length === 0) return `No entry mentions "${phrase}". Try one word of it, or the item's name as the entries spell it.`;
  phrase = asked;
  const money = (c: Centavos): string => `PHP ${formatMoney(c).replace(/^[−-]?₱/, "")}`;
  const came: Centavos = hits.reduce((s, t) => s + incomeOf(t), 0);
  const went: Centavos = hits.reduce((s, t) => s + costOf(t), 0);
  const sorted = [...hits].sort((a, b) => b.date.localeCompare(a.date) || b.recordNumber - a.recordNumber);
  const first = sorted[sorted.length - 1]!;
  const newest = sorted.slice(0, 5).map((t) => `#${String(t.recordNumber).padStart(4, "0")} ${formatMedium(t.date)}, ${t.type}${t.item ? ` ${t.item}` : ""}, ${money(t.total)}`);
  return [
    `${hits.length} ${hits.length === 1 ? "entry mentions" : "entries mention"} "${phrase}", from ${formatMedium(first.date)} to ${formatMedium(sorted[0]!.date)}.`,
    came > 0 ? `Came in: **${money(came)}**.` : "",
    went > 0 ? `Went out as spending: **${money(went)}**.` : "",
    `The newest: ${newest.join("; ")}.`,
    hits.length > 5 ? `The Database screen lists all ${hits.length} when you search the same words.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
