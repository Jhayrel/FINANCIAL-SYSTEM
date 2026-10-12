/**
 * Spending over a date range.
 *
 * The owner, 12 October 2026: on a trip "I cannot count my expenses
 * properly, then when returning home I'll just conclude all expenses: count
 * the money, minus the original ... 10,000, 500 left, then I spent 9,500 in
 * travel. I have no idea where it all went." Saved on one day, PHP 9,337.00
 * read as one day's spending: a spike on the day it was typed, a month total
 * in the wrong month when the trip crossed one, and "spent today" past the
 * day's figure. Not only for travel: any kind of spending.
 *
 * Stored once, on the first day, with `coversTo` the last day. Every report
 * spreads it evenly over its days (`spreadCovered`), the remainder on the
 * last day, so a month or a day holds its share and the parts add up to the
 * entry exactly. Balances do not move: the parts carry the same wallet and
 * add up to the same total. The Database, Edit and the Bin keep the one row.
 */

import { addDays, daysBetween, formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

/** The longest a covered stretch may run: a quarter of a year. */
export const MOST_DAYS_COVERED = 92;

/** Whether a row covers more than its own day. */
export const covers = (t: Pick<Transaction, "type" | "date" | "coversTo">): boolean =>
  t.type === "Spending" && typeof t.coversTo === "string" && t.coversTo > t.date;

/** How many days a row covers, its first and last included. */
export const daysCovered = (t: Pick<Transaction, "type" | "date" | "coversTo">): number =>
  covers(t) ? daysBetween(t.date, t.coversTo as IsoDate) + 1 : 1;

/** "October 9 to October 11, 3 days". */
export function coverWords(t: Pick<Transaction, "type" | "date" | "coversTo">): string {
  return covers(t) ? `${formatMedium(t.date)} to ${formatMedium(t.coversTo as IsoDate)}, ${daysCovered(t)} days` : formatMedium(t.date);
}

/**
 * Each covering row as one part a day, for every report. The fee falls on
 * the first day; the amount is shared evenly in centavos, the remainder on
 * the last day. A part keeps the row's record number and points back at it.
 */
export function spreadCovered<T extends Transaction>(rows: readonly T[]): T[] {
  if (!rows.some(covers)) return rows as T[];
  const out: T[] = [];
  for (const t of rows) {
    if (!covers(t)) {
      out.push(t);
      continue;
    }
    const days = Math.min(daysCovered(t), MOST_DAYS_COVERED);
    const each = Math.floor(t.amount / days);
    for (let i = 0; i < days; i += 1) {
      const amount = i === days - 1 ? t.amount - each * (days - 1) : each;
      const fee = i === 0 ? t.fee : 0;
      const { coversTo: _end, ...rest } = t;
      // "day 2 of 3", so a list of a day's entries says what the part is.
      const description = `${t.description.trim() ? `${t.description.trim()}, ` : ""}day ${i + 1} of ${days}`;
      out.push({ ...rest, id: `${t.id}@${i}`, date: addDays(t.date, i), amount, fee, total: amount + fee, description, coveredBy: t.id } as T);
    }
  }
  return out;
}

/** Covering rows a day falls inside, other than `except`. */
export function coversOn(day: IsoDate, rows: readonly Transaction[], except?: string): Transaction[] {
  return rows.filter((t) => covers(t) && t.id !== except && day >= t.date && day <= (t.coversTo as IsoDate));
}

/**
 * The words for an entry dated inside a covering entry. The owner: "what if
 * I spend 10k on the trip Oct 11 to 13 but I added another spending like food
 * that is included in the travel": if it was paid from that money it is
 * counted twice, unless it is taken out of the covering entry.
 */
export function insideCoverWords(cover: Transaction, amount: Centavos): string {
  return `${formatMedium(cover.date)} to ${formatMedium(cover.coversTo as IsoDate)} is covered by ${cover.item || "a spending entry"}, ${formatMoney(cover.total)} (#${String(cover.recordNumber).padStart(4, "0")}). If this ${formatMoney(amount)} was paid from that money, it is already counted there: take it out of that entry so it is not counted twice. If it was separate, save it as it is.`;
}

/** Saved spending from one account on the days a date range spans: what its amount may already include. */
export function savedWithin(rows: readonly Transaction[], from: IsoDate, to: IsoDate, wallet: string, except?: string): Transaction[] {
  return rows.filter(
    (t) => t.id !== except && !covers(t) && t.date >= from && t.date <= to && t.fromWallet.trim() === wallet.trim() && wallet.trim() !== "" && (t.type === "Spending" || (t.type === "Transfer" && !t.toWallet.trim())),
  );
}

/**
 * Entries already saved from the same account inside a date range, named,
 * and what to do about them. Taking them off is offered only when this
 * amount is the larger: a PHP 500.00 range was told to take PHP 9,337.00 off
 * (owner, 12 October 2026).
 */
export function savedInsideWords(inside: readonly Transaction[], amount: Centavos, wallet: string): string {
  const sum = inside.reduce((a, t) => a + t.total, 0);
  const named = inside
    .slice(0, 3)
    .map((t) => `#${String(t.recordNumber).padStart(4, "0")} ${t.item || t.type} ${formatMoney(t.total)} on ${formatMedium(t.date)}`)
    .join(", ");
  const more = inside.length > 3 ? ` and ${inside.length - 3} more` : "";
  return amount > sum
    ? `Already saved from ${wallet} in this range: ${named}${more}. If this ${formatMoney(amount)} includes ${inside.length === 1 ? "it" : "them"}, take ${formatMoney(sum)} off so nothing is counted twice; if not, save it as it is.`
    : `Already saved from ${wallet} in this range: ${named}${more}. If this ${formatMoney(amount)} is part of ${inside.length === 1 ? "that" : "those"}, it is already counted; if it is separate, save it as it is.`;
}

