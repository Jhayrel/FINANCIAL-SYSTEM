/**
 * Which earlier question "that" means in "can you show that in chart?".
 *
 * The owner, 9 November 2026: a question about gym sessions, then "can you
 * show me a prediction next month?", answered in words, then "can you show
 * that in chart?". It drew "Spending on Gym by item, the whole ledger". The
 * panel looked back over the last three questions for a subject, found none
 * in the forecast question, and kept going until it found the gym in the one
 * before. "That" is the answer just given, never one two questions back.
 *
 * So the question meant is the newest one asked, past only what is not a
 * question of its own: a shape said on its own ("pie", "bars", "show it as
 * a trend"), a thanks, a greeting, or a plain "ok". If that question has
 * nothing to draw, nothing older is drawn in its place.
 */
import { drawReply, drawsBack } from "./charts";
import { readSmallTalk } from "./smallTalk";

/** "ok", "sige", "nice", "got it", "i see": a reply that asks nothing. */
const NOTHING_ASKED = /^\s*(?:ok(?:ay)?|k|sige|noted|nice|cool|great|good|wow|i see|got it|alright|all right|hmm+|ah+|oh+|yes|yeah|yep|no|nope|oo|opo|hindi)[\s!.,]*$/i;

/** Whether a message is only a reply, with no question of its own to draw from. */
export function asksNothing(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (NOTHING_ASKED.test(t)) return true;
  const small = readSmallTalk(t);
  return small?.kind === "thanks" || small?.kind === "hello";
}

/**
 * The question the message refers back to, from what the owner said, newest
 * first. The message itself is skipped when it is already in the list.
 */
export function questionMeant(saidNewestFirst: readonly string[], message: string): string | null {
  for (const text of saidNewestFirst) {
    if (text === message) continue;
    if ((drawReply(text) ?? drawsBack(text)) !== null) continue;
    if (asksNothing(text)) continue;
    return text;
  }
  return null;
}
