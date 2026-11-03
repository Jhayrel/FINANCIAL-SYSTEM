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

/**
 * The same movement, as far as the two cards say: the same flow, day and
 * amount, and every wallet or kind either the same or left blank on one of
 * them. "deposited 1500 to my mayabank" read from the message had no wallet
 * it came from; the picture's card had Maya. Matched only on every field,
 * they were two cards and the owner was asked a question about the second
 * (3 November 2026).
 */
const same = (a: string, b: string): boolean => !a.trim() || !b.trim() || a.trim().toLowerCase() === b.trim().toLowerCase();
const filled = (d: Read["draft"]): number => [d.item, d.fromWallet, d.toWallet].filter((v) => v.trim() !== "").length;

export function typedOnce<P extends Read>(proposals: readonly P[], pictures: readonly string[], note: string): P[] {
  if (pictures.length === 0 || !note.trim()) return [...proposals];
  const said = new Set(
    [...note.matchAll(/(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi)]
      .map((m) => parseAmount(m[1] ?? ""))
      .filter((v): v is Centavos => v !== null && v > 0),
  );
  const pictureOf = (p: P): string => pictures.find((name) => name && p.sourceRef.includes(name)) ?? "";
  // Read from what was typed, as the model marks it ("1000083964.jpg, user message", "What they said: ...").
  const fromWords = (p: P): boolean => /\b(?:user\s+message|message|text|what\s+they\s+said|typed)\b/i.test(p.sourceRef);
  const alike = (a: P["draft"], b: P["draft"]): boolean =>
    a.flow === b.flow && a.date === b.date && a.amount === b.amount && same(a.item, b.item) && same(a.fromWallet, b.fromWallet) && same(a.toWallet, b.toWallet);
  const out: P[] = [];
  for (const p of proposals) {
    const typed = p.draft.amount !== null && said.has(p.draft.amount);
    // The typed entry once: read again beside another picture, or once from the words and once from a picture.
    const at = typed ? out.findIndex((q) => alike(q.draft, p.draft) && (pictureOf(q) !== pictureOf(p) || fromWords(q) || fromWords(p))) : -1;
    if (at < 0) {
      out.push(p);
      continue;
    }
    // The fuller of the two stays, where the first one was.
    if (filled(p.draft) > filled(out[at]!.draft)) out[at] = p;
  }
  return out;
}
