/**
 * What a corrected card teaches, and what it was taught before.
 *
 * ── Why "What it has learned" said nothing yet ────────────────────────────
 *
 * The owner corrects cards all the time, and Settings kept saying the
 * assistant had learned nothing. Three reasons, all of them real:
 *
 *   1. Only a correction typed into the chat ("make it food") was recorded.
 *      Changing the item on the card itself, or in the form beside it, and
 *      then saving, taught nothing.
 *   2. A wallet correction was recorded against the old value ("Maya is
 *      Gcash"), and a wallet name already means itself, so every one was
 *      thrown away on reading, correctly.
 *   3. The key was the whole sentence, dates and figures included, so a
 *      lesson could only fire on the same sentence typed again.
 *
 * ── What a lesson is now ──────────────────────────────────────────────────
 *
 * When a card is saved, what was first read is set against what was saved.
 * Every field the owner changed (the item, the wallet it came from, the wallet
 * it went to) is a lesson, keyed on the words of the sentence that carry the
 * meaning: no figures, no dates, no wallet names, no filler. "jollibee 285
 * today using gcash" corrected to Food teaches "jollibee is Food", and the next
 * "jollibee 350" is Food without asking.
 *
 * A saved row is the only thing learned from. A card corrected and then
 * thrown away teaches nothing, because nobody confirmed the correction.
 */

import { aiEvent, type AiEvent, type AiWhere } from "./aiLog";
import type { Draft } from "./entry";
import type { ReferenceLists } from "./types";

/** Words that say how it was said rather than what it was. */
const FILLER = new Set([
  "i", "me", "my", "we", "our", "a", "an", "the", "to", "for", "from", "at", "in", "on", "of", "with", "by", "and",
  "using", "use", "used", "via", "thru", "through", "paid", "pay", "payed", "spent", "spend", "bought", "buy", "got",
  "received", "recieved", "sent", "send", "transfer", "transferred", "today", "yesterday", "tonight", "morning",
  "afternoon", "evening", "now", "just", "earlier", "php", "peso", "pesos", "p", "k", "worth", "total", "was", "is",
  "it", "this", "that", "some", "ang", "ng", "sa", "ko", "ako", "gamit", "kanina", "po", "earn", "earns", "earned",
  "earnd", "receive", "recieve", "recieved", "income", "money", "cash", "bayad", "nagbayad", "bumili", "binili",
]);

const DATE_WORDS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$|^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/;

/**
 * The words of a sentence that name the thing, as the key a lesson is kept
 * under. Empty when nothing is left, and then nothing is learned.
 */
export function lessonKey(said: string, reference: ReferenceLists): string {
  const walletWords = new Set(
    [...reference.wallets, ...reference.savings, ...(reference.credits ?? [])]
      .flatMap((name) => name.toLowerCase().split(/[^a-z0-9]+/))
      .filter((w) => w.length > 1),
  );
  const words = said
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && !/\d/.test(w) && !FILLER.has(w) && !walletWords.has(w) && !DATE_WORDS.test(w));
  // A long sentence is a story, not a name, and would never match again.
  return words.length > 0 && words.length <= 6 ? words.join(" ") : "";
}

/** The owner's own names for a field, which a key must not be. */
function namesFor(reference: ReferenceLists): Set<string> {
  return new Set(
    [
      ...reference.spendingTypes.map((s) => s.name),
      ...reference.bills,
      ...reference.subscriptions,
      ...reference.revenueCategories,
    ].map((n) => n.trim().toLowerCase()),
  );
}

/**
 * The lessons in one saved card: every field changed between the first
 * reading and the row saved, keyed on what was said.
 */
export function lessonsFrom(
  first: Draft,
  saved: Draft,
  said: string,
  reference: ReferenceLists,
  where: AiWhere = "add",
): AiEvent[] {
  const key = lessonKey(said, reference);
  if (!key || namesFor(reference).has(key)) return [];

  const out: AiEvent[] = [];
  const fields = ["item", "fromWallet", "toWallet"] as const;
  for (const field of fields) {
    const was = first[field].trim();
    const now = saved[field].trim();
    if (!now || was === now) continue;
    // A different kind of entry is a different question, not a lesson about the words.
    if (first.flow !== saved.flow && field !== "item") continue;
    out.push(
      aiEvent("edited", where, {
        field,
        proposed: key,
        corrected: now,
        entry: `${saved.date} ${saved.flow} ${saved.item}`,
      }),
    );
  }
  return out;
}
