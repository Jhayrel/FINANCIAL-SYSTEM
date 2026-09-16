/**
 * What the assistant was asked, what it answered, and what you did about it.
 *
 * ── Why this is not the activity trail ────────────────────────────────────
 *
 * `domain/activity.ts` records what happened to the money: a row created, an
 * amount changed, an entry binned. It is an audit trail and it answers "who
 * changed this and from what".
 *
 * This records what happened to the assistant: a question typed, a photo
 * read, a card accepted, a card corrected, a card thrown away. Nothing here
 * touches the ledger. It answers a different question, which is whether the
 * thing is any good and where it goes wrong.
 *
 * ── Photos are described, never stored ────────────────────────────────────
 *
 * A picture is a megabyte and a Firestore document is capped at one, so
 * storing them would fill the database with the least useful bytes in it.
 * What gets written is the filename, what kind of thing it turned out to be,
 * its size, and what was read out of it:
 *
 *     123.png, receipt, 240 KB, one entry: Fun, PHP 320.00
 *
 * That is what makes the record worth reading later: not the pixels, but
 * which picture produced which row.
 *
 * ── What "learning" means, precisely ──────────────────────────────────────
 *
 * A correction is a pair: what the assistant proposed, and what you changed
 * it to. Those pairs are the training signal, and `correctionsFrom` turns the
 * log back into a lookup that `domain/infer.ts` consults before it guesses.
 * Tell it once that "Jollibee" is Food and it does not ask again.
 *
 * No model is retrained and nothing is uploaded. The learning is a table of
 * your own corrections, kept in your own database, read on the next sentence.
 */

import { redact } from "./aiRedact";

/** What happened. */
export type AiAction =
  | "asked"
  | "answered"
  | "uploaded"
  | "proposed"
  | "accepted"
  | "edited"
  | "rejected"
  | "cleared";

/**
 * Where in the app it happened.
 *
 * The assistant is not only the panel beside the Add form: the summary on
 * Insights and the alerts on the Dashboard are the same model doing smaller
 * jobs, and "it was wrong" means something different on each screen.
 */
export type AiWhere =
  | "add"
  | "dashboard"
  | "insights"
  | "budget"
  | "statements"
  | "database"
  | "debt"
  | "settings";

/** A file, as a description of itself. Never the bytes. */
export interface AttachmentNote {
  readonly name: string;
  /** What it turned out to be: a receipt, a statement, a photo of food. */
  readonly kind: string;
  readonly bytes: number;
  /** What was read out of it, in one line. */
  readonly details: string;
}

export interface AiEvent {
  readonly id: string;
  readonly at: string;
  readonly action: AiAction;
  readonly where: AiWhere;
  /** What was typed, or what came back. Redacted. */
  readonly text?: string;
  /** The row under discussion, as one line. */
  readonly entry?: string;
  /** For a correction: the field, what was proposed, what it became. */
  readonly field?: string;
  readonly proposed?: string;
  readonly corrected?: string;
  readonly model?: string;
  readonly files?: readonly AttachmentNote[];
}

/** A message is a sentence, and the rule caps it. */
const MAX_TEXT = 2000;
const MAX_LINE = 300;

let counter = 0;

function eventId(at: string): string {
  counter += 1;
  return `${at.replace(/[^0-9]/g, "")}-${counter.toString(36)}`;
}

/**
 * Redacted and capped, and never undefined.
 *
 * `exactOptionalPropertyTypes` is on, so an optional field is either absent
 * or a string: spreading `{ text: undefined }` is a different thing from
 * leaving `text` out, and Firestore refuses the first. Every field below is
 * spread conditionally for that reason.
 */
const line = (v: string, cap = MAX_LINE): string => redact(v).slice(0, cap);

