/**
 * The model writes the sum; this device works it out.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * Language models reason well and add badly. The research on numerical
 * questions over financial data says the same thing several ways: PAL
 * (Gao et al., ICML 2023, github.com/reasoning-machines/pal) and Program of
 * Thoughts (Chen et al., 2022, github.com/wenhuchen/Program-of-Thoughts,
 * tested on FinQA, ConvFinQA and TAT-QA) both have the model write the
 * calculation as a program and hand the arithmetic to an interpreter, and
 * both beat answers where the model does the arithmetic in its own words.
 * FinQA (github.com/czyssrs/FinQA) writes each answer as a small program
 * over figures taken from the report, never over figures made up on the way.
 *
 * This app's rule has always been that the model never does arithmetic, and
 * every figure it writes is checked back (`aiFigures.ts`). When a question
 * needed a sum the app had not worked out, the model did it anyway and the
 * figure was flagged as one the app had not worked out, under an answer that
 * was right (owner's screenshot, 9 November 2026). So the model is given a
 * calculator. It writes `{{calc: 30000 - 2500}}` for pesos, or
 * `{{count: 500 / 90}}` for how many, and the device works it out
 * exactly, in whole centavos, and puts the result in its place.
 *
 * ── What makes a result the app's own ──────────────────────────────────────
 *
 * Every peso amount in the expression must be a figure the app gave the
 * model, word for word (FinQA's rule: the program's numbers come from the
 * report). Small whole numbers are allowed as counts and factors: 2 for
 * twice, 22 for days left, 100 for a percentage. A result built on a peso
 * figure nobody gave is still worked out exactly, and is still flagged
 * underneath, because the input was the guess.
 */
import { formatMoney } from "./money";

/** A calculation the model asked for: pesos, or a count. */
const CALC = /\{\{\s*(calc|count)\s*:\s*([^{}]{1,240}?)\s*\}\}/gi;

interface Fraction {
  readonly n: bigint;
  readonly d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};
const make = (n: bigint, d: bigint): Fraction => {
  if (d === 0n) throw new Error("division by zero");
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
};
const add = (a: Fraction, b: Fraction): Fraction => make(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Fraction, b: Fraction): Fraction => make(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Fraction, b: Fraction): Fraction => make(a.n * b.n, a.d * b.d);
const div = (a: Fraction, b: Fraction): Fraction => make(a.n * b.d, a.d * b.n);

/** Rounded half away from zero to a whole number of `unit`ths (100 for centavos). */
function rounded(f: Fraction, unit: bigint): bigint {
  const scaled = f.n * unit;
  const q = scaled / f.d;
  const r = scaled % f.d;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice >= f.d) return q + (scaled < 0n ? -1n : 1n);
  return q;
}

interface Operand {
  readonly value: Fraction;
  /** In whole centavos. */
  readonly centavos: number;
  /** Written as money: a peso sign, two decimals, or thousands separators. */
  readonly money: boolean;
}

/** "30,000", "2500.25", "PHP 1,000.00", "₱85". */
function operand(raw: string): Operand | null {
  const money = /(?:php|₱)/i.test(raw) || /\.\d{2}\b/.test(raw) || /\d,\d{3}/.test(raw);
  const clean = raw.replace(/php|₱|,|\s/gi, "");
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const [whole = "0", part = ""] = clean.split(".");
  const d = 10n ** BigInt(part.length);
  const value = make(BigInt(whole) * d + BigInt(part || "0"), d);
  return { value, centavos: Number(rounded(value, 100n)), money };
}

/**
 * The expression worked out exactly: + − × ÷ and brackets, the usual order.
 * Null for anything else, which is left for the owner to read as written.
 */
