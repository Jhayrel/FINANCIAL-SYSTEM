/**
 * The row a card sent to the form became, found in the ledger.
 *
 * 29 September 2026: a receipt's card was sent to the form with Edit first,
 * corrected there and saved as #3859, and the card went on reading "In the
 * form" with Add to ledger on it. The chat learns of a save from the form
 * only while it is open (`lastSaved`), and the phone's AI tab, the chat on
 * another screen and any chat after a reload were not. The ledger always
 * knows. A row saved from the form carries the moment it was saved in its id
 * (`t-1759152000000`), and a card the moment it was made (`c-1759151900000-1`),
 * so a card in the form is the row saved after it with its date, amount and
 * kind: when exactly one row fits, and no other card has it.
 */

import type { Draft } from "./entry";
import type { Transaction } from "./types";

const madeAt = (id: string, prefix: "c" | "t"): number | null => {
  const m = new RegExp(`^${prefix}-(\\d{12,})`).exec(id);
  return m ? Number(m[1]) : null;
};

const sameKind = (type: Transaction["type"], flow: Draft["flow"]): boolean => type === flow;

/**
 * How long after a card is made its row, saved with another amount, is still
 * taken for it by its words. The owner's took 20 seconds.
 */
const WORDS_WINDOW_MS = 30 * 60_000;

const said = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The one row saved after this card that is its entry, or null. `drafts` are
 * what the card showed and what it first read: the form may have changed
 * the item or the words, or the amount, never all of the date, the amount
 * and the words.
 *
 * 5 November 2026: "I spent 200 in food empanada" was sent to the form and
 * saved there five seconds later as #3992, Food, empanada, ₱100.00. The
 * amount no longer agreed, the card was never marked added, and it came back
 * the next morning as a new ₱200.00 entry, twice, on two screens. So a row
 * with the card's day, kind and own words (its description, or its item when
 * it has none), saved within half an hour of the card, is it too: only when
 * no row fits on the amount, and only when exactly one fits on the words.
 */
export function rowSavedFor(
  cardId: string,
  drafts: readonly Draft[],
  rows: readonly Transaction[],
  claimed: ReadonlySet<string>,
): Transaction | null {
  const since = madeAt(cardId, "c");
  if (since === null) return null;
  const after = rows.filter((r) => {
    if (claimed.has(r.id) || (r as Transaction & { deletedAt?: string }).deletedAt) return false;
    const at = madeAt(r.id, "t");
    return at !== null && at >= since;
  });
  const fits = after.filter((r) => drafts.some((d) => d.date === r.date && d.amount === r.amount && sameKind(r.type, d.flow)));
  if (fits.length > 0) return fits.length === 1 ? (fits[0] ?? null) : null;
  const byWords = after.filter((r) => {
    if ((madeAt(r.id, "t") ?? 0) - since > WORDS_WINDOW_MS) return false;
    return drafts.some((d) => {
      if (d.date !== r.date || !sameKind(r.type, d.flow)) return false;
      const words = said(d.description);
      if (words) return words === said(r.description);
      return said(d.item) !== "" && said(d.item) === said(r.item) && !said(r.description);
    });
  });
  return byWords.length === 1 ? (byWords[0] ?? null) : null;
}