export function aiEvent(
  action: AiAction,
  where: AiWhere,
  extra: {
    readonly text?: string;
    readonly entry?: string;
    readonly field?: string;
    readonly proposed?: string;
    readonly corrected?: string;
    readonly model?: string;
    readonly files?: readonly AttachmentNote[];
  } = {},
): AiEvent {
  const at = new Date().toISOString();
  return {
    id: eventId(at),
    at,
    action,
    where,
    ...(extra.text === undefined ? {} : { text: line(extra.text, MAX_TEXT) }),
    ...(extra.entry === undefined ? {} : { entry: line(extra.entry) }),
    ...(extra.field === undefined ? {} : { field: extra.field.slice(0, 40) }),
    ...(extra.proposed === undefined ? {} : { proposed: line(extra.proposed, 80) }),
    ...(extra.corrected === undefined ? {} : { corrected: line(extra.corrected, 80) }),
    ...(extra.model === undefined ? {} : { model: extra.model.slice(0, 120) }),
    ...(extra.files === undefined
      ? {}
      : {
          files: extra.files.slice(0, 5).map((f) => ({
            name: f.name.slice(0, 120),
            kind: f.kind.slice(0, 40),
            bytes: f.bytes,
            details: line(f.details) ?? "",
          })),
        }),
  };
}

/**
 * The corrections, as a lookup.
 *
 * Only `edited` events with both halves, and only where the correction stuck:
 * the last thing you said a word meant is what it means. Keyed on what was
 * proposed, lowercased, because that is what will be proposed again.
 */
export function correctionsFrom(
  events: readonly AiEvent[],
  field: string,
  /**
   * The names this field already has a meaning for: your accounts for a
   * wallet, your own items for an item, the fixed list for a category.
   *
   * ── What went on screen without this ────────────────────────────────────
   *
   * "What it has learned" was showing three things it had supposedly worked
   * out:
   *
   *   gcash is Cash        cash is Gcash        maya is Cash
   *
   * The first two contradict each other, and all three are nonsense, because
   * none of them is a thing that can be learned. They came from correcting
   * the wallet on a row in the form. A form correction says "this row was
   * wrong", and the pair it records is the old field value against the new
   * one, so correcting one row taught the assistant that the word Gcash means
   * Cash, on every future entry.
   *
   * The guard above only caught a value mapped onto itself. The rule this
   * file already states is the wider one: a mapping is worth keeping only
   * when its key is a term the ledger does not already have a meaning for.
   * That is what this is, and it needs the lists to be able to tell.
   *
   * "Jolibee is Treat" is real learning and survives, because Jolibee is not
   * one of the owner's items: it is a name the assistant invented, and being
   * corrected is how it finds that out. "Gcash is Cash" does not survive,
   * because Gcash is an account and already means itself.
   *
   * Optional, so a caller with no lists to hand gets the old behaviour rather
   * than silently getting nothing.
   */
  known: readonly string[] = [],
): Map<string, string> {
  const learned = new Map<string, string>();
  const already = new Set(
    known.map((name) => name.trim().toLowerCase()).filter((name) => name !== ""),
  );

  // Oldest first, so a later correction replaces an earlier one.
  for (const e of [...events].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    if (e.action !== "edited" || e.field !== field) continue;
    const from = e.proposed?.trim().toLowerCase();
    const to = e.corrected?.trim();
    if (!from || !to) continue;

    /**
     * A correction teaches nothing when it maps one real value onto another.
     *
     * "gas is Food" is what came out of keying the pair on the field's old
     * value rather than on the words that produced it, and applying it would
     * have turned every future Gas entry into Food. A mapping is only worth
     * keeping when its key is a term the ledger does not already have a
     * meaning for, which is exactly the case this is for.
     */
    if (from === to.toLowerCase()) continue;

    /**
     * The key already means something, so the correction is about this row
     * and not about the word. Dropped rather than applied to every future
     * entry that happens to mention it.
     */
    if (already.has(from)) continue;

    learned.set(from, to);
  }

  return learned;
}

