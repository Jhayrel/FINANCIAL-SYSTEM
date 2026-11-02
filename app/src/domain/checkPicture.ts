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
  /**
   * Rows the ledger has in another shape: the same money on another day, in
   * another account or as another kind, or the same day and account for a
   * slightly different amount. Reported for the owner to judge, never
   * changed, and not offered as cards, since adding one would count it twice.
   */
  readonly near: readonly { readonly index: number; readonly record: number; readonly why: readonly string[] }[];
  /** Ledger rows of the account the list is for, inside its days, that the list does not show. */
  readonly notShown: readonly number[];
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

const daysApart = (a: string, b: string): number => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const walletOf = (d: { readonly fromWallet: string; readonly toWallet: string }, side: "in" | "out"): string => (side === "in" ? d.toWallet : d.fromWallet).trim();

/** What differs between a picture's row and the ledger row it is taken for: the day, the account, the kind. */
function differences(d: Draft, side: "in" | "out", t: Transaction): string[] {
  const wallet = walletOf(d, side);
  const theirs = walletOf(t, side) || walletOf(t, side === "in" ? "out" : "in");
  const why: string[] = [];
  if (t.date !== d.date) why.push(`the ledger has it on ${day(t.date)}, the picture on ${day(d.date)}`);
  if (wallet && theirs && theirs.toLowerCase() !== wallet.toLowerCase()) why.push(`the ledger has it in ${theirs}, the picture in ${wallet}`);
  if (d.flow && t.type !== d.flow && !(d.flow === "Spending" && t.type === "Transfer" && !t.toWallet.trim())) why.push(`the ledger has it as ${t.type}, the picture reads as ${d.flow}`);
  return why;
}

/**
 * The ledger row a picture's row most likely is, when no row matches it
 * exactly, and what differs. The same amount within a week, or the same day
 * and account within a tenth of the amount. "Find a difference" (owner, 1
 * November 2026): "it can recognize everything wrong".
 */
function nearMiss(d: Draft, side: "in" | "out", transactions: readonly Transaction[], taken: ReadonlySet<string>): { row: Transaction; why: string[] } | null {
  const amount = d.amount ?? 0;
  const wallet = walletOf(d, side);
  let best: { row: Transaction; why: string[]; score: number } | null = null;
  for (const t of transactions) {
    if (taken.has(t.id) || (t as Transaction & { deletedAt?: string }).deletedAt) continue;
    const theirs = walletOf(t, side) || walletOf(t, side === "in" ? "out" : "in");
    const sameMoney = t.amount === amount || t.total === amount;
    const apart = daysApart(t.date, d.date);
    let why: string[] = [];
    let score = 0;
    if (sameMoney && apart <= 7) {
      why = differences(d, side, t);
      score = 100 - apart * 5 - why.length;
    } else if (apart === 0 && wallet && theirs.toLowerCase() === wallet.toLowerCase() && t.type === d.flow && Math.abs(t.amount - amount) <= Math.max(500, Math.round(amount / 10)) && t.amount !== amount) {
      why.push(`the ledger has ${formatMoney(t.amount)}, the picture ${formatMoney(amount)} (${formatMoney(Math.abs(t.amount - amount))} ${t.amount > amount ? "more in the ledger" : "less in the ledger"})`);
      score = 60 - Math.abs(t.amount - amount) / Math.max(1, amount);
    }
    if (why.length === 0) continue;
    if (!best || score > best.score) best = { row: t, why, score };
  }
  return best ? { row: best.row, why: best.why } : null;
}

