/**
 * An entry this device reads with certainty, so no model is waited on.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026: "I buy food 100" took 25 seconds to become a
 * card. It waited on two model calls in turn: one to sort the message ("buy"
 * was not a word for money that has moved, so it was not plainly an entry),
 * then one to read it, three models raced and the stronger held for. The
 * card that came back was the one this device reads in a millisecond: Food,
 * the amount said, from Cash, today.
 *
 * Cards are the device's (the AI-first rule of 28 September 2026 is for
 * answers; "actions stay the device's"), and the owner checks every card
 * before it is added. So a message this device reads whole makes its card at
 * once. "Whole" is strict, because a quick wrong card is worse than a slow
 * right one:
 *
 * - one entry, typed, said as done, never a question, a plan or a what-if;
 * - one figure, the amount, and no other number;
 * - money out or in with its kind named in the words ("food" for Food, or a
 *   word the owner's own entries of that kind use), and its wallet; never a
 *   transfer, which often carries a fee the words leave out;
 * - no debt, nothing on someone's behalf, no run of days;
 * - and every word accounted for: the verb, the kind, the wallet, the day,
 *   and the small words between. One word left over ("for mom", "split
 *   with Ana") and the model reads it, as before.
 */
import { isPlan, isQuestion } from "./intent";
import { readEntry, splitEntries } from "./readEntry";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

/** How a sentence says money moved, now or before, in either language. */
const VERBS = new Set(
  (
    "buy buys bought purchase purchased spend spends spent pay pays paid receive receives received recieved got get gets earned earn " +
    "send sends sent transfer transfers transferred withdraw withdrew withdrawn deposit deposited cashed ate eat " +
    "bili bumili binili bumibili bayad nagbayad binayaran gastos nagastos ginastos gumastos natanggap tanggap nagpadala padala"
  ).split(" "),
);

/** The small words between, and the ways of saying today. */
const FILLER = new Set(
  (
    "i i've ive me my mine a an the some of for on in at to with using via from into by worth pesos peso php p just already " +
    "today now this morning afternoon evening tonight yesterday last night ago " +
    "ako ko ng sa na po ang si kay para gamit galing kanina ngayon kahapon kagabi umaga hapon gabi lang"
  ).split(" "),
);

/** Saying it has not happened yet, or might not. */
const NOT_DONE = /\b(?:will|gonna|going\s+to|plan\w*|tomorrow|later|next|soon|bukas|mamaya|if|kung|should|could|would|can|want|need|maybe|baka|not|didn'?t|don'?t|hindi|di|wala|half|split|each|per|every|and|then|also|tapos|at\s+saka)\b/i;

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);

export function certainEntry(text: string, transactions: readonly Transaction[], reference: ReferenceLists, asOf: IsoDate): boolean {
  const t = text.trim();
  if (!t || t.length > 120 || /[?\n,;]/.test(t) || isQuestion(t) || isPlan(t) || NOT_DONE.test(t)) return false;
  if (splitEntries(t).length !== 1) return false;
  const all = words(t);
  if (all.length > 12) return false;
  // One figure, the amount: "food 100", never "food 100 50" or "100 on the 3rd".
  const numbers = (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).length;
  if (numbers !== 1) return false;
  const read = readEntry(t, transactions, reference, asOf);
  if (!read.worthOffering || read.readsAsDebt || read.passThrough || read.interestUnstated) return false;
  const d = read.draft;
  if (!d.amount || d.amount <= 0 || d.coversTo) return false;
  // Money out or in only: a transfer often carries a fee the words leave out, which the model asks about.
  if (d.flow === "Spending" ? !d.fromWallet.trim() || !d.item.trim() : d.flow === "Revenue" ? !d.toWallet.trim() || !d.item.trim() : true) return false;
  // Every word accounted for.
  const own = new Set([...words(d.item), ...words(d.fromWallet), ...words(d.toWallet), ...words(d.category)]);
  const sameKind = transactions.filter((r) => r.item.trim().toLowerCase() === d.item.trim().toLowerCase()).map((r) => ` ${words(`${r.description} ${r.notes}`).join(" ")} `);
  const usedForIt = (w: string): boolean => w.length >= 3 && sameKind.filter((s) => s.includes(` ${w} `)).length >= 2;
  const left = all.filter((w) => !/^\d/.test(w) && !VERBS.has(w) && !FILLER.has(w) && !own.has(w) && !usedForIt(w));
  return left.length === 0;
}
