/**
 * What a message says about a card already in the conversation, rather
 * than a new entry: a figure on a card that is not real, a discarded card
 * wanted back, and more words about the entry just added.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 16 November 2026, after a receipt and a credit screen (the
 * figures and names here are stand-ins):
 *
 *   "There's no 5650 there check it again"   answered "There is no #5650 in
 *                                            the ledger", a record lookup
 *   "Re add the food", "The 650 earlier"     a new card asking which wallet
 *                                            and what it was for, all of it
 *                                            already on the card discarded
 *   "Thats treas my friends at the diner"    straight after a Treat entry was
 *                                            added: a new card, "How much
 *                                            was it?"
 *
 * Each is about a card on screen. Nothing here touches the ledger: a
 * disputed card is discarded (a card is a guess that has not become
 * anything), a discarded card comes back as a card to check, and words
 * about a saved entry become an Edit card that changes nothing until
 * applied.
 */
import { kindNamed } from "./entryAside";
import type { Draft } from "./entry";
import { parseAmount, type Centavos } from "./money";

const FIGURE = String.raw`(?:₱|php\s*|p\s*)?(\d[\d,]*(?:\.\d{1,2})?)`;
const DISPUTE_BEFORE = new RegExp(
  String.raw`\b(?:there(?:'?s|\s+is|\s+was|\s+isn'?t\s+(?:a|any))?\s+no|no\s+such|walang|wala(?:ng)?\s+(?:ganun|yung|ng))\s+` + FIGURE + String.raw`(?![\d.])`,
  "i",
);
const DISPUTE_AFTER = new RegExp(
  FIGURE +
    String.raw`\s+(?:is\s+|was\s+)?(?:not\s+(?:there|real|mine|in\s+(?:the\s+)?(?:picture|receipt|screenshot|photo|image)|on\s+(?:the\s+)?(?:picture|receipt|screenshot|photo))|wrong|fake|made\s+up|invented|does\s*n'?t\s+exist|does\s+not\s+exist|isn'?t\s+(?:there|real)|wala)\b`,
  "i",
);

/**
 * The figure a message says is not real: "there's no 5650 there", "5650 is
 * not in the picture", "walang 5650". Null otherwise. Only ever matched
 * against a card's own amount, so a sentence that merely contains "no" and
 * a number changes nothing unless a card carries that very figure.
 */
export function disputedFigure(text: string): Centavos | null {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 16) return null;
  const m = DISPUTE_BEFORE.exec(t) ?? DISPUTE_AFTER.exec(t);
  const figure = m?.[1] ? parseAmount(m[1]) : null;
  return figure !== null && figure > 0 ? figure : null;
}

/** "re-add", "add it back", "the one earlier", "kanina": a card from before, not a new entry. */
const BACK_AGAIN =
  /\b(?:re-?\s?add|readd|add\s+(?:it|that|them|the\s+\w+(?:\s+one)?)\s+(?:back|again)|bring\s+(?:it\s+|that\s+|the\s+\w+\s+)?back|put\s+(?:it\s+|that\s+|the\s+\w+\s+)?back|give\s+(?:me\s+)?(?:it\s+|that\s+)?back|earlier|kanina|before|discarded|ibalik|balik)\b/i;

/** Words that say how, not which: never what a card is matched on. */
const HOW = new Set([
  "re", "add", "readd", "the", "that", "this", "one", "ones", "it", "them", "back", "again", "earlier", "kanina", "before", "discarded",
  "card", "cards", "entry", "please", "pls", "bring", "put", "give", "me", "my", "ibalik", "balik", "from", "was", "were", "just", "now",
]);
const wordsOf = (t: string): string[] => t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !HOW.has(w));

export interface DiscardedCard {
  readonly draft: Draft;
}

/**
 * Which discarded card a message wants back, newest first, by its figure or
 * by what it was ("the food", "jollibee"): the index in `cards`, or null.
 * Only with words that point back ("re add", "earlier", "kanina"), and only
 * when one card answers, counting the same card read twice as one.
 */
