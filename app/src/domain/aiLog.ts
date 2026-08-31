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
): Map<string, string> {
  const learned = new Map<string, string>();

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

    learned.set(from, to);
  }

  return learned;
}

/** Newest first, which is the only order this is read in. */
export const byNewest = (a: AiEvent, b: AiEvent): number =>
  a.at < b.at ? 1 : a.at > b.at ? -1 : b.id.localeCompare(a.id);
