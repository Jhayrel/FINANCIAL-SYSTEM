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

import { duplicatesOf, togetherAsOne } from "./duplicates";
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
    /*
     * One ledger row answers for one picture row: two lunches of the same
     * price are two. A transfer has two ends, and each can appear once: GCash
     * showing ₱9,990.00 sent and Maya showing ₱9,980.00 received are the one
     * transfer #3830 (28 September 2026).
     */
    const side = d.flow === "Revenue" || (!d.fromWallet.trim() && d.toWallet.trim()) ? "in" : "out";
    const key = (t: Transaction): string => (t.type === "Transfer" ? `${t.id}|${side}` : t.id);
    const match = duplicatesOf(d, transactions).find((m) => !used.has(key(m.row)) && !(m.also ?? []).some((t) => used.has(key(t))));
    if (match) {
      used.add(key(match.row));
      for (const t of match.also ?? []) used.add(key(t));
      already.push({ index, record: match.row.recordNumber });
    } else {
      missing.push(index);
    }
  });

  /*
   * Rows the picture lists apart that are one row here: ₱204.00, ₱102.00 and
   * ₱102.00 of load were the ledger's ₱408.00 "Buy load" (2 October 2026),
   * and all three were called new (`togetherAsOne`).
   */
  const rowIds = new Set([...used].map((k) => k.split("|")[0] ?? k));
  const grouped = togetherAsOne(drafts, transactions, (i) => !missing.includes(i), rowIds);
  /** Each group once, as its record and the places of its rows. */
  const groups = new Map<number, number[]>();
  for (const [index, match] of grouped) {
    groups.set(match.row.recordNumber, [...(groups.get(match.row.recordNumber) ?? []), index]);
    already.push({ index, record: match.row.recordNumber });
  }
  for (let k = missing.length - 1; k >= 0; k -= 1) if (grouped.has(missing[k] as number)) missing.splice(k, 1);
  already.sort((a, b) => a.index - b.index);
  const amountsOf = (indexes: readonly number[]): string => {
    const figures = indexes.map((i) => formatMoney(drafts[i]?.amount ?? 0));
    return figures.length <= 1 ? (figures[0] ?? "") : `${figures.slice(0, -1).join(", ")} and ${figures[figures.length - 1]}`;
  };
  const shown = new Set<number>();
  const alreadyLines = already.flatMap((a) => {
    const group = groups.get(a.record);
    if (!group || !group.includes(a.index)) return [`- ${label(drafts[a.index] as Draft)}: ${pad(a.record)}`];
    if (shown.has(a.record)) return [];
    shown.add(a.record);
    const total = group.reduce((sum, i) => sum + (drafts[i]?.amount ?? 0), 0);
    const first = drafts[group[0] as number] as Draft;
    return [`- ${amountsOf(group)} ${first.description.trim() || first.item.trim() || first.flow}, ${day(first.date)}: together ${pad(a.record)}, ${formatMoney(total)} as one row`];
  });

  const nl = "\n";
  const counted = already.length + missing.length;
  const words =
    counted === 0
      ? "I could not read any rows with an amount in that picture, so there is nothing to check. A clearer screenshot of the list usually works."
      : missing.length === 0
        ? `All ${counted} ${counted === 1 ? "row is" : "rows are"} already in the ledger:${nl}${alreadyLines.join(nl)}`
        : already.length === 0
          ? `None of the ${counted} ${counted === 1 ? "row is" : "rows are"} in the ledger yet. ${counted === 1 ? "It is" : "Each is"} below as a card to add.`
          : [
              `**${already.length} of ${counted}** are already in the ledger:`,
              ...alreadyLines,
              `**${missing.length}** ${missing.length === 1 ? "is" : "are"} not, and ${missing.length === 1 ? "is" : "are"} below as ${missing.length === 1 ? "a card" : "cards"} to add:`,
              ...missing.map((i) => `- ${label(drafts[i] as Draft)}`),
            ].join(nl);
  return { already, missing, words };
}
