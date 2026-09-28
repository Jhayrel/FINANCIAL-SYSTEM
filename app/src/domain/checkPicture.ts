/**
 * "Is this already in?", asked of a picture.
 *
 * 28 September 2026, a Maya history screenshot sent with "Can you check only
 * if this is added?" came back as eight cards to add, one of them for
 * PHP 0.00. The owner wrote "//fix it I am asking not this". They were asking
 * a question about the picture, and the answer is in the ledger: which of its
 * rows are already there, by record number, and which are not. Cards are
 * offered for the missing ones only.
 */

import { duplicatesOf } from "./duplicates";
import type { Draft } from "./entry";
import { formatMoney } from "./money";
import type { Transaction } from "./types";

/** Asking whether rows are already recorded, rather than asking to add them. */
export function asksWhetherAdded(note: string): boolean {
  const text = note.trim();
  if (!text) return false;
  return (
    /\b(?:check|checking|see|verify|confirm|compare)\b[^.]*\b(?:added|recorded|saved|logged|entered|included|in\s+(?:the|my)\s+(?:ledger|database|records?|entries)|already|duplicates?|missing|there)\b/i.test(text) ||
    /\b(?:is|are|was|were|did\s+i|have\s+i)\b[^.]*\b(?:already\s+)?(?:added|recorded|saved|logged|entered|in\s+(?:the|my)\s+(?:ledger|database|records?))\b[^.]*\??/i.test(text) ||
    /\b(?:already\s+(?:added|in|recorded)|duplicates?|what(?:'s| is)\s+missing|which\s+(?:are|is)\s+(?:missing|new|not\s+(?:added|in)))\b/i.test(text)
  );
}

export interface InLedger {
  /** Rows already in the ledger, with the record each one is. */
  readonly already: readonly { readonly index: number; readonly record: number }[];
  /** Rows not found, by their place in the list read off the picture. */
  readonly missing: readonly number[];
  /** The answer, in the owner's words. */
  readonly words: string;
}

const pad = (n: number): string => `#${String(n).padStart(4, "0")}`;
const day = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
const label = (d: Draft): string =>
  `${formatMoney(d.amount ?? 0)} ${d.description.trim() || d.item.trim() || d.flow}, ${day(d.date)}`;

/** Which rows a picture showed are already recorded. Rows with no amount are not rows. */
export function inLedgerOrNot(drafts: readonly Draft[], transactions: readonly Transaction[]): InLedger {
  const already: { index: number; record: number }[] = [];
  const missing: number[] = [];
  const used = new Set<string>();
  drafts.forEach((d, index) => {
    if (d.amount === null || d.amount === 0) return;
    // One ledger row answers for one picture row: two lunches of the same price are two.
    const match = duplicatesOf(d, transactions).find((m) => !used.has(m.row.id));
    if (match) {
      used.add(match.row.id);
      already.push({ index, record: match.row.recordNumber });
    } else {
      missing.push(index);
    }
  });

  const nl = "\n";
  const counted = already.length + missing.length;
  const words =
    counted === 0
      ? "I could not read any rows with an amount in that picture, so there is nothing to check. A clearer screenshot of the list usually works."
      : missing.length === 0
        ? `All ${counted} ${counted === 1 ? "row is" : "rows are"} already in the ledger:${nl}${already.map((a) => `- ${label(drafts[a.index] as Draft)}: ${pad(a.record)}`).join(nl)}`
        : already.length === 0
          ? `None of the ${counted} ${counted === 1 ? "row is" : "rows are"} in the ledger yet. ${counted === 1 ? "It is" : "Each is"} below as a card to add.`
          : [
              `**${already.length} of ${counted}** are already in the ledger:`,
              ...already.map((a) => `- ${label(drafts[a.index] as Draft)}: ${pad(a.record)}`),
              `**${missing.length}** ${missing.length === 1 ? "is" : "are"} not, and ${missing.length === 1 ? "is" : "are"} below as ${missing.length === 1 ? "a card" : "cards"} to add:`,
              ...missing.map((i) => `- ${label(drafts[i] as Draft)}`),
            ].join(nl);
  return { already, missing, words };
}
