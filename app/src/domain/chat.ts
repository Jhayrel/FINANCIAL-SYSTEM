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
    // Trimmed before the filter: `Boolean` keeps a line of spaces, which
    // then renders as an empty row in the container.
    .map((line) => redact(line).trim().slice(0, 300))
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
