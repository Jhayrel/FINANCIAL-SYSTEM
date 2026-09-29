/**
 * A total and its parts, in one typed message.
 *
 * ── The message this exists for ────────────────────────────────────────────
 *
 * The owner, 29 September 2026: "I paid 450, 300 for honorarium for capstone
 * and 150 for my donation for capstone. All school category basically 300
 * and 150 total of 450". Two payments, ₱300.00 and ₱150.00, and ₱450.00 is
 * what they come to. It became three cards: ₱450.00 for the honorarium,
 * ₱150.00 for the donation, and a third ₱150.00 asking what it was for, each
 * warning that a different figure had been written. ₱750.00 for ₱450.00
 * spent. "make sure it knows logic too, i keep explaining this".
 *
 * People say money this way all the time: the whole first, then how it
 * broke down, or the parts and then what they came to, and then a sentence
 * that says it all again. So before a message is split into entries:
 *
 *   - A figure said as the total of the others is taken out. Said first and
 *     followed straight away by the parts ("450, 300 for ... and 150 for
 *     ...") it must equal their sum exactly, because "450 for rent, 300 for
 *     food and 150 for load" is three payments that happen to add up. Named
 *     a total ("total of 450", "450 in total", "all in all 450") it is taken
 *     out whatever the sum, and a sum that does not match is said.
 *   - A later sentence that only repeats figures already given ("basically
 *     300 and 150 total of 450"), or names no figure and only says what they
 *     all were ("All school category"), is not an entry. Its words are kept,
 *     for what they say about the entries (`namedIn`).
 *
 * A sentence that says "again", "another", "also" or "then" is never a
 * repeat: paying for the same thing twice is two entries.
 */

import { parseAmount, type Centavos } from "./money";

export interface TotalsRead {
  /** The message with the total and any sentence that only repeats it taken out: what the entries are read from. */
  readonly text: string;
  /** The figure said as the total, when there was one. */
  readonly total: Centavos | null;
  /** What the other figures come to, when there was a total. */
  readonly parts: Centavos;
  /** How many figures the total was said to be made of. */
  readonly count: number;
  /** The figures it was made of, in the order said. */
  readonly partValues?: readonly Centavos[];
  /** Any other totals in the same message, each with its parts. */
  readonly others?: readonly { readonly total: Centavos; readonly parts: readonly Centavos[] }[];
  /** Sentences left out because they only say again what was said, for their words ("All school category"). */
  readonly restated: readonly string[];
}

interface Figure {
  readonly value: Centavos;
  readonly start: number;
  readonly end: number;
}

const MONTH_BEFORE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*$/i;

/** Money figures in digits, with where they sit. Dates, times, counts and units are not money. */
function figures(text: string): Figure[] {
  const out: Figure[] = [];
  const pattern =
    /(?:₱\s*|php\s*|p(?=\d))?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d/%]|:\d|\s*(?:st|nd|rd|th|am|pm|x|pcs|pc|pieces?|kg|kgs|g|ml|l|days?|months?|years?|yrs?|hrs?|hours?|mins?|minutes?|times|people|persons?)\b)/gi;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const before = text.slice(0, start);
    // Part of a word ("iphone15", "g2") or of a date ("9/29", "sept 29").
    if (/[a-z0-9/]$/i.test(before) && !/(?:₱|php|p)$/i.test(match[0].slice(0, 1))) continue;
    if (MONTH_BEFORE.test(before)) continue;
    // A small whole number before a plural thing is how many, not how much: "2 shirts", "3 packs".
    if (/^\d{1,2}$/.test(match[1] ?? "") && /^\s+(?!pesos?\b|php\b|centavos?\b)[a-z]{2,}s\b/i.test(text.slice(start + match[0].length))) continue;
    const value = parseAmount(match[1] ?? "");
    if (value === null || value <= 0) continue;
    out.push({ value, start, end: start + match[0].length });
  }
  return out;
}

/**
 * Sentences, each with its own punctuation and the line it is on. A point
 * inside a figure ("1,000.50") is not an end, and the lines are kept, since
 * a line break is how a list of entries is typed (`splitEntries`).
 */