export function discardedNamed(text: string, cards: readonly DiscardedCard[]): number | null {
  const t = text.trim();
  if (!t || t.endsWith("?") || t.split(/\s+/).length > 10 || !BACK_AGAIN.test(t) || cards.length === 0) return null;
  const figures = [...t.replace(/\b20\d{2}\b/g, " ").matchAll(/(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) => parseAmount(m[1] ?? "")).filter((n): n is number => n !== null && n > 0);
  const words = wordsOf(t);
  if (figures.length === 0 && words.length === 0) return null;
  const hits: number[] = [];
  cards.forEach((c, i) => {
    const d = c.draft;
    if (figures.length > 0 && (d.amount === null || !figures.includes(d.amount))) return;
    if (words.length > 0) {
      const own = new Set(wordsOf(`${d.item} ${d.description} ${d.category}`));
      if (figures.length === 0 && !words.some((w) => own.has(w))) return;
    }
    hits.push(i);
  });
  if (hits.length === 0) return null;
  const key = (i: number): string => {
    const d = cards[i]!.draft;
    return `${d.flow}|${d.amount}|${d.item.toLowerCase()}|${d.fromWallet.toLowerCase()}|${d.date}`;
  };
  return new Set(hits.map(key)).size === 1 ? hits[hits.length - 1]! : null;
}

/** "that's", "it was", "it's for": words about the entry just before. */
const ABOUT_IT = /^\s*(?:no[,.\s]+)?(?:that'?s|thats|that\s+is|that\s+was|it'?s|its|it\s+is|it\s+was|this\s+is|this\s+was)\s+(?:for\s+)?/i;

/** One letter added, dropped or changed: "treas" for "treat". */
function oneOff(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const rest = (x: string, skip: number): string => x.slice(i + skip);
  return rest(a, 1) === rest(b, 1) || rest(a, 1) === rest(b, 0) || rest(a, 0) === rest(b, 1);
}

export interface AboutLast {
  /** The description it should say, when the words describe it. */
  readonly description?: string;
  /** The kind it should be, when the words only name one of theirs. */
  readonly item?: string;
  /** The entry already says it: nothing to change. */
  readonly same?: boolean;
}

/**
 * Words about the entry just added, with no figure of their own: "Thats
 * treat my friends at the diner" after a Treat entry. The description they
 * give (a word one letter off the entry's own kind is written as the kind,
 * so "treas" is "Treat"), or the kind they name, and whether it already
 * says so. Null when the message reads as anything else.
 */
export function aboutLast(text: string, last: Pick<Draft, "item" | "description">, kinds: readonly string[]): AboutLast | null {
  const t = text.trim();
  if (!t || /\d/.test(t) || t.endsWith("?") || t.split(/\s+/).length > 12 || !ABOUT_IT.test(t)) return null;
  const rest = t.replace(ABOUT_IT, "").replace(/[.!]+$/, "").trim();
  if (rest.split(/\s+/).length < 1 || rest.length < 3) return null;
  // "That's wrong", "it's a budget", "that's all": about something else.
  if (/^(?:a\s+|the\s+|my\s+)?(?:wrong|right|correct|fine|ok(?:ay)?|good|all|it|everything|budget|a budget|transfer|income|revenue|debt|mali|tama)\b/i.test(rest)) return null;
  const named = kindNamed(rest.replace(/^(?:a|an|the|my)\s+/i, ""), kinds);
  if (named) return named.toLowerCase() === last.item.trim().toLowerCase() ? { item: named, same: true } : { item: named };
  const item = last.item.trim();
  const fixed = rest
    .split(/(\s+)/)
    .map((w) => (item && /^[a-z]+$/i.test(w) && w.length >= 4 && oneOff(w.toLowerCase(), item.toLowerCase()) ? item : w))
    .join("");
  const description = fixed.charAt(0).toUpperCase() + fixed.slice(1);
  return description.toLowerCase() === last.description.trim().toLowerCase() ? { description, same: true } : { description };
}
