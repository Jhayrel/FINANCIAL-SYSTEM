/**
 * A flagged row, explained, and kept as it is without moving any money.
 *
 * The owner, 26 October 2026, on the Database's Needs review: "my balance is
 * already correct ... if I corrected this my balances either change or add
 * or lessen. Add an 'i' icon before the pencil ... I can see a summary of the
 * problem, because this is for review but I am confused what am I reviewing,
 * what's the problem". So each flag says what was noticed, why it matters,
 * what fixing it would move, and that keeping it moves nothing.
 *
 * Keeping it is a note (`KEPT_NOTE`) and nothing else: the amount, fee,
 * total, wallets, item and date stay as they are, so no balance, no spending
 * and no budget changes. The checks stop listing a finding once every row in
 * it carries the note, so rows flagged together are kept together.
 */
import { KEPT_NOTE, todoFor, type Issue, type IssueCode } from "./integrity";
import { reviewFixes } from "./reviewFixes";
import type { IsoDate, Transaction } from "./types";

/** Why each kind of finding matters, in a sentence the owner can act on. */
const WHY: Record<IssueCode, string> = {
  "fee-inside-withdrawal":
    "A machine usually charges a fee. If it did, Cash only got what the machine gave, and the fee is spending. Saved as one amount, Cash counts the fee as cash you have.",
  "below-zero-day":
    "A real wallet cannot go below zero, and on that day this one would have. Money that came in before then is probably missing or dated later. If your wallets show the right amounts today, the totals are fine.",
  "total-mismatch": "The total is not the amount plus the fee, so two screens can disagree on what it cost.",
  "uncategorised-fee": "Without an item it cannot be counted under the right kind of spending or its limit.",
  "missing-category": "Without an item it cannot be counted under the right kind of spending or its limit.",
  "missing-item": "Without an item it cannot be counted under the right kind of spending or its limit.",
  "fee-row-with-amount": "A fee saved as a row of its own, with an amount, can be counted twice.",
  "no-wallet": "Without a wallet no balance moves, so a wallet shows more or less than it holds.",
  "spending-without-source": "Without the wallet it came out of, no balance goes down for it.",
  "revenue-without-destination": "Without the wallet it went into, no balance goes up for it.",
  "negative-amount": "A minus amount turns the money the other way.",
  "transfer-same-wallet": "Money from a wallet to the same wallet does not move anywhere.",
  "debt-same-wallet": "Money from a wallet to the same wallet does not move anywhere.",
  "duplicate-record-number": "Two rows share one number, so one of them may be a copy.",
};

export interface FlagExplained {
  /** One line, for hovering over the "i". */
  readonly summary: string;
  /** What was noticed and why it matters, one pair per finding. */
  readonly problems: readonly { readonly what: string; readonly why: string }[];
  /** What fixing it would do to the money, worked out (`reviewFixes`), or what to do when no fix is ready. */
  readonly fix: string;
  /** The rows kept together with this one, itself included. */
  readonly keepRows: readonly Transaction[];
  /** The rows as they would be kept: the note added, nothing else. Empty when keeping is refused. */
  readonly kept: readonly Transaction[];
  /** What keeping it does, or why it cannot be kept as it is. */
  readonly keep: string;
}

/** "₱218.00 into Cash ... saved as one amount." without the advice after it. */
export const firstSentence = (text: string): string => text.split(/(?<=[.!?])\s+(?=[A-Z])/)[0] ?? text;

const no = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;

/** A row with the kept note and nothing else changed. */
export function keptAsIs(t: Transaction): Transaction {
  return t.notes.includes(KEPT_NOTE) ? t : { ...t, notes: [t.notes.trim(), KEPT_NOTE].filter(Boolean).join(" ") };
}

/** One line for hovering over the "i", without working out any fix. */
export function flagSummary(issues: readonly Issue[]): string {
  const first = issues[0];
  return first ? `${firstSentence(first.message)}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ""} Tap for what it means and what to do.` : "";
}

export function explainFlag(
  row: Transaction,
  issues: readonly Issue[],
  transactions: readonly Transaction[],
  context: { readonly wallets: readonly string[]; readonly asOf: IsoDate },
): FlagExplained {
  const byId = new Map(transactions.map((t) => [t.id, t] as const));
  // The first sentence: the rest of a check's message is advice, which the fix and keep lines say.
  const problems = issues.map((i) => ({ what: firstSentence(i.message), why: WHY[i.code] }));

  // Every row in the same findings: kept one at a time, the finding would still list the other.
  const ids = [...new Set([row.id, ...issues.flatMap((i) => i.ids)])];
  const keepRows = ids.map((id) => byId.get(id)).filter((t): t is Transaction => t !== undefined);

  /*
   * The database takes a row only when its total is its amount plus its fee
   * (`firestore.rules`). Keeping one that breaks it would be refused, and
   * putting it right moves money, so that is a fix, not a keep.
   */
  const refused = keepRows.filter((t) => t.total !== t.amount + t.fee);
  const others = keepRows.filter((t) => t.id !== row.id);
  const keep =
    refused.length > 0
      ? `Keeping it as it is cannot be saved: the total of ${refused.map(no).join(", ")} is not its amount plus its fee, and the database refuses that. Edit it and save once.`
      : `Nothing moves: no balance, no spending and no budget changes. A note says you checked it, and Needs review stops listing ${keepRows.length > 1 ? "them" : "it"}.${
          others.length > 0 ? ` It is flagged together with ${others.map(no).join(", ")}, so ${others.length === 1 ? "that one is" : "those are"} kept too.` : ""
        } Choose this when your wallets already show the right amounts.`;

  // What fixing it would do, as the chat's fix card says it: each wallet and month it moves.
  const fixes = reviewFixes(transactions, context).fixes.filter(
    (f) => f.rows.some((r) => r.before.id === row.id) && !f.rows.every((r) => r.after.notes.includes(KEPT_NOTE)),
  );
  const ready = fixes[0];
  const fix = ready
    ? `${ready.words.trim().replace(/[^.]$/, "$&.")}${ready.onlyIf ? ` Fix it only if ${ready.onlyIf}.` : ""}`
    : [...new Set(issues.map((i) => todoFor(i.code)))].join(" ");

  return { summary: flagSummary(issues), problems, fix, keepRows, kept: refused.length > 0 ? [] : keepRows.map(keptAsIs), keep };
}