function sentencesOf(text: string): { sentence: string; line: number }[] {
  return text
    .split(/\n/)
    .flatMap((l, line) =>
      l
        .split(/(?<=[.!?])\s+(?=\S)/)
        .map((sentence) => ({ sentence: sentence.trim(), line }))
        .filter((x) => x.sentence),
    );
}

/** Words that make a figure the total of the others. */
const TOTAL_BEFORE =
  /(?:[\s,;:(-]*(?:(?:with|for|at)\s+)?(?:a\s+|the\s+)?(?:grand\s+)?(?:total|sum|kabuuan)(?:\s+(?:of|is|was|na|ng|amount))?|[\s,;:(-]*(?:in total|in all|all in all|overall|altogether|all together|lahat lahat|lahat))\s*[:=]?\s*$/i;
const TOTAL_AFTER = /^\s*(?:pesos?\s*)?(?:in total|total|in all|all in all|overall|altogether|all together|lahat)\b[\s,;:)]*/i;
/** Words between the parts and a total named after it: "300 both in 450 total", "150, so 450 in all". */
const FILLER_BEFORE = /(?:\s*(?:[,;:(=-]|\b(?:both|all|so|that'?s|which|is|are|in|equals?)\b))*\s*$/i;
/** A figure followed straight away by another: the whole, then its parts. */
const LEAD_AFTER = /^\s*(?:pesos?\s*)?[,:;(]\s*(?=(?:₱|php\s*|p)?\d)/i;

/** Words that make a later sentence a new entry, never a repeat. */
const NEW_AGAIN = /\b(?:again|another|also|then|twice|more|extra|plus|additional|ulit|pa)\b/i;
/** Words that make a figure-less sentence a note about the ones before it. */
const ABOUT_THEM = /\b(?:all|both|everything|lahat|category|categories|basically|those|these|they|them|each)\b/i;
/** A verb of moving money: a sentence with one is an entry of its own, figure or not. */
const MOVES = /\b(?:paid|pay|bought|buy|spent|spend|sent|send|received|receive|got|earned|transfer\w*|borrow\w*|lent|lend|gave|give|withdr\w*|deposit\w*|cash(?:ed)? ?in|cash(?:ed)? ?out)\b/i;

const tidy = (text: string): string =>
  text
    .split("\n")
    .map((line) =>
      line
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/\(\s*\)/g, "")
        .replace(/(?:,|\band)\s*([.!?]|$)/gi, "$1")
        .replace(/^[\s,;:]+/, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");

export function readTotals(message: string): TotalsRead {
  const none: TotalsRead = { text: message, total: null, parts: 0, count: 0, restated: [] };
  const sentences = sentencesOf(message);
  if (sentences.length === 0) return none;

  // ── 1. Sentences that only say again what was said ─────────────────────
  const kept: { sentence: string; line: number }[] = [];
  const restated: string[] = [];
  const said: Centavos[] = [];
  for (const [i, { sentence, line }] of sentences.entries()) {
    const values = figures(sentence).map((f) => f.value);
    const pool = [...said];
    const allSaid =
      values.length > 0 &&
      values.every((v) => {
        const at = pool.indexOf(v);
        if (at < 0) return false;
        pool.splice(at, 1);
        return true;
      });
    const repeats =
      i > 0 &&
      kept.length > 0 &&
      !NEW_AGAIN.test(sentence) &&
      (values.length > 0
        ? allSaid && (values.length >= 2 || TOTAL_BEFORE.test(sentence) || TOTAL_AFTER.test(sentence) || ABOUT_THEM.test(sentence))
        : ABOUT_THEM.test(sentence) && !MOVES.test(sentence));
    if (repeats) {
      restated.push(sentence);
      continue;
    }
    kept.push({ sentence, line });
    said.push(...values);
  }

  // ── 2. The totals among the figures that are left ───────────────────────
  /*
   * A total belongs to the figures beside it in its own sentence, never to
   * the whole message: "I paid for gas using cash 250. I paid 150 for my
   * school and honorarium 300 both in 450 total ... Then i ate lunch 95"
   * has ₱450.00 as the total of ₱150.00 and ₱300.00 alone (29 September
   * 2026). So the parts are the figures just before it, or just after it,
   * in the same sentence, that come to it exactly.
   */
  let text = kept.map((k, i) => (i === 0 ? "" : k.line === kept[i - 1]?.line ? " " : "\n") + k.sentence).join("");
  const all = figures(text);
  const sentenceOf = (at: number): number => {
    const before = text.slice(0, at);
    return (before.match(/[.!?](?=\s)|\n/g) ?? []).length;
  };
  /*
   * A total said on its own ("300 food / 150 gas / total 450", or "... gas.
   * Total 450.") has no parts in its own sentence, so it looks at the ones
   * before it, still only when they come to it exactly.
   */
  const run = (from: number, step: 1 | -1, total: Centavos, cross = false): Figure[] | null => {
    const home = sentenceOf(all[from]?.start ?? 0);
    const out: Figure[] = [];
    let sum = 0;
    for (let k = from + step; k >= 0 && k < all.length; k += step) {
      const f = all[k];
      if (!f || (!cross && sentenceOf(f.start) !== home)) break;
      out.push(f);
      sum += f.value;
      if (sum === total && out.length >= 2) return out.sort((a, b) => a.start - b.start);
      if (sum > total) break;
    }
    return null;
  };
  const found: { figure: Figure; cut: [number, number]; parts: Figure[] }[] = [];
  const used = new Set<Figure>();
  for (const [i, f] of all.entries()) {
    if (used.has(f)) continue;
    const before = text.slice(0, f.start);
    const after = text.slice(f.end);
    const labelBefore = TOTAL_BEFORE.exec(before);
    const labelAfter = labelBefore ? null : TOTAL_AFTER.exec(after);
    if (labelBefore || labelAfter) {
      const sameSentence = all.filter((o) => o !== f && sentenceOf(o.start) === sentenceOf(f.start));
      const alone = sameSentence.length === 0;
      const beside = run(i, -1, f.value, alone) ?? run(i, 1, f.value, alone);
      const parts = beside ?? (sameSentence.length >= 2 ? sameSentence : null);
      if (!parts) continue;
      const cut: [number, number] = labelBefore
        ? [labelBefore.index, f.end + (/^\s*(?:pesos?\b)?\s*\)?/i.exec(after)?.[0].length ?? 0)]
        : [FILLER_BEFORE.exec(before)?.index ?? f.start, f.end + (labelAfter?.[0].length ?? 0)];
      found.push({ figure: f, cut, parts });
      used.add(f);
      for (const p of parts) used.add(p);
      continue;
    }
    // Said first in its sentence and followed straight away by the parts: only when they add up to it.
    const firstInSentence = !all.some((o) => o.start < f.start && sentenceOf(o.start) === sentenceOf(f.start));
    const lead = LEAD_AFTER.exec(after);
    const parts = firstInSentence && lead ? run(i, 1, f.value) : null;
    if (parts) {
      found.push({ figure: f, cut: [f.start, f.end + (lead?.[0].length ?? 0)], parts });
      used.add(f);
      for (const p of parts) used.add(p);
    }
  }

  if (found.length === 0) return restated.length > 0 ? { ...none, text: tidy(text), restated } : none;
  for (const t of [...found].sort((a, b) => b.cut[0] - a.cut[0])) {
    text = `${text.slice(0, t.cut[0])} ${text.slice(t.cut[1])}`;
  }
  const first = found[0]!;
  return {
    text: tidy(text),
    total: first.figure.value,
    parts: first.parts.reduce((s, f) => s + f.value, 0),
    count: first.parts.length,
    partValues: first.parts.map((f) => f.value),
    others: found.slice(1).map((t) => ({ total: t.figure.value, parts: t.parts.map((f) => f.value) })),
    restated,
  };
}

/** Whether a piece of a message names an amount of money, not a date, a time or a count. */
export const namesMoney = (text: string): boolean => figures(text).length > 0;

/** The message with any total, and any sentence that only repeats one, taken out. */
export const withoutTotals = (message: string): string => readTotals(message).text;

/**
 * One of `names` said in the sentences left out, when exactly one is:
 * "All school category" names School for every entry in the message.
 */
export function namedIn(restated: readonly string[], names: readonly string[]): string | null {
  const words = ` ${restated.join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const hits = names.filter((n) => n.trim() && words.includes(` ${n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `));
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/**
 * Cards read from a message, without one that is only its total.
 *
 * The model is told the same rule (`functions/api/ai.ts`), and this holds it
 * to it: a card for the total, beside cards whose amounts and fees come to
 * exactly that total, is the same money twice, and is dropped.
 */
export function withoutTheTotal<T extends { readonly draft: { readonly amount: Centavos | null; readonly fee: Centavos } }>(
  cards: readonly T[],
  totals: TotalsRead,
): { cards: T[]; dropped: boolean } {
  const total = totals.total;
  if (total === null || cards.length < 3) return { cards: [...cards], dropped: false };
  const at = cards.findIndex((c) => c.draft.amount === total);
  if (at < 0) return { cards: [...cards], dropped: false };
  const rest = cards.filter((_, i) => i !== at);
  const sum = rest.reduce((s, c) => s + (c.draft.amount ?? 0) + c.draft.fee, 0);
  return sum === total ? { cards: rest, dropped: true } : { cards: [...cards], dropped: false };
}

/**
 * What the owner said about all of them, put on each spending card: "All
 * school category" makes each one School. Only on spending that is filed by
 * kind, and only a kind from their own list.
 */
export function withSaidItem<T extends { readonly draft: { readonly flow: string; readonly category: string; readonly item: string } }>(
  card: T,
  item: string | null,
): T {
  if (!item || card.draft.flow !== "Spending" || (card.draft.category !== "Spending" && card.draft.category !== "") || card.draft.item === item) return card;
  return { ...card, draft: { ...card.draft, item, category: "Spending" } };
}

/** The line said beside the cards when a total was read, so it is plain the total was understood. */
export function totalWords(totals: TotalsRead, money: (c: Centavos) => string): string {
  if (totals.total === null) return "";
  const said = (total: Centavos, parts: readonly Centavos[]): string => {
    const sum = parts.reduce((a, b) => a + b, 0);
    const named = parts.length >= 2 ? `${parts.slice(0, -1).map(money).join(", ")} and ${money(parts[parts.length - 1] ?? 0)}` : "";
    if (sum === total) return named ? `${money(total)} is ${named} together, so it is not an entry of its own.` : `${money(total)} is what they come to, so it is not an entry of its own.`;
    return `You said ${money(total)} in all, but ${named || "the parts"} come to ${money(sum)}. Check the amounts before adding them.`;
  };
  return [said(totals.total, totals.partValues ?? []), ...(totals.others ?? []).map((o) => said(o.total, o.parts))].join(" ");
}

/**
 * Which of the parts the device read from a message the model's cards do
 * not cover, by amount: the same figure, or the same with its fee on or off.
 *
 * When the model returns fewer cards than the message holds, its cards are
 * kept, being better worded, and only what it left out is added from the
 * device's reading. They used to be thrown away whole.
 */
export function partsTheModelMissed(
  parts: readonly { readonly amount: Centavos | null; readonly fee: Centavos }[],
  cards: readonly { readonly amount: Centavos | null; readonly fee: Centavos }[],
): number[] {
  const pool = [...cards];
  const missed: number[] = [];
  parts.forEach((p, i) => {
    const a = p.amount ?? 0;
    const at = pool.findIndex((c) => {
      const b = c.amount ?? 0;
      return b === a || b + c.fee === a || b === a + p.fee || b + c.fee === a + p.fee;
    });
    if (at >= 0) pool.splice(at, 1);
    else missed.push(i);
  });
  return missed;
}
