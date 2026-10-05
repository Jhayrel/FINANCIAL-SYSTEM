/**
 * What kind of paper a picture is, learned from examples.
 *
 * ── Why it is trained rather than written ─────────────────────────────────
 *
 * The owner, 5 October 2026, after the reader was taught fourteen of their
 * receipts with a rule for each layout: "Dont hard code those please train
 * them." A rule per layout knows the layouts it was written for and nothing
 * else. A billing invoice from another company, a checkout from another
 * shop, an assessment from another school, each says what it is in its own
 * words, and the words that matter are learned here from examples instead.
 *
 * Two sets of examples train it:
 *
 *   - a starter set, invented in the layouts these papers come in
 *     (`paperSeed.ts`), so it knows something before it is taught;
 *   - the owner's own, taught from the chat ("train", "don't add") and from
 *     every picture card they add (`paperMemory.ts`). Theirs count more,
 *     because they are the papers this ledger actually sees.
 *
 * The model is naive Bayes over the words and word pairs on the paper, each
 * counted once: small, explainable, trained in milliseconds on the device,
 * and better with every example. Figures and codes are left out, so it
 * learns what a paper says about itself, not what it happened to cost.
 *
 * Pure, so it runs the same on the phone and in a test.
 */

/** The kinds a picture of money can be. */
export type PaperKind = "receipt" | "slip" | "wallet" | "atm" | "history" | "bill" | "assessment" | "checkout" | "quote";

export const PAPER_KINDS: readonly PaperKind[] = ["receipt", "slip", "wallet", "atm", "history", "bill", "assessment", "checkout", "quote"];

/** Kinds that ask for money rather than record it paid. */
export const UNPAID: ReadonlySet<PaperKind> = new Set<PaperKind>(["bill", "assessment", "checkout", "quote"]);

/** The kind in the owner's words, for the card and the chat. */
export const PAPER_WORDS: Record<PaperKind, string> = {
  receipt: "a receipt",
  slip: "a card terminal slip",
  wallet: "an e-wallet or bank confirmation",
  atm: "an ATM slip",
  history: "an account's history",
  bill: "a bill",
  assessment: "an assessment of fees",
  checkout: "a checkout screen",
  quote: "a quotation",
};

export interface PaperExample {
  readonly text: string;
  readonly kind: PaperKind;
  /** How much it counts: 1 for the starter set, more for the owner's own. */
  readonly weight?: number;
}

interface KindCounts {
  docs: number;
  /** Every word counted, for the smoothing. */
  total: number;
  readonly counts: Map<string, number>;
}

export interface PaperModel {
  readonly kinds: ReadonlyMap<PaperKind, KindCounts>;
  readonly vocabulary: number;
  /** How many examples trained it, and how many were the owner's. */
  readonly examples: number;
  readonly taught: number;
}

export interface PaperGuess {
  readonly kind: PaperKind;
  /** How sure, from 0 to 1. */
  readonly p: number;
  /** Every kind, most likely first. */
  readonly ranked: readonly { readonly kind: PaperKind; readonly p: number }[];
}

/**
 * The words on a paper, each once: lower case, letters only, three or more
 * of them, and each pair of neighbours. "PLACE ORDER" is "place", "order"
 * and "place order"; "₱3,419.00" is nothing.
 */
export function paperTokens(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 20);
  const out = new Set<string>();
  for (let i = 0; i < words.length && i < 600; i += 1) {
    const w = words[i]!;
    out.add(w);
    const next = words[i + 1];
    if (next) out.add(`${w} ${next}`);
  }
  return [...out];
}

/** Trained on the examples given; the owner's own carry their weight. */
export function trainPapers(examples: readonly PaperExample[]): PaperModel {
  const kinds = new Map<PaperKind, KindCounts>(PAPER_KINDS.map((k) => [k, { docs: 0, total: 0, counts: new Map() }]));
  const vocabulary = new Set<string>();
  let taught = 0;
  for (const ex of examples) {
    const into = kinds.get(ex.kind);
    if (!into) continue;
    const weight = ex.weight ?? 1;
    if (weight > 1) taught += 1;
    into.docs += weight;
    for (const token of paperTokens(ex.text)) {
      vocabulary.add(token);
      into.counts.set(token, (into.counts.get(token) ?? 0) + weight);
      into.total += weight;
    }
  }
  return { kinds, vocabulary: vocabulary.size, examples: examples.length, taught };
}

/**
 * The kind a paper most likely is, and how sure.
 *
 * Every kind starts equal: the starter set is not a count of how often each
 * turns up. Words the training never saw say nothing either way. The sum is
 * tempered by the number of words, so a long paper is not made certain by
 * its length alone.
 */
export function classifyPaper(text: string, model: PaperModel): PaperGuess {
  const known = (t: string): boolean => [...model.kinds.values()].some((k) => k.counts.has(t));
  const seen = paperTokens(text).filter(known);
  const v = Math.max(1, model.vocabulary);
  const scores = PAPER_KINDS.map((kind) => {
    const k = model.kinds.get(kind)!;
    if (k.docs === 0) return { kind, score: -Infinity };
    let score = 0;
    for (const t of seen) score += Math.log(((k.counts.get(t) ?? 0) + 1) / (k.total + v));
    return { kind, score };
  });
  const temper = Math.max(1, Math.sqrt(seen.length) / 2);
  const best = Math.max(...scores.map((s) => s.score));
  const exp = scores.map((s) => ({ kind: s.kind, e: Number.isFinite(s.score) && Number.isFinite(best) ? Math.exp((s.score - best) / temper) : 0 }));
  const sum = exp.reduce((a, b) => a + b.e, 0) || 1;
  const ranked = exp.map((s) => ({ kind: s.kind, p: s.e / sum })).sort((a, b) => b.p - a.p);
  return { kind: ranked[0]!.kind, p: ranked[0]!.p, ranked };
}

/** What the model is told about the kind, beside the reading. */
export function paperNote(guess: PaperGuess, model: PaperModel): string {
  const second = guess.ranked[1];
  const how = guess.p >= 0.9 ? "almost certainly" : guess.p >= 0.7 ? "most likely" : "possibly";
  return `Going by ${model.examples} examples${model.taught > 0 ? `, ${model.taught} of them taught by the owner` : ""}, this paper is ${how} ${PAPER_WORDS[guess.kind]}${second && second.p >= 0.15 ? ` (or ${PAPER_WORDS[second.kind]})` : ""}.${UNPAID.has(guess.kind) ? " That kind asks for money and records no payment." : ""}`;
}
