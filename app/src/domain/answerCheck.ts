/**
 * What the figure check found under a model's answer, in words.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * Every peso figure a model writes is checked against the figures the app
 * worked out (`aiFigures.ts`). What it found was a paragraph at the end of
 * the answer, only when something did not match, and the app's own figures
 * sat in a closed box headed "Show the app's working" over the model's name.
 * The owner, 10 November 2026: "is so confusing like i dont know what is the
 * purpose of this like I need to expand it and it just from the same model".
 *
 * So the check is one line of its own under every model answer that states
 * figures: all of them matched, or how many did and which did not. It is
 * kept with the answer in the record only when something did not match, as
 * the paragraph was.
 */
import { formatMoney, type Centavos } from "./money";

export interface AnswerCheck {
  /** Peso figures stated, not counting small round ones nobody relies on. */
  readonly figures: number;
  /** Figures the app could not trace, as written, in centavos. */
  readonly loose: readonly Centavos[];
  /** A claim against the day's figure that does not fit (`dayFit.ts`), or "". */
  readonly slip: string;
  /** Made up on request: nothing to trace them to. */
  readonly madeUp?: boolean;
}

/** The line under the answer, or "" when it states no figure. */
export function checkWords(checked: AnswerCheck): string {
  if (checked.madeUp) return "Made-up figures, as you asked: none of them is from your records.";
  const n = checked.figures;
  if (n === 0) return "";
  const loose = checked.loose.length;
  if (loose === 0) return n === 1 ? "Checked: the one figure in this answer matches your records." : `Checked: all ${n} figures in this answer match your records.`;
  const list = checked.loose.map((c) => formatMoney(c)).join(", ");
  const one = loose === 1;
  const after = `Check ${one ? "it" : "those"} before you rely on ${one ? "it" : "them"}.`;
  const matched = Math.max(0, n - loose);
  if (matched === 0) return n <= 1 ? `Checked: the one figure in this answer, ${list}, is not in your records. ${after}` : `Checked: none of the ${Math.max(n, loose)} figures in this answer is in your records: ${list}. ${after}`;
  return `Checked: ${matched} of ${n} figures match your records. Not in them: ${list}. ${after}`;
}

/** The answer as kept in the record: its words, then what the check found when something did not match. */
export function withCheckWords(text: string, checked: AnswerCheck | undefined): string {
  if (!checked || !text) return text;
  const words = [checked.loose.length > 0 || checked.madeUp ? checkWords(checked) : "", checked.slip].filter(Boolean);
  return words.length > 0 ? `${text}\n\n${words.join("\n\n")}` : text;
}
