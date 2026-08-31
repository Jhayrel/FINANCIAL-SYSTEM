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
): ChatMessage {
  const at = new Date().toISOString();
  return {
    id: messageId(at),
    at,
    role,
    text: redact(text).slice(0, MAX_TEXT),
    ...(from ? { from: from.slice(0, 80) } : {}),
  };
}

/** Oldest first, which is the only order a conversation reads in. */
export const byOldest = (a: ChatMessage, b: ChatMessage): number =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id);
