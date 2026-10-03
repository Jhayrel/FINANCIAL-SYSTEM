/**
 * "All that entry is load": a kind said once for every row of a picture.
 *
 * 2 October 2026: a Maya history sent with "all that entry is load. also
 * check it its added allready mean dont add. this is all maya" came back as
 * five cards of Unknown. The wallet was taken from "this is all maya"; the
 * kind was not, because each row of a batch is read by its own words, and the
 * rows only said "Purchased on MAYA".
 *
 * The word is a kind when it is one of the owner's spending types, or when
 * the ledger has filed it under one kind most of the time this past year:
 * load has gone under Online Buy, not under a "Load" the list no longer has.
 * A word the ledger cannot place is left alone, so nothing is guessed.
 */

import { addDays } from "./dates";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export interface SaidForAll {
  /** The spending type every row goes under. */
  readonly item: string;
  /** The word the owner used. */
  readonly word: string;
  /** Why that type, for the card. */
  readonly because: string;
}

/** "all that entry is load", "all of these are food", "these are all for school", "lahat ay load". */
const PATTERNS: readonly RegExp[] = [
  /\b(?:all|lahat)\b(?:\s+of)?(?:\s+(?:that|these|those|this|the|them|my|ng|nang))?(?:\s+(?:entr(?:y|ies)|rows?|transactions?|items?|purchases?|ones?))?\s+(?:is|are|was|were|ay)\s+(?:for\s+|a\s+|an\s+|my\s+)?([a-z][a-z ]{1,24}?)\s*(?=[.,;!?]|$|\b(?:also|and|then|but|pls|please|from|in|on|to)\b)/gi,
  /\b(?:these|they|those|this|it|that)\s+(?:is|are|was|were)\s+all\s+(?:for\s+|a\s+|an\s+)?([a-z][a-z ]{1,24}?)\s*(?=[.,;!?]|$|\b(?:also|and|then|but|pls|please|from|in|on|to)\b)/gi,
];

const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

/** The word's kind, or null when the owner's list and ledger do not say. */
function kindOf(
  word: string,
  transactions: readonly Transaction[],
  reference: Pick<ReferenceLists, "spendingTypes">,
  asOf: IsoDate,
): { item: string; because: string } | null {
  const plain = word.trim().toLowerCase();
  const singular = plain.replace(/(?:es|s)$/, "");
  const named = reference.spendingTypes.find((t) => [plain, singular].includes(t.name.trim().toLowerCase()));
  if (named) return { item: named.name, because: "" };

  const said = wordsOf(plain);
  if (said.length === 0) return null;
  const known = new Map(reference.spendingTypes.map((t) => [t.name.trim().toLowerCase(), t.name] as const));
  const yearAgo = addDays(asOf, -365);
  const byKind = new Map<string, number>();
  let total = 0;
  for (const row of transactions) {
    if (row.type !== "Spending" || row.date < yearAgo || row.date > asOf) continue;
    const have = new Set(wordsOf(`${row.description} ${row.item}`));
    if (!said.every((w) => have.has(w) || have.has(`${w}s`))) continue;
    total += 1;
    const kind = known.get(row.item.trim().toLowerCase());
    if (kind) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const [best, count] = [...byKind].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (!best || count < 2 || count * 2 < total) return null;
  return { item: best, because: `, where ${plain} has gone ${count} times this past year` };
}

/** The kind the note says every row is, or null. A wallet named this way is the wallet, not a kind. */
export function kindSaidForAll(
  note: string,
  transactions: readonly Transaction[],
  reference: Pick<ReferenceLists, "spendingTypes" | "wallets" | "savings">,
  asOf: IsoDate,
): SaidForAll | null {
  const accounts = [...reference.wallets, ...reference.savings].map((a) => a.trim().toLowerCase());
  for (const pattern of PATTERNS) {
    for (const m of note.matchAll(pattern)) {
      const word = (m[1] ?? "").trim();
      if (!word || accounts.some((a) => a === word.toLowerCase() || a.split(/\s+/)[0] === word.toLowerCase())) continue;
      const kind = kindOf(word, transactions, reference, asOf);
      if (kind) return { item: kind.item, word: word.toLowerCase(), because: kind.because };
    }
  }
  return null;
}