export function evaluate(expression: string): { readonly value: Fraction; readonly operands: readonly Operand[] } | null {
  // The minus sign and the dash a model may type for minus, built from their codes: the source keeps no dash of its own (rule W1).
  const minus = new RegExp(`[${String.fromCharCode(0x2212)}${String.fromCharCode(0x2013)}]`, "g");
  const text = expression.replace(minus, "-").replace(/[×]/g, "*").replace(/[÷]/g, "/");
  const tokens: string[] = [];
  const re = /\s*((?:php\s*|₱\s*)?\d[\d,]*(?:\.\d+)?|[-+*/()])/giy;
  let at = 0;
  while (at < text.length) {
    if (/^\s*$/.test(text.slice(at))) break;
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m || m.index !== at) return null;
    tokens.push(m[1] as string);
    at = re.lastIndex;
  }
  if (tokens.length === 0 || tokens.length > 60) return null;
  const operands: Operand[] = [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  // expr := term (("+"|"-") term)*; term := factor (("*"|"/") factor)*; factor := "-" factor | number | "(" expr ")"
  const factor = (): Fraction => {
    const t = tokens[i++];
    if (t === undefined) throw new Error("end");
    if (t === "-") return sub(make(0n, 1n), factor());
    if (t === "(") {
      const v = expr();
      if (tokens[i++] !== ")") throw new Error("bracket");
      return v;
    }
    const o = operand(t);
    if (!o) throw new Error("number");
    operands.push(o);
    return o.value;
  };
  const term = (): Fraction => {
    let v = factor();
    while (peek() === "*" || peek() === "/") v = tokens[i++] === "*" ? mul(v, factor()) : div(v, factor());
    return v;
  };
  const expr = (): Fraction => {
    let v = term();
    while (peek() === "+" || peek() === "-") v = tokens[i++] === "+" ? add(v, term()) : sub(v, term());
    return v;
  };
  try {
    const value = expr();
    if (i !== tokens.length) return null;
    return { value, operands };
  } catch {
    return null;
  }
}

export interface Calculated {
  /** The answer with every calculation replaced by its result. */
  readonly text: string;
  /** Peso results built only on figures the app gave: traceable, so never flagged. */
  readonly trusted: readonly number[];
  /** How many calculations were worked out. */
  readonly done: number;
}

/**
 * Every `{{calc: ...}}` and `{{count: ...}}` in an answer, worked out.
 *
 * `known` holds the peso figures the app gave the model, in centavos, as
 * absolute values. A calculation the device cannot read is left as its
 * expression, without the braces, so nothing reads as broken.
 */
export function resolveCalcs(answer: string, known: ReadonlySet<number>): Calculated {
  const trusted: number[] = [];
  let done = 0;
  const text = answer.replace(CALC, (_whole, kind: string, expression: string) => {
    const result = evaluate(expression);
    if (!result) return expression.trim();
    done += 1;
    // How many whole ones fit: 500 / 90 pays for 5 sessions, not 5.56.
    if (kind.toLowerCase() === "count") {
      const v = result.value;
      const whole = v.n / v.d - (v.n % v.d !== 0n && v.n < 0n ? 1n : 0n);
      return String(whole);
    }
    const centavos = Number(rounded(result.value, 100n));
    // Small whole numbers are counts and factors; anything written as money, or large, must be the app's.
    const grounded = result.operands.every((o) => known.has(Math.abs(o.centavos)) || (!o.money && o.centavos % 100 === 0 && o.centavos <= 100_000));
    if (grounded) trusted.push(Math.abs(centavos));
    const shown = formatMoney(Math.abs(centavos)).replace(/^₱/, "PHP ");
    return centavos < 0 ? `-${shown}` : shown;
  });
  return { text, trusted, done };
}

/** The rule the model is given, said once, for the chat's instruction (`functions/api/ai.ts` keeps its own copy). */
export const CALC_RULE =
  "When the answer needs a sum the app did not work out, never do it yourself: write it as {{calc: 30000 - 2500 - 4000}} using only figures from the data, and the app works it out exactly and shows the result in its place. For how many whole ones fit, write {{count: 500 / 90}} (it gives 5).";
