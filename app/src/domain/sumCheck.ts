/**
 * Sums a model says it did, worked out again.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The figure check (`aiFigures.ts`) traces every peso figure an answer
 * states to one the app worked out. It cannot see the arithmetic between
 * them. The owner, 17 November 2026: an answer added safe to spend to what
 * the month had already spent and said it "makes a total possible spending
 * budget of" a figure, checked "all 8 figures match your records", and
 * asked to run the calculations again it said the same sum was accurate.
 * Each figure was real; the sum was not: the total also held the money kept
 * for allocations, which the answer never named.
 *
 * So a sum said in words is worked out here, and a wrong one is said under
 * the answer. Only the plain shapes: adding one figure to another, "plus",
 * "minus", "less", "+", "-" and "=". When a sentence says "adding this", the
 * figure it points back to is the last one of the sentence before; when it
 * says "produced by adding", the result is the last figure before it.
 */
import { formatMoney, type Centavos } from "./money";

const FIGURE = /(?:₱|\bphp)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;

function figuresOf(text: string): Centavos[] {
  return [...text.matchAll(FIGURE)].map((m) => Math.round(Number((m[1] ?? "").replace(/,/g, "")) * 100)).filter((c) => Number.isFinite(c));
}

export interface SumSlip {
  readonly parts: readonly Centavos[];
  readonly op: "+" | "-";
  readonly said: Centavos;
  readonly worked: Centavos;
}

const ADDING = /\badd(?:ing|ed|s)?\b[^.]*?\bto\b/i;
/** Only words that say a sum's result: "is" or "are" also join a figure to anything else. */
const RESULT = /\b(?:makes?|gives?|brings?\s+(?:it|that|this|you|the\s+total)?\s*to|comes?\s+to|equals?|totals?|totaling|totalling|for\s+a\s+total|sum\s+of)\b|=/i;
const POINTS_BACK = /\badd(?:ing|ed|s)?\s+(?:this|that|it|these|those)\b/i;
const PRODUCED_BY = /\b(?:produced|worked\s+out|calculated|computed|reached|arrived\s+at|got|comes?|made)\s+(?:by|from)\s+adding\b/i;

/** Every sum in the answer that does not add up. */
export function sumSlips(answer: string): SumSlip[] {
  const text = answer.replace(/\*\*/g, "").replace(/ /g, " ");
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z(])|\n+/).map((s) => s.trim()).filter(Boolean);
  const slips: SumSlip[] = [];
  let before: Centavos[] = [];
  for (const sentence of sentences) {
    const figs = figuresOf(sentence);
    const check = (parts: Centavos[], op: "+" | "-", said: Centavos): void => {
      const worked = op === "+" ? parts.reduce((a, b) => a + b, 0) : parts[0]! - parts.slice(1).reduce((a, b) => a + b, 0);
      if (Math.abs(worked - said) > 1) slips.push({ parts, op, said, worked });
    };
    if (PRODUCED_BY.test(sentence) && figs.length === 2 && before.length > 0) {
      check(figs, "+", before[before.length - 1]!);
    } else if (ADDING.test(sentence)) {
      const from = sentence.search(ADDING);
      const result = RESULT.exec(sentence.slice(from));
      if (result) {
        const at = from + result.index;
        const parts = figuresOf(sentence.slice(0, at));
        const said = figuresOf(sentence.slice(at))[0];
        if (said !== undefined) {
          if (parts.length >= 2) check(parts, "+", said);
          else if (parts.length === 1 && POINTS_BACK.test(sentence) && before.length > 0) check([before[before.length - 1]!, parts[0]!], "+", said);
        }
      }
    } else {
      // "A plus B is C", "A + B = C", "A minus B leaves C", "A less B is C".
      const plain = /(?:₱|\bphp)\s?[\d,.]+\s*(plus|\+|minus|less|-)\s*(?:₱|\bphp)\s?[\d,.]+\s*(?:is|=|equals|makes|gives|leaves|leaving)\s*(?:₱|\bphp)\s?[\d,.]+/i.exec(sentence);
      if (plain) {
        const three = figuresOf(plain[0]);
        if (three.length === 3) check([three[0]!, three[1]!], /plus|\+/i.test(plain[1] ?? "") ? "+" : "-", three[2]!);
      }
    }
    if (figs.length > 0) before = figs;
  }
  return slips;
}

/** The line said under the answer, or "". */
export function sumNote(answer: string): string {
  const slips = sumSlips(answer);
  if (slips.length === 0) return "";
  return slips
    .map((s) => {
      const parts = s.parts.map((c) => formatMoney(c)).join(s.op === "+" ? " and " : " less ");
      return `A sum in this answer does not add up: ${parts} ${s.op === "+" ? "make" : "leaves"} ${formatMoney(s.worked)}, not ${formatMoney(s.said)}.`;
    })
    .join(" ");
}
