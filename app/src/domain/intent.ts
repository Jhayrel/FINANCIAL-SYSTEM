/**
 * Is this message a question, or an entry?
 *
 * ── Why this is decided here and not by the model ─────────────────────────
 *
 * "How much did I spend on food" and "I spent 100 on food" want completely
 * different things to happen, and asking a model which one it is costs a
 * network round trip before any work starts, gets it wrong occasionally, and
 * gets it wrong invisibly.
 *
 * So the guess is made locally, from the words themselves, in about a
 * microsecond. It is shown on a chip above the box before you press anything,
 * and one tap changes it. A visible wrong guess you can correct beats an
 * invisible right one.
 *
 * ── Why it errs towards a question ────────────────────────────────────────
 *
 * Guessing "question" when it was an entry costs a sentence you did not want.
 * Guessing "entry" when it was a question puts a card in front of you with an
 * Add button on it. Neither saves anything, but only one of them puts a
 * button near your ledger that you were not asking for, so the rule requires
 * real evidence before it says entry: an amount and a verb that moves money,
 * and nothing that reads as asking.
 */

export type Intent = "ask" | "log";

/**
 * Words that open a question, even without a question mark.
 *
 * People drop the punctuation constantly ("how much did I spend on food"), so
 * the mark alone is not enough to go on.
 */
const ASKING =
  /^(how|what|whats|what's|why|when|where|who|which|whose|did|do|does|is|are|was|were|can|could|should|shall|will|would|am|have|has|had|any|show|tell|list|compare|explain)\b/i;

/**
 * Verbs that move money.
 *
 * Present and past, because both get typed. "Add" is here because "add 100
 * cash food" is how this gets used once the novelty wears off.
 */
const MOVING =
  /\b(spent|spend|spending|paid|pay|paying|bought|buy|purchased|paid for|cost|got|received|receive|earned|sent|send|transferred|transfer|added|add|log|logged|record|withdrew|withdraw|deposited|deposit|gave|given|borrowed|lent|loaded|reload|topped up|top up|refunded)\b/i;

/**
 * A figure that could be money.
 *
 * Two or more digits, or one digit with a decimal, so a stray "1" in a
 * sentence does not turn a question into an entry. Thousands separators and
 * a peso sign are allowed because that is how amounts get typed.
 */
const AMOUNT = /(?:₱|php)?\s*\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:₱|php)?\s*\d+\.\d+|(?:₱|php)?\s*\d{2,}/i;

/**
 * Something that has already happened.
 *
 * This is the signal that carries on its own, without an amount, because
 * "I have paid my load today" is a completed transaction with one detail left
 * out rather than a question about loads. The missing amount is then asked
 * for (see `domain/capture.ts`), which is the whole point: reporting
 * something you did should start an entry even when you were vague about it.
 *
 * Present tense is deliberately not here. "I pay rent monthly" and "remind me
 * to pay electricity" are not entries, and both would be caught by a looser
 * rule.
 */
const HAPPENED =
  /\b(spent|paid|bought|purchased|received|earned|sent|transferred|withdrew|deposited|gave|borrowed|lent|loaded|refunded|topped up)\b/i;

/** What this message most likely wants. */
export function detectIntent(text: string): Intent {
  const trimmed = text.trim();
  if (!trimmed) return "ask";

  // An explicit question is a question, whatever else is in it.
  if (trimmed.endsWith("?")) return "ask";
  if (ASKING.test(trimmed)) return "ask";

  // Something done: an entry, whether or not the figure was mentioned.
  if (HAPPENED.test(trimmed)) return "log";

  // Otherwise it takes both: a figure, and a verb that moves it.
  return AMOUNT.test(trimmed) && MOVING.test(trimmed) ? "log" : "ask";
}
