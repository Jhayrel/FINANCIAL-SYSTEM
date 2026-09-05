/**
 * The conversation, kept.
 *
 * ── What is stored, and what is not ───────────────────────────────────────
 *
 * What was said: your messages and the answers. Not the proposal cards. A
 * card is a decision in progress, and once it is decided the entry itself is
 * in the ledger and the fact that the assistant read it is in the activity
 * trail, both of which outlive any conversation. Storing a half-finished form
 * would mean a card that reappears tomorrow offering to add a row you already
 * added.
 *
 * ── Append only, like the activity trail ──────────────────────────────────
 *
 * `firestore.rules` denies update and delete. A conversation that can be
 * quietly rewritten is not a record of anything, and this one carries the
 * questions asked about real money.
 *
 * ── Redacted on the way in ────────────────────────────────────────────────
 *
 * A message is whatever you typed, and what you type sometimes turns out to
 * be an API key you meant to paste somewhere else. `aiRedact` runs before the
 * write, so it never lands at rest. The rules also refuse secret-shaped
 * field names, but a rule can only check keys, not values.
 */

import { redact } from "./aiRedact";
import { MAX_NOTE } from "./photoNote";

export interface ChatMessage {
  readonly id: string;
  /** ISO 8601, UTC. The sort key and the only clock this has. */
  readonly at: string;
  readonly role: "you" | "assistant";
  readonly text: string;
  /** Assistant only: which model, or that this device wrote it. */
  readonly from?: string;
  /**
   * What a photo said, kept in place of the photo.
   *
   * ── Why the picture goes and the words stay ───────────────────────────
   *
   * Photos are never stored: a picture is a megabyte, a document is capped
   * at one, and an image is the least useful byte in a financial database.
   * So on a refresh the picture was simply gone, and the message above it
   * read as a person saying nothing about nothing.
   *
   * A line each instead, in the owner's own words:
   *
   *   IMG_123.png, a receipt: Food, PHP 300.00
   *
   * That is the part worth keeping. It says which file produced which rows,
   * which is the only question anybody asks of a receipt afterwards, and it
   * is a few dozen bytes rather than a megabyte.
   */
  readonly files?: readonly string[];
  /**
   * A chart, as the figures it drew.
   *
   * ── Why a chart is kept and a card is not ─────────────────────────────
   *
   * A card is a decision in progress: storing one means it reappears
   * tomorrow offering to add a row that was already added. A chart is not a
   * decision, it is an answer. Asking to see the year by item and finding
   * the picture gone on the next visit is losing half the conversation,
   * and the half that was hardest to ask for.
   *
   * The figures are stored, not an image. A chart here is at most eight
   * rows of label and centavos, which is smaller than the sentence next to
   * it, and it redraws from the same renderer rather than being a picture
   * of one. Photos remain the one thing never kept: those are described in
   * the AI log and the bytes are thrown away.
   */
  readonly chart?: string;
  /**
   * A proposal card, as the entry it is offering.
   *
   * ── Why this is a change of mind ──────────────────────────────────────
   *
   * Cards were deliberately not stored, and the reasoning was sound at the
   * time: a card is a decision in progress, and one that came back tomorrow
   * would be offering to add a row that had already been added.
   *
   * Two things changed. The owner reads eight cards off a statement, gets
   * interrupted, and a refresh threw all eight away: that is not a stale
   * decision, it is lost work, and they asked for it to stop. And the thing
   * the old reasoning was afraid of now has its own guard: `duplicatesOf`
   * puts a warning on any card whose row is already in the ledger, naming
   * the record and the fields that agree. A card that comes back and would
   * duplicate something says so on its face.
   *
   * So a card is stored, and so is every change to it. The state is replayed
   * rather than updated, because this collection takes creates and refuses
   * updates: a settle writes a second message carrying the same card id and
   * the new state, and the last one wins on load. That keeps the record
   * append only, which is what makes it a record.
   */
  readonly card?: string;
}

/**
 * A card, as it goes into the record and as it comes back.
 *
 * Deliberately loose about the draft: it is stored and replayed, never
 * interpreted here, and pinning its shape in two places is how the two
 * drift apart.
 */
export interface StoredCard {
  readonly id: string;
  /** An ordinary entry, or the two-choice debt card. */
  readonly kind: "proposal" | "debt";
  readonly state: "open" | "added" | "used" | "discarded" | "settled";
  readonly draft: Record<string, unknown>;
  readonly sourceRef?: string;
  readonly confidence?: string;
  readonly adjustments?: readonly string[];
  readonly said?: string;
  /** The number the row was actually given, once it has one. */
  readonly recordNumber?: number;
}

