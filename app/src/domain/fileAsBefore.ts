/**
 * A new kind from a model, filed where the owner has filed that word before.
 *
 * 30 September 2026: "I spent 25 water and 175 tokens to arcade cash" came
 * back with a card for "Water", flagged "not one of your spending types,
 * saving this adds it as a new one". The owner had filed water three times
 * that week, every time under Food. Saving it split water across two kinds,
 * and each total that splits by kind was then wrong by that much.
 *
 * Only when the ledger is clear: at least two past rows with that word, and
 * two in three of them under one kind already on the list. Anything less is
 * left as the model read it, still flagged as new, and the card says why
 * when it is changed, so the owner can put it back.
 */

import type { Proposal } from "./proposal";
import type { ReferenceLists, Transaction } from "./types";

const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

export function fileAsBefore(
  proposals: readonly Proposal[],
  transactions: readonly Transaction[],
  reference: Pick<ReferenceLists, "spendingTypes">,
): Proposal[] {
  const known = new Map(reference.spendingTypes.map((t) => [t.name.trim().toLowerCase(), t.name] as const));
  const spent = transactions.filter((t) => t.type === "Spending" && t.category === "Spending" && t.item.trim());

  return proposals.map((p) => {
    const d = p.draft;
    const item = d.item.trim();
    if (d.flow !== "Spending" || !item || (d.category && d.category !== "Spending")) return p;
    if (known.has(item.toLowerCase())) return p;

    // The kind's own words, as a whole: "water", "arcade tokens".
    const said = wordsOf(item);
    if (said.length === 0) return p;
    const hasAll = (text: string): boolean => {
      const have = new Set(wordsOf(text));
      return said.every((w) => have.has(w));
    };

    const byKind = new Map<string, number>();
    let total = 0;
    for (const row of spent) {
      if (!hasAll(`${row.description} ${row.item}`)) continue;
      total += 1;
      const kind = known.get(row.item.trim().toLowerCase());
      if (kind) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    let best = "";
    let count = 0;
    for (const [kind, n] of byKind) {
      if (n > count) {
        best = kind;
        count = n;
      }
    }
    if (!best || count < 2 || count * 3 < total * 2) return p;

    const notNew = (note: string): boolean => !note.toLowerCase().includes(`"${item.toLowerCase()}" is not`);
    return {
      ...p,
      draft: { ...d, item: best },
      adjustments: [
        ...p.adjustments.filter(notNew),
        `Filed as ${best}, where "${item.toLowerCase()}" has gone ${count === 1 ? "once" : `${count} times`} before. Change it if ${item} should be a kind of its own.`,
      ],
    };
  });
}