/** Which rows a picture showed are already recorded. Rows with no amount are not rows. */
export function inLedgerOrNot(drafts: readonly Draft[], transactions: readonly Transaction[]): InLedger {
  const already: { index: number; record: number }[] = [];
  /** An entry found, but not the same in every part: what differs, by the picture row's place. */
  const differ = new Map<number, string[]>();
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
      if (match.certainty !== "same" && !match.also?.length) {
        const why = differences(d, side, match.row);
        if (why.length > 0) differ.set(index, why);
      }
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

  // Not found as it is: the ledger may have it in another shape.
  const takenIds = new Set([...rowIds, ...[...grouped.values()].map((m) => m.row.id)]);
  const near: { index: number; record: number; why: string[] }[] = [];
  for (let k = 0; k < missing.length; k += 1) {
    const index = missing[k] as number;
    const d = drafts[index] as Draft;
    const side = d.flow === "Revenue" || (!d.fromWallet.trim() && d.toWallet.trim()) ? "in" : "out";
    const miss = nearMiss(d, side, transactions, takenIds);
    if (!miss) continue;
    takenIds.add(miss.row.id);
    near.push({ index, record: miss.row.recordNumber, why: miss.why });
    missing.splice(k, 1);
    k -= 1;
  }

  /*
   * A wallet's own list: rows the ledger has for that wallet, inside the
   * days the list shows, that it does not. Only the days strictly between
   * its first and last, since a screenshot can cut a day off at either end.
   */
  const wallets = new Set(drafts.filter((d) => (d.amount ?? 0) > 0).map((d) => (d.flow === "Revenue" || (!d.fromWallet.trim() && d.toWallet.trim()) ? d.toWallet : d.fromWallet).trim().toLowerCase()));
  const dates = drafts.filter((d) => (d.amount ?? 0) > 0).map((d) => d.date).sort();
  const notShown: number[] = [];
  if (wallets.size === 1 && dates.length >= 3) {
    const wallet = [...wallets][0] ?? "";
    const first = dates[0] ?? "";
    const last = dates[dates.length - 1] ?? "";
    for (const t of transactions) {
      if (t.date <= first || t.date >= last || takenIds.has(t.id) || (t as Transaction & { deletedAt?: string }).deletedAt) continue;
      if (t.fromWallet.trim().toLowerCase() !== wallet && t.toWallet.trim().toLowerCase() !== wallet) continue;
      notShown.push(t.recordNumber);
    }
  }
  const amountsOf = (indexes: readonly number[]): string => {
    const figures = indexes.map((i) => formatMoney(drafts[i]?.amount ?? 0));
    return figures.length <= 1 ? (figures[0] ?? "") : `${figures.slice(0, -1).join(", ")} and ${figures[figures.length - 1]}`;
  };
  const shown = new Set<number>();
  const alreadyLines = already.flatMap((a) => {
    const group = groups.get(a.record);
    const why = differ.get(a.index);
    if (!group || !group.includes(a.index)) return [`- ${label(drafts[a.index] as Draft)}: ${pad(a.record)}${why ? `, but ${why.join(", and ")}` : ""}`];
    if (shown.has(a.record)) return [];
    shown.add(a.record);
    const total = group.reduce((sum, i) => sum + (drafts[i]?.amount ?? 0), 0);
    const first = drafts[group[0] as number] as Draft;
    return [`- ${amountsOf(group)} ${first.description.trim() || first.item.trim() || first.flow}, ${day(first.date)}: together ${pad(a.record)}, ${formatMoney(total)} as one row`];
  });

  const nl = "\n";
  const counted = already.length + missing.length + near.length;
  const nearLines = near.length
    ? [
        `**${near.length}** ${near.length === 1 ? "looks like an entry" : "look like entries"} you have, with a difference to check. Edit the entry if the picture is right; nothing was changed:`,
        ...near.map((n) => `- ${label(drafts[n.index] as Draft)}: likely ${pad(n.record)}, but ${n.why.join(", and ")}`),
      ]
    : [];
  const byRecord = new Map(transactions.map((t) => [t.recordNumber, t] as const));
  const notShownLines = notShown.length
    ? [
        `**${notShown.length}** ${notShown.length === 1 ? "entry" : "entries"} in the ledger for those days ${notShown.length === 1 ? "is" : "are"} not in the picture. If the list is the whole of those days, check ${notShown.length === 1 ? "it" : "them"}: the wrong account, or a duplicate:`,
        ...notShown.slice(0, 12).map((r) => {
          const t = byRecord.get(r);
          return t ? `- ${pad(r)}: ${formatMoney(t.total)} ${t.description.trim() || t.item.trim() || t.type}, ${day(t.date)}` : `- ${pad(r)}`;
        }),
        ...(notShown.length > 12 ? [`- and ${notShown.length - 12} more`] : []),
      ]
    : [];
  const main =
    counted === 0
      ? "I could not read any rows with an amount in that picture, so there is nothing to check. A clearer screenshot of the list usually works."
      : missing.length === 0 && near.length === 0
        ? `All ${counted} ${counted === 1 ? "row is" : "rows are"} already in the ledger:${nl}${alreadyLines.join(nl)}`
        : already.length === 0 && near.length === 0
          ? `None of the ${counted} ${counted === 1 ? "row is" : "rows are"} in the ledger yet. ${counted === 1 ? "It is" : "Each is"} below as a card to add.`
          : [
              ...(already.length > 0 ? [`**${already.length} of ${counted}** ${already.length === 1 ? "is" : "are"} already in the ledger:`, ...alreadyLines] : []),
              ...nearLines,
              ...(missing.length > 0
                ? [`**${missing.length}** ${missing.length === 1 ? "is" : "are"} not, and ${missing.length === 1 ? "is" : "are"} below as ${missing.length === 1 ? "a card" : "cards"} to add:`, ...missing.map((i) => `- ${label(drafts[i] as Draft)}`)]
                : []),
            ].join(nl);
  const differing = differ.size > 0 ? [`${differ.size === 1 ? "One entry differs" : `${differ.size} entries differ`} from the picture as marked above. Edit ${differ.size === 1 ? "it" : "them"} if the picture is right; nothing was changed.`] : [];
  const words = counted === 0 ? main : [main, ...differing, ...notShownLines].join(nl);
  return { already, missing, near, notShown, words };
}