/** A message is a sentence, not a document. */
export const MAX_TEXT = 4000;

let counter = 0;

/**
 * Time plus a counter, not a random string.
 *
 * A question and its answer can land in the same millisecond, and an id
 * collision in an append-only collection is a lost message rather than an
 * error anyone would see.
 */
function messageId(at: string): string {
  counter += 1;
  return `${at.replace(/[^0-9]/g, "")}-${counter.toString(36)}`;
}

export function said(
  role: ChatMessage["role"],
  text: string,
  from?: string,
  /**
   * What any attached photos turned out to be, one line each.
   *
   * Capped and redacted like everything else. Five, matching what one
   * message may carry, and never the bytes.
   */
  files?: readonly string[],
): ChatMessage {
  const at = new Date().toISOString();
  const described = (files ?? [])
    /**
     * Trimmed before the filter: `Boolean` keeps a line of spaces, which
     * then renders as an empty row in the container.
     *
     * `MAX_NOTE` rather than a figure typed here, because it is the length
     * `photoNote.ts` trims to, and two caps that disagree means the trimming
     * happens twice and the second one cuts mid-word.
     */
    .map((line) => redact(line).trim().slice(0, MAX_NOTE))
    .filter((line) => line.length > 0)
    .slice(0, 5);

  return {
    id: messageId(at),
    at,
    role,
    text: redact(text).slice(0, MAX_TEXT),
    ...(from ? { from: from.slice(0, 80) } : {}),
    ...(described.length > 0 ? { files: described } : {}),
  };
}

/**
 * A chart, as a message.
 *
 * The `text` is what the chart says in words, so a reader that knows nothing
 * about charts still sees an answer rather than a blank line, and so the
 * model gets something meaningful when this turn goes back as history.
 *
 * Refuses anything too big to store rather than truncating it: half a chart
 * is a picture that lies, and the sentence still carries the answer.
 */
export function drew(chart: unknown, title: string, summary: string): ChatMessage {
  const at = new Date().toISOString();
  const encoded = JSON.stringify(chart);
  return {
    id: messageId(at),
    at,
    role: "assistant",
    text: redact(`${title}${summary ? `. ${summary}` : ""}`).slice(0, MAX_TEXT),
    from: "this device",
    ...(encoded.length <= MAX_TEXT ? { chart: encoded } : {}),
  };
}

/** The figures back out, or null when the message is not a chart. */
export function drawn(message: ChatMessage): unknown | null {
  if (!message.chart) return null;
  try {
    return JSON.parse(message.chart) as unknown;
  } catch {
    return null;
  }
}

/** Oldest first, which is the only order a conversation reads in. */
export const byOldest = (a: ChatMessage, b: ChatMessage): number =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id);

/**
 * A card, as a message.
 *
 * The `text` says what the card holds in words, so history sent back to the
 * model is meaningful and a reader that ignores the encoded half still sees
 * an entry rather than a blank line.
 *
 * Refused rather than truncated when it will not fit, on the same reasoning
 * as a chart: half a draft is a form that lies about what it read.
 */
export function proposed(card: StoredCard, summary: string): ChatMessage {
  const at = new Date().toISOString();
  const encoded = JSON.stringify(card);
  return {
    id: messageId(at),
    at,
    role: "assistant",
    text: redact(summary).slice(0, MAX_TEXT),
    from: "this device",
    ...(encoded.length <= MAX_TEXT ? { card: encoded } : {}),
  };
}

/** The card back out, or null when the message is not one. */
export function carded(message: ChatMessage): StoredCard | null {
  if (!message.card) return null;
  try {
    const value = JSON.parse(message.card) as StoredCard;
    return value && typeof value.id === "string" && value.draft ? value : null;
  } catch {
    return null;
  }
}

/**
 * Every card in a conversation, in the state it ended in.
 *
 * Replayed rather than looked up: a settle writes a second message with the
 * same id, so the last one carrying an id is the truth about that card. That
 * is what lets the collection stay append only and still hold a card that
 * changed after it was written.
 */
export function cardsIn(messages: readonly ChatMessage[]): ReadonlyMap<string, StoredCard> {
  const byId = new Map<string, StoredCard>();
  for (const message of [...messages].sort(byOldest)) {
    const card = carded(message);
    if (card) byId.set(card.id, card);
  }
  return byId;
}
