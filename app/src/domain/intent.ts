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
  /^(how|what|whats|what's|wat|wht|why|when|where|who|which|wich|whcih|whose|did|do|does|is|are|was|were|can|could|should|shall|will|would|am|have|has|had|any|show|tell|list|compare|explain|expalin|explian)\b/i;

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

/**
 * Is this phrased as a question, whatever else is in it.
 *
 * Narrower than `detectIntent`, and used for a different decision. Reading a
 * sentence against the ledger is cheap and offline, so the caller tries it on
 * anything that is not obviously a question, rather than only on what this
 * file could recognise from the words alone.
 *
 * That is what "I gas today usual ammount cash" needed. It has no verb, so
 * `detectIntent` called it a question and it never reached the reader, which
 * would have recognised Gas and Cash immediately.
 */
/**
 * Asking for something, anywhere in the sentence.
 *
 * ── The entry that should never have existed ──────────────────────────────
 *
 *   14:48:04  "give me insights oif all transaction under treat this may to
 *              august 2026"
 *   14:48:18  "all, under treat"
 *   14:48:27  "I said all"
 *   14:48:37  "ok maya"
 *   14:48:53  "what is this???"
 *   14:49:04  rejected: 2026-08-29 Transfer PHP 2,026.00
 *
 * A request for insights became a card proposing a two thousand peso
 * transfer, built out of the year in the date range. Five messages of
 * increasing bewilderment, then a rejection.
 *
 * `ASKING` is anchored at the start of the sentence, and none of these begin
 * with one of its words. "give me insights" opens with a verb; "I want to
 * know how much" opens with a pronoun. Both are plainly requests, and both
 * were read as things that had happened.
 *
 * Phrases, not bare words, and this matters: "give me" is a request and "I
 * give 1000 to my friend" is an entry, and they share a verb.
 */
const REQUESTING =
  /\b(?:give me|show me|tell me|make me|draw me|send me a|i want to know|i want insight|i want an? insight|i want summary|i want a summary|i need to know|how much|how many|insights? (?:of|on|about|for)|review the|summar(?:y|ise|ize))\b/i;

/**
 * Asking for advice, which does not have to start the sentence.
 *
 * ── The two rows this exists to stop ──────────────────────────────────────
 *
 * "I have 20000 saved and tuition is 18000 next month, what should I do"
 * became two ledger entries:
 *
 *   2026-09-05 Spending School    PHP 20,000.00
 *   2026-09-05 Spending Parking   PHP 20,000.00
 *
 * Neither of those happened. It is a question about a decision, and the whole
 * point of the assistant being an adviser is that it answers rather than
 * files. `ASKING` is anchored to the start of the sentence, and this one
 * opens with "I have", so nothing recognised it as a question at all.
 *
 * Advice is asked for in the middle and at the end far more often than at the
 * beginning, because the figures come first and the question follows them.
 * So these are matched anywhere.
 */
const ADVICE =
  /\b(what should i|should i|shall i|what would you|what do you think|do you think i|any advice|advise me|is it (?:good|bad|wise|smart|ok|okay|worth|better)|is that (?:good|bad|wise|worth|better)|worth it|help me decide|ano ang dapat|dapat ba)\b/i;

/**
 * Asking what to do, which outranks everything a sentence also contains.
 *
 * ── Why this is separate from `isQuestion` ────────────────────────────────
 *
 * The scoreboard found three more sentences of the kind that once filed
 * "what should I do" as two PHP 20,000 rows:
 *
 *   should I go to mcdonalds today spend 30k?
 *   is it worth it to buy a 5000 phone now
 *   if i spend today 1000 is it good? I can adjust my budget
 *
 * Each is recognised as a question, and each also reads as a complete entry,
 * because it has a verb, a figure and something bought. The app checks for an
 * entry first, so all three would have been filed. An ordinary question mark
 * does not settle that, since people put one on an entry they are unsure of.
 * Asking whether to do something does settle it: nobody asks "should I" about
 * money that has already moved.
 */
export const isAdvice = (text: string): boolean => ADVICE.test(text.trim());

/**
 * An instruction to change a budget, which the assistant does not carry out.
 *
 * "add buget same as last month" came back as "Dropped it.": the misspelling
 * hid the word, a half-read entry was waiting for an amount, and the sentence
 * was taken as the end of that entry. Budgets are set on the Budget screen,
 * not by the assistant (spec: the assistant writes transactions only), so the
 * answer is where to do it, and the entry being asked about stays as it was.
 *
 * Misspellings are matched because they are how it gets typed. A question
 * about a budget ("how is my budget") is a question, and is left alone.
 */
const BUDGET_WORD = /\b(?:budget|buget|budgt|budjet|bugdet|bajet|budgets|budgeting)\b/i;
const BUDGET_VERB =
  /\b(?:set|add|make|create|change|raise|lower|increase|decrease|cut|copy|use|put|update|adjust|edit|same as|like last|as last|reset|lock|close)\b/i;

export function isBudgetCommand(text: string): boolean {
  const said = text.trim();
  if (!said || said.length > 120) return false;
  if (!BUDGET_WORD.test(said)) return false;
  if (said.endsWith("?") || ASKING.test(said) || REQUESTING.test(said) || ADVICE.test(said)) return false;
  return BUDGET_VERB.test(said);
}

/**
 * "paid all my bills": every bill still open this month, each as its own card.
 *
 * It has no figure and names no bill, so it read as an entry with nothing in
 * it and asked "How much was it?", which has no one answer. The bills it
 * means are known, and so is what each cost last time.
 */
export function wantsAllBillsPaid(text: string): boolean {
  const said = text.trim();
  if (!said || said.length > 80 || said.endsWith("?")) return false;
  if (/\d/.test(said)) return false;
  return /\b(?:paid|pay|settled|done with)\b.*\b(?:all|every|each)\b.*\b(?:bills?|subscriptions?|subs)\b/i.test(said);
}

export function isQuestion(text: string): boolean {
  /**
   * Leading punctuation is not part of the question.
   *
   * ". how is this week going" was typed for real and read as nothing,
   * because `ASKING` is anchored to the start of the sentence and the start
   * was a full stop. A stray character before the first word changes nothing
   * about what was asked.
   */
  const trimmed = text.trim().replace(/^[^a-z0-9]+/i, "");
  if (!trimmed) return true;
  return (
    trimmed.endsWith("?") ||
    ASKING.test(trimmed) ||
    REQUESTING.test(trimmed) ||
    ADVICE.test(trimmed)
  );
}
