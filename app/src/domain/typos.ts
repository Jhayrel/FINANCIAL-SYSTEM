/**
 * The command words, spelled the way they were meant.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every rule in the chat that decides what a message wants reads words:
 * "change", "budget", "restore", "september". The owner types fast on a
 * phone, and on 26 September 2026 "chnage the budget last month" matched
 * none of them, so it fell through to the entry reader ("I could not find an
 * entry in that") and then to the model, which said it could not change the
 * budget. "how about add it to sseptember to december" lost its month the
 * same way.
 *
 * This fixes a small set of words the rules depend on, and only when a typed
 * word is one keystroke away from one of them: a letter swapped, doubled,
 * dropped or changed. It is applied to the copy the rules read, never to what
 * is shown or stored, so nothing the owner wrote is rewritten.
 *
 * ── What it will not touch ────────────────────────────────────────────────
 *
 * A real word that happens to sit one keystroke from a command word is left
 * alone: "charge" is a debt's charge, not a misspelled "change", and "chance"
 * is a chance. Words shorter than five letters are left alone too, because at
 * that length one keystroke turns most words into other words.
 */

/** The words the chat's rules read, which are worth correcting towards. */
const COMMAND_WORDS = [
  "change",
  "update",
  "budget",
  "delete",
  "restore",
  "remove",
  "export",
  "download",
  "limit",
  "correct",
  "apply",
  "recover",
  "investigate",
  "balance",
  "spreadsheet",
  "backup",
  "statement",
  "january",
  "february",
  "march",
  "april",
  "august",
  "september",
  "october",
  "november",
  "december",
  "month",
  "months",
  "monthly",
  "every",
  "until",
  "through",
] as const;

/** Real words one keystroke from a command word, which mean themselves. */
const REAL_WORDS = new Set([
  "charge",
  "charged",
  "charges",
  "chance",
  "changed",
  "changes",
  "updated",
  "updates",
  "deleted",
  "restored",
  "removed",
  "exports",
  "limits",
  "limited",
  "applied",
  "balances",
  "budgets",
  "budgeted",
  "mouth",
  "marches",
  "march",
  "everyday",
  "event",
  "ever",
  "enter",
  "bridget",
  "gadget",
  "remote",
  "expert",
  "experts",
  "apple",
  "apples",
  "amply",
  "mouths",
  "budge",
  "reset",
  "balanced",
  "limbo",
  "correcting",
]);

/** Optimal string alignment distance, capped: only "is it one keystroke" matters here. */
function oneAway(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min((d[i - 1]?.[j] ?? 0) + 1, (d[i]?.[j - 1] ?? 0) + 1, (d[i - 1]?.[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (d[i - 2]?.[j - 2] ?? 0) + 1);
      }
      (d[i] as number[])[j] = best;
    }
  }
  return (d[rows - 1]?.[cols - 1] ?? 99) === 1;
}

/** The command word a typed word was meant to be, or the word itself. */
export function meant(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length < 5 || REAL_WORDS.has(lower) || (COMMAND_WORDS as readonly string[]).includes(lower)) return word;
  const hits = COMMAND_WORDS.filter((w) => oneAway(lower, w));
  // Two command words equally close is a guess, and a guess is not a correction.
  return hits.length === 1 ? (hits[0] as string) : word;
}

/**
 * The sentence with its command words spelled right, for the rules to read.
 *
 * Only letters are looked at; figures, punctuation and spacing come through
 * exactly as typed, so an amount can never be changed by this.
 */
export function withCommandWordsFixed(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => meant(word));
}