/** A figure, which is the part of a sentence that changes between two of the same purchase. */
const FIGURE = /^[0-9][0-9.,]*$/;

/** The words of a sentence, without punctuation or case. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * What a phrase was corrected to, allowing for the parts that change.
 *
 * ── Why the exact lookup was not learning ─────────────────────────────────
 *
 * Corrections are keyed on the sentence that produced the card, and they were
 * read back with a plain `get`. So a correction fired again only when the
 * owner typed the identical sentence, and the parts of a sentence that differ
 * between two of the same purchase are exactly the figure, the date and the
 * wallet. "jollibee 200" taught nothing about "jollibee 350". Told once that
 * Jollibee is Food, it asked again the very next time, which is what the
 * owner meant by saying it was not really learning.
 *
 * A key matches when every word in it that is not a figure appears in the new
 * sentence. The longest key wins, so "coffee beans for the office" beats
 * "coffee" on a sentence containing both, and a correction taught on a figure
 * alone matches nothing but itself: every sentence has figures in it, and one
 * that matched on those would attach itself to unrelated entries.
 */
export function taughtFor(
  phrase: string,
  learned: ReadonlyMap<string, string>,
): string | undefined {
  const said = phrase.trim().toLowerCase();
  if (!said || learned.size === 0) return undefined;

  // The sentence as typed, which is still the strongest signal there is.
  const exact = learned.get(said);
  if (exact) return exact;

  const words = new Set(wordsOf(said));
  if (words.size === 0) return undefined;

  let best: { readonly to: string; readonly weight: number } | undefined;
  for (const [key, to] of learned) {
    const keyWords = wordsOf(key).filter((w) => !FIGURE.test(w));
    if (keyWords.length === 0) continue;
    if (!keyWords.every((w) => words.has(w))) continue;
    if (best === undefined || keyWords.length > best.weight) {
      best = { to, weight: keyWords.length };
    }
  }

  return best?.to;
}

/** Newest first, which is the only order this is read in. */
export const byNewest = (a: AiEvent, b: AiEvent): number =>
  a.at < b.at ? 1 : a.at > b.at ? -1 : b.id.localeCompare(a.id);

/**
 * A manual correction to a row the assistant entered.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The learning reads `correctionsFrom(events, "item")` and applies whatever
 * it finds. After 310 recorded events there were exactly two corrections in
 * the whole database, and neither was an item, so it had learned nothing at
 * all: `correctionsFrom` returned an empty map every time.
 *
 * The reason is where corrections were recorded. Only the chat's own amend
 * path wrote one, so correcting a card by typing "gcash" was remembered and
 * correcting the same field in the form beside it was not. Almost every
 * correction happens in the form.
 *
 * So a saved edit to a row the assistant proposed is a correction, and it is
 * recorded as one. Only for rows it entered: fixing your own typo teaches
 * nothing about its guessing, and would fill the record with noise.
 *
 * `proposed` is what it put there and `corrected` is what you changed it to,
 * which is the pair `correctionsFrom` reads.
 */
export function manualCorrections(
  before: {
    readonly item: string;
    readonly fromWallet: string;
    readonly toWallet: string;
    readonly category: string;
    readonly entrySource?: string | undefined;
  },
  after: {
    readonly item: string;
    readonly fromWallet: string;
    readonly toWallet: string;
    readonly category: string;
    readonly date: string;
    readonly recordNumber: number;
  },
  where: AiWhere,
): AiEvent[] {
  if (before.entrySource !== "ai") return [];

  const fields = ["item", "fromWallet", "toWallet", "category"] as const;

  return fields.flatMap((field) => {
    const was = before[field].trim();
    const now = after[field].trim();
    if (!was || !now || was === now) return [];
    return [
      aiEvent("edited", where, {
        field,
        proposed: was,
        corrected: now,
        entry: `#${after.recordNumber} ${after.date} ${after.item}`,
      }),
    ];
  });
}
