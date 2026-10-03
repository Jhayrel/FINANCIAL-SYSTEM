/**
 * Every peso figure an answer states, checked back against the figures it
 * was given.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The rule this app runs on is that the model never does arithmetic. Every
 * total, balance and difference is worked out by the domain code and handed
 * over as a fact, and the model's job is to choose which of them matters and
 * say so in a sentence. Nothing enforced that.
 *
 * On 20 September 2026 the owner asked what was still owed after a payment
 * with interest inside it. The answer: "You still owe PHP 4,111.21 ... only
 * PHP 811.21 went toward the principal ... the remaining balance on that
 * specific loan is PHP 1,708.79." Three figures, none of them in the data,
 * all of them produced by the model adding and subtracting in prose. The
 * ledger's own answer was PHP 5,000.00 and it was sitting in the context the
 * whole time.
 *
 * A figure that cannot be traced is the one failure the owner cannot catch
 * by reading, because an invented peso amount looks exactly like a real one.
 *
 * ── What counts as traced ──────────────────────────────────────────────────
 *
 * Either the figure is in the data word for word, or it is one step from two
 * figures that are: a + b, or a − b. One step, because that is what an honest
 * sentence does ("net worth of PHP 1,024,251.32 plus the PHP 5,000.00 debt")
 * and a chain of steps is how the PHP 1,708.79 above was reached, each step
 * built on the last invented one.
 *
 * ── What is done about it ──────────────────────────────────────────────────
 *
 * Nothing is rewritten and nothing is hidden. The app's rule for every other
 * check is that it reports and never corrects, because a silent fix is a
 * second guess on top of the first. The untraced figures are named under the
 * answer, so "how do you know that?" has an answer every time: either the
 * app worked it out, or it says plainly that it did not.
 */

/**
 * A peso figure, in any of the shapes the model writes them.
 *
 * "PHP 1,234.56", "₱1,234.56", "-PHP 33,478.39", "PHP -33,478.39", and the
 * bare "1,234.56" that turns up inside a sentence already talking about
 * pesos. A minus sign is part of the figure: an answer about an overdraft
 * says PHP -33,478.39 and the data says the same.
 */
const FIGURE =
  /(?:[-\u2212]\s*)?(?:php|₱)\s*(?:[-\u2212]\s*)?\d[\d,]*(?:\.\d{1,2})?|(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?![\d.,])/gi;

/**
 * The owner's own figures, written the way the figure reader reads them.
 *
 * "can I allocate 2k", "I have 5000": a figure the owner said is given,
 * however they wrote it, so an answer that repeats it is not flagged.
 */
export function saidAsFigures(said: string): string {
  return [...said.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k)?(?![\d.,])/gi)]
    .map((m) => {
      const n = Number((m[1] ?? "").replace(/,/g, ""));
      return Number.isFinite(n) && n > 0 ? `PHP ${(m[2] ? n * 1_000 : n).toFixed(2)}` : "";
    })
    .filter(Boolean)
    .join(" ");
}

/** The centavos in one matched token, or null when it is not a figure. */
function centavosOf(token: string): number | null {
  const negative = /[-\u2212]/.test(token);
  const digits = token.replace(/[^\d.]/g, "");
  if (digits === "") return null;

  const [whole = "", part = ""] = digits.split(".");
  if (whole === "" && part === "") return null;

  const pesos = Number(whole || "0");
  const centavos = Number((part + "00").slice(0, 2) || "0");
  if (!Number.isFinite(pesos) || !Number.isFinite(centavos)) return null;

  const total = pesos * 100 + centavos;
  return negative ? -total : total;
}

/**
 * Every peso figure in a block of text, as integer centavos.
 *
 * Used on both sides: on what the model wrote, and on everything it was
 * given. Both go through the same reader so a figure written "₱5,000.00" in
 * one and "PHP 5,000.00" in the other is the same figure.
 */
export function figuresIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(FIGURE)) {
    const value = centavosOf(match[0]);
    if (value !== null) found.push(value);
  }
  return found;
}

/**
 * Figures the answer states that the data does not support.
 *
 * Returns them in the order they were written, without repeats, as integer
 * centavos. An empty list means every figure in the answer can be pointed
 * at, which is the normal case and the one that prints nothing.
 */
export function untracedFigures(answer: string, given: string): readonly number[] {
  const known = new Set(figuresIn(given).map(Math.abs));
  if (known.size === 0) return [];

  /**
   * One step from two known figures.
   *
   * For each known figure a, the answer is reached if the data also holds
   * what is left over: f − a for a sum, or a − f for a difference. A set
   * lookup each way, so this stays a handful of lookups per figure rather
   * than every pair of a long context.
   */
  /*
   * With many figures given, one of the two must be in the answer itself,
   * so the step can be seen. Any pair from the chat's whole context let
   * "PHP 4,500.00 for the urgent invitation", a figure nobody said, through
   * on 3 October 2026: with hundreds of figures, nearly any figure is one
   * step from two of them. A short context keeps the step it always had.
   */
  const written = new Set(figuresIn(answer).map(Math.abs));
  const crowded = known.size > 40;
  const oneStepAway = (f: number): boolean => {
    for (const a of known) {
      if (crowded && (!written.has(a) || a === f)) continue;
      if (known.has(f - a) || known.has(a - f)) return true;
    }
    return false;
  };

  const out: number[] = [];
  const seen = new Set<number>();

  for (const raw of figuresIn(answer)) {
    const f = Math.abs(raw);
    /*
     * Nothing hangs on a small round number. "the last 3 days", "2 entries",
     * "PHP 50.00" as a figure of speech: a guard that fires on those is a
     * guard nobody reads. Under a hundred pesos, and whole, is left alone.
     */
    if (f < 10_000 && f % 100 === 0) continue;
    if (seen.has(f)) continue;
    seen.add(f);

    if (known.has(f) || oneStepAway(f)) continue;
    out.push(raw);
  }

  return out;
}

/**
 * The line that goes under an answer carrying figures the app did not work
 * out, or "" when every figure checks out.
 *
 * Deliberately not an accusation and not a correction. It says which figures
 * the data does not hold and leaves the reading to the owner, the same way
 * the integrity checks report rather than change anything.
 */
export function untracedNote(answer: string, given: string, money: (c: number) => string): string {
  const loose = untracedFigures(answer, given);
  if (loose.length === 0) return "";

  const list = loose.map(money).join(", ");
  return loose.length === 1
    ? `${list} is not a figure this app worked out. Check it before you rely on it.`
    : `${list} are not figures this app worked out. Check them before you rely on them.`;
}
