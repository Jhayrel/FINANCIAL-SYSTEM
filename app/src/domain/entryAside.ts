/**
 * What a sentence says about the entry rather than an entry of its own:
 * "Just make it random", "put it under food", and "also" after one just like
 * it.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026, after adding a gym payment: "I also
 * treated my friend gym because he forgot his money. Just make it random".
 * That made two cards, both PHP 0.00: one for the friend, and one called
 * "make random" for the instruction, read as a purchase of its own. Then the
 * answers to the amount questions ("Today" and the figure in pesos) changed the
 * kind and left the amount blank, and the owner discarded both.
 *
 * "Make it random" is the kind for the entry beside it. "Also" with the same
 * thing, and no figure, is the same amount as the entry just before, said on
 * the card so it is checked rather than assumed.
 */
import { formatMoney, type Centavos } from "./money";

/*
 * "make it random", "just put it under food", "file this as treat", "mark
 * it as gifts", "categorize it as school", "random na lang", "under food".
 */
const ASIDE = [
  /^(?:just\s+|pls\s+|please\s+|then\s+|and\s+|ok(?:ay)?\s+)*(?:make|put|file|book|log|record|categori[sz]e|classify|label|mark|count|set|tag|add|save)\s+(?:it|this|that|them|those|both|the\s+(?:entry|entries|one|ones|card|cards))\s+(?:as|under|in|into|to|on|for)?\s*(?:the\s+|a\s+)?(.{2,40}?)(?:\s+(?:category|kind|type|item))?\s*[.!]*$/i,
  /^(?:just\s+|pls\s+|please\s+)?(?:under|as|in)\s+(?:the\s+)?(.{2,40}?)(?:\s+(?:category|kind|type|item))?\s*[.!]*$/i,
  /^(?:just\s+)?(.{2,30}?)\s+(?:na\s+lang|nalang|lang)\s*[.!]*$/i,
];

/** The kind on their own list the words name: the name, or the one name whose first word it is ("random" for "Random necessities"). */
export function kindNamed(words: string, kinds: readonly string[]): string | null {
  const w = words.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!w) return null;
  const exact = kinds.find((k) => k.toLowerCase().trim() === w);
  if (exact) return exact;
  const starts = kinds.filter((k) => k.toLowerCase().trim().split(/\s+/)[0] === w || k.toLowerCase().startsWith(`${w} `));
  return starts.length === 1 ? (starts[0] ?? null) : null;
}

/** A sentence that only names the kind for the entry beside it, or null. */
export function asideKind(sentence: string, kinds: readonly string[]): string | null {
  const s = sentence.trim();
  if (!s || /\d/.test(s) || s.split(/\s+/).length > 9) return null;
  for (const re of ASIDE) {
    const m = re.exec(s);
    const named = m?.[1] ? kindNamed(m[1], kinds) : null;
    if (named) return named;
  }
  return null;
}

/** The message without the sentences that only name a kind, and that kind (one kind, said once or the same each time). */
export function withoutAside(message: string, kinds: readonly string[]): { readonly rest: string; readonly kind: string | null } {
  const sentences = message.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length < 2) return { rest: message, kind: null };
  const named = sentences.map((s) => asideKind(s, kinds));
  const found = [...new Set(named.filter((k): k is string => k !== null))];
  if (found.length !== 1 || named.every((k) => k !== null)) return { rest: message, kind: null };
  return { rest: sentences.filter((_, i) => named[i] === null).join(" "), kind: found[0] ?? null };
}

/** True for a sentence that only names the kind for the entry beside it. */
export const isAside = (sentence: string, kinds: readonly string[]): boolean => asideKind(sentence, kinds) !== null;

export interface RecentEntry {
  readonly amount: Centavos | null;
  readonly item: string;
  readonly description: string;
  readonly said: string;
  readonly recordNumber?: number;
}

const STOP = new Set(["the", "and", "for", "his", "her", "him", "she", "they", "them", "with", "because", "forgot", "money", "also", "today", "paid", "pay", "bought", "buy", "spent", "spend", "treated", "treat", "friend", "my", "too", "same", "just", "make", "random", "this", "that", "was", "were", "pesos", "peso", "php"]);
const wordsOf = (t: string): string[] => t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * The amount of the entry just before, for "also" with the same thing and no
 * figure: "I paid 75 today swim", then "I also treated my friend swim". Null
 * when the words do not say also, carry a figure of their own, or share
 * nothing with the one before.
 */
export function sameAsBefore(message: string, before: RecentEntry | null): { readonly amount: Centavos; readonly because: string } | null {
  if (!before || before.amount === null || before.amount <= 0) return null;
  if (/\d/.test(message) || !/\b(?:also|too|as well|same|din|rin|again|ulit)\b/i.test(message)) return null;
  const mine = new Set(wordsOf(message));
  const shared = [...new Set(wordsOf(`${before.said} ${before.description}`))].find((w) => mine.has(w));
  if (!shared) return null;
  const which = before.recordNumber !== undefined ? ` (#${String(before.recordNumber).padStart(4, "0")})` : "";
  return { amount: before.amount, because: `${formatMoney(before.amount)}, the same as the ${shared} entry just before${which}, since you said also. Change it if this one was different.` };
}
