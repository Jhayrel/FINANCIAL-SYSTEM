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
 * The one row saved after this card that is its entry, or null. `drafts` are
 * what the card showed and what it first read: the form may have changed
 * the item or the words, never all of the date, the amount and the kind.
 */
export function rowSavedFor(
  cardId: string,
  drafts: readonly Draft[],
  rows: readonly Transaction[],
  claimed: ReadonlySet<string>,
): Transaction | null {
  const since = madeAt(cardId, "c");
  if (since === null) return null;
  const fits = rows.filter((r) => {
    if (claimed.has(r.id) || (r as Transaction & { deletedAt?: string }).deletedAt) return false;
    const at = madeAt(r.id, "t");
    if (at === null || at < since) return false;
    return drafts.some((d) => d.date === r.date && d.amount === r.amount && sameKind(r.type, d.flow));
  });
  return fits.length === 1 ? (fits[0] ?? null) : null;
}
