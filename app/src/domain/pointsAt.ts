/**
 * What a question means by "earlier", "that" or "the treat".
 *
 * 3 October 2026, the owner, after adding a ₱375.00 treat that day:
 * "Does my treat earlier unconstitutional?" and "Like I was invited urgently
 * earlier, what can you advice?". The second was answered "I recommend
 * allocating PHP 4,500.00 for the urgent invitation", a sum nobody said:
 * the invitation was the treat, already spent. The conversation was there
 * for the model to read and it did not connect them, so the device does it
 * and says so in the figures: the newest entry the words point at, and,
 * when the question gives no amount, that it gave none.
 */
import { addDays } from "./dates";
import { formatMoney } from "./money";
import type { IsoDate, Transaction } from "./types";

const POINTING = /\b(?:earlier|kanina|kaninang|a while ago|just now|that|this|it|the same|yung|iyon|ito|i was|i got|we were)\b/i;
const QUIET = new Set(["the", "and", "for", "from", "with", "today", "earlier", "spent", "paid", "this", "that", "what", "can", "you", "advice", "advise", "was", "were", "like", "does", "did", "my", "your"]);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !QUIET.has(w));

/** The section for the model, or no lines when the question points at nothing recent. */
export function pointsAt(question: string, transactions: readonly Transaction[], asOf: IsoDate): string[] {
  if (!question.trim() || !POINTING.test(question)) return [];
  const since = addDays(asOf, -1);
  const recent = transactions
    .filter((t) => t.date >= since && t.date <= asOf && !(t as Transaction & { deletedAt?: string }).deletedAt)
    .sort((a, b) => b.recordNumber - a.recordNumber);
  if (recent.length === 0) return [];
  const said = new Set(words(question));
  const named = recent.find((t) => words(`${t.item} ${t.description}`).some((w) => said.has(w) || said.has(w.replace(/s$/, ""))));
  const earlier = /\b(?:earlier|kanina|kaninang|a while ago|just now|i was|i got|we were)\b/i.test(question);
  const row = named ?? (earlier ? recent.find((t) => t.date === asOf) ?? recent[0] : undefined);
  if (!row) return [];
  const where = row.type === "Revenue" ? `into ${row.toWallet}` : row.fromWallet ? `out of ${row.fromWallet}` : "";
  const why = named ? "the newest entry it names" : "the newest entry today";
  const noAmount = !/\d/.test(question);
  return [
    "## What the question points at",
    `Most likely #${String(row.recordNumber).padStart(4, "0")}, ${why}: ${row.type} ${row.item || row.category} ${formatMoney(row.total).replace(/^₱/, "PHP ")} on ${row.date}${where ? ` ${where}` : ""}${row.description ? `, "${row.description}"` : ""}. Answer about it unless the question plainly means something else.`,
    ...(noAmount ? ["The question gives no amount: never assume one. Work from that entry's figure and what the wallets hold."] : []),
  ];
}
