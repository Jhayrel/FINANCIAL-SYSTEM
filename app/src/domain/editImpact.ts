/**
 * What editing a saved entry does to the money, before it is saved.
 *
 * The owner, 20 October 2026: "if I edit it in the database, click edit and
 * edit it manually then save, what happens? Does it count as an expense?
 * Minus balance? Break my budget?" The model answered with the month's
 * budget and wallet totals, none of which said what the edit changes.
 *
 * Worked out from the same two definitions every screen uses: what each
 * wallet holds (`walletDelta`, the Dashboard's balances) and what a row costs
 * (`costOf`, every spending total and the budget's "spent"). A budget's
 * figure is never changed by an edit; only what is counted against it.
 */
import { walletDelta } from "./balances";
import { MONTH_NAMES } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { costOf } from "./totals";
import type { Transaction } from "./types";

export interface EditImpact {
  /** Each account whose balance moves, by how much (negative is down). */
  readonly wallets: readonly { readonly name: string; readonly change: Centavos }[];
  /** Each month whose spending moves, as YYYY-MM, by how much. */
  readonly spending: readonly { readonly month: string; readonly change: Centavos }[];
  /** All of it in a sentence or two. */
  readonly words: string;
}

const monthName = (ym: string): string => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

export function editImpact(
  rows: readonly { readonly before: Transaction | null; readonly after: Transaction | null }[],
  accounts: readonly string[],
): EditImpact {
  const wallets = accounts
    .map((name) => {
      const counts = (w: string): boolean => w === name;
      const change = rows.reduce((s, r) => s + (r.after ? walletDelta(r.after, counts) : 0) - (r.before ? walletDelta(r.before, counts) : 0), 0);
      return { name, change };
    })
    .filter((w) => w.change !== 0);

  const byMonth = new Map<string, Centavos>();
  for (const r of rows) {
    if (r.before) byMonth.set(r.before.date.slice(0, 7), (byMonth.get(r.before.date.slice(0, 7)) ?? 0) - costOf(r.before));
    if (r.after) byMonth.set(r.after.date.slice(0, 7), (byMonth.get(r.after.date.slice(0, 7)) ?? 0) + costOf(r.after));
  }
  const spending = [...byMonth.entries()].filter(([, c]) => c !== 0).map(([month, change]) => ({ month, change })).sort((a, b) => a.month.localeCompare(b.month));

  const money = (c: Centavos): string => formatMoney(Math.abs(c));
  const walletWords = wallets.map((w) => `${w.name} goes ${w.change > 0 ? "up" : "down"} ${money(w.change)}`);
  const spendWords = spending.map((s) => `${monthName(s.month)} spending goes ${s.change > 0 ? "up" : "down"} ${money(s.change)}, so its budget shows that much ${s.change > 0 ? "more" : "less"} spent`);
  const words =
    walletWords.length === 0 && spendWords.length === 0
      ? "No balance and no spending changes: the money stays where it is, and every budget reads the same."
      : [
          walletWords.length > 0 ? `${walletWords.join(", ")}.` : "No balance changes.",
          spendWords.length > 0 ? `${spendWords.join("; ")}.` : "No spending changes, so every budget reads the same.",
        ].join(" ");
  return { wallets, spending, words };
}
