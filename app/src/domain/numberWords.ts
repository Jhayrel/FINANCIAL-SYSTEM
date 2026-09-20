/**
 * Money written out in words.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The owner writes properly when the message is long: "This morning I
 * withdrew a thousand pesos from my Maya account into cash, and the bank
 * charged me fifteen pesos for the withdrawal." Every figure in that sentence
 * is a word, and the reader on this device found none of them, so a message
 * that reads perfectly well to a person was worth nothing without a model.
 *
 * The model happens to handle these, which is exactly why it matters: the
 * reader here is what answers when the model is off, rate limited or refusing
 * the size of the request, and those are the moments when the owner least
 * wants to retype a paragraph.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * No fractions, no decimals in words, no "half". Money is centavos and a
 * guess at "two and a half thousand" is a wrong figure that looks right. It
 * reads what is unambiguous and leaves the rest alone.
 */

const UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALES: Readonly<Record<string, number>> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
};

/** Words that can sit inside a written number without breaking it. */
const GLUE = new Set(["and", "a", "an"]);

const WORD = /[a-z]+/;

/**
 * Every number written in words, in the order they appear.
 *
 * "a thousand pesos ... fifteen pesos ... a hundred and twenty pesos" reads
 * as 1000, 15, 120. A run of words is one number: the run ends at anything
 * that is not part of one, which is what keeps "twenty pesos for thirty
 * minutes" from becoming a single figure.
 */
export function numbersInWords(text: string): number[] {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => WORD.test(w));
  const found: number[] = [];

  let total = 0;
  let current = 0;
  let open = false;
  /** "a" and "and" only count once something has started, or before a scale. */
  let pendingGlue = false;

  const close = (): void => {
    if (open) {
      const value = total + current;
      if (value > 0) found.push(value);
    }
    total = 0;
    current = 0;
    open = false;
    pendingGlue = false;
  };

  for (const word of words) {
    const unit = UNITS[word];
    const scale = SCALES[word];

    if (unit !== undefined) {
      current += unit;
      open = true;
      pendingGlue = false;
      continue;
    }

    if (scale !== undefined) {
      /*
       * "a hundred" and "hundred" both mean one of them. Without this, "a
       * hundred and twenty" started at zero and came out as twenty.
       */
      const multiplier = current === 0 ? 1 : current;
      if (scale === 1_000 || scale === 1_000_000) {
        total = (total + multiplier) * scale;
        current = 0;
      } else {
        current = multiplier * scale;
      }
      open = true;
      pendingGlue = false;
      continue;
    }

    if (GLUE.has(word)) {
      // "a" before a scale is part of the number; anywhere else it ends it.
      if (word === "and" && open) continue;
      if ((word === "a" || word === "an") && !open) {
        pendingGlue = true;
        continue;
      }
      if (pendingGlue) continue;
      close();
      continue;
    }

    close();
  }

  close();
  return found;
}

/**
 * The first number written in words, as centavos, or null.
 *
 * Whole pesos only: a written number has no centavos in it, and inventing
 * some would be a figure nobody typed.
 */
export function centavosInWords(text: string): number | null {
  const [first] = numbersInWords(text);
  return first === undefined ? null : first * 100;
}
