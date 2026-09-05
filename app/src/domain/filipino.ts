/**
 * The other half of how the owner writes.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * These two messages produced nothing at all. No card, no answer, no reply:
 *
 *   nag bayad ako ng tricycle 500 kanina cash gamit ko
 *   bumuli ako ng pagkain 200 gcash
 *
 * Both are perfectly ordinary entries. The first is a PHP 500 tricycle fare
 * paid in cash earlier today, the second is PHP 200 of food on Gcash. Not one
 * word in either was a word this app knew, so the reader found no verb, no
 * item and no date, and the owner watched their message vanish.
 *
 * The verbs live in `readEntry.ts` beside their English equivalents, because
 * a verb is a verb whichever language it is in and splitting them into two
 * modes would mean guessing which mode a mixed sentence is in. What is here
 * is the part that cannot go there: the words for *things*, which have to be
 * matched against the owner's own item list, and the words for *when*.
 *
 * ── What this deliberately is not ─────────────────────────────────────────
 *
 * Not a translation layer, and not a dictionary. It is a short list of the
 * words that appear in messages about money, mapped onto the categories this
 * particular ledger already has. Anything not on the list falls through to
 * the existing rules unchanged, which is the same outcome as before this file
 * existed rather than a worse one.
 */

/**
 * A thing bought, in Filipino, and the English word it answers to.
 *
 * The right-hand side is matched against the owner's own spending types and
 * the notes beside them, so it never invents an item: if they have no Travel
 * type, "tricycle" simply finds nothing, exactly as it would in English.
 */
const THINGS: readonly (readonly [RegExp, string])[] = [
  [/\b(pagkain|kain|kumain|ulam|meryenda|merienda|almusal|tanghalian|hapunan)\b/i, "food"],
  [/\b(tricycle|traysikel|jeep|jeepney|bus|taxi|grab|angkas|pamasahe|pasahe|biyahe|byahe)\b/i, "travel"],
  [/\b(gasolina|krudo|diesel|gasoline)\b/i, "gas"],
  [/\b(tuition|matrikula|proyekto|project|libro|notebook|papel|eskwela|paaralan)\b/i, "school"],
  [/\b(gamot|doktor|ospital|check ?up|bakuna)\b/i, "health"],
  [/\b(load|reload|prepaid|data|internet|wifi)\b/i, "load"],
  [/\b(sabon|shampoo|gupit|barbero|parlor)\b/i, "self care"],
  [/\b(bilihin|grocery|groseri|palengke|ulam sa bahay|gamit sa bahay)\b/i, "home needs"],
  [/\b(inuman|lakwatsa|sine|sineh|gala|laro|libangan)\b/i, "fun"],
  [/\b(pasalubong|regalo|handa|libre|nilibre)\b/i, "treat"],
  [/\b(parking|paradahan)\b/i, "parking"],
  [/\b(kuryente|tubig|bayarin|bills)\b/i, "bills"],
];

/**
 * What an item word means in English, or empty when nothing matched.
 *
 * Returns a hint rather than an item name. The caller matches the hint
 * against the owner's real list, so this can never put an item on a row that
 * the owner does not have.
 */
export function itemHintIn(text: string): string {
  for (const [pattern, english] of THINGS) {
    if (pattern.test(text)) return english;
  }
  return "";
}

/**
 * When it happened, in Filipino.
 *
 * `kanina` is the one that matters most: it means earlier today, and it is
 * how most of these sentences are dated. Getting it wrong by a day is the
 * kind of error that survives into a monthly total unnoticed.
 */
export const DAY_WORDS: readonly (readonly [RegExp, number])[] = [
  [/\bkamakalawa\b/i, -2],
  [/\bkahapon\b/i, -1],
  [/\b(kanina|ngayon|ngayong araw|kanina lang|kaninang umaga|kaninang hapon)\b/i, 0],
];

/**
 * How many days back a Filipino day word points, or null when none is there.
 *
 * Longest first in the list above, so "kamakalawa" is not read as "kahapon".
 */
export function daysBackIn(text: string): number | null {
  for (const [pattern, back] of DAY_WORDS) {
    if (pattern.test(text)) return back;
  }
  return null;
}
