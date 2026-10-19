/**
 * One message with two pictures: each picture is read with the typed words
 * beside it, so an entry the words name came back once for every picture.
 *
 * 15 October 2026: a message naming an income and a gas payment, sent with a
 * bank screenshot and a receipt, gave five cards: both typed entries twice. The same entry from two pictures, when the message itself says
 * its amount, is the message's entry once. Two pictures that each show a
 * ₱200.00 the message never mentions are left alone: those may be two.
 */
import { parseAmount, type Centavos } from "./money";

interface Read {
  readonly sourceRef: string;
  readonly draft: {
    readonly flow: string;
    readonly date: string;
    readonly amount: Centavos | null;
    readonly item: string;
    readonly fromWallet: string;
    readonly toWallet: string;
  };
}

export function typedOnce<P extends Read>(proposals: readonly P[], pictures: readonly string[], note: string): P[] {
  if (pictures.length < 2 || !note.trim()) return [...proposals];
  const said = new Set(
    [...note.matchAll(/(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi)]
      .map((m) => parseAmount(m[1] ?? ""))
      .filter((v): v is Centavos => v !== null && v > 0),
  );
  const pictureOf = (p: P): string => pictures.find((name) => name && p.sourceRef.includes(name)) ?? "";
  const key = (p: P): string =>
    [p.draft.flow, p.draft.date, p.draft.amount, p.draft.item.trim().toLowerCase(), p.draft.fromWallet, p.draft.toWallet].join("|");
  const kept = new Map<string, string>();
  return proposals.filter((p) => {
    const k = key(p);
    const from = pictureOf(p);
    const before = kept.get(k);
    const typed = p.draft.amount !== null && said.has(p.draft.amount);
    if (before !== undefined && typed && from !== before) return false;
    if (before === undefined) kept.set(k, from);
    return true;
  });
}
