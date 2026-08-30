/**
 * Money: Philippine Peso, stored as integer centavos.
 *
 * The Excel system accumulated floating-point error in stored balances
 * (5795.740000000005, 155.7100000000064, 1527.5800000000027). Integers make
 * that impossible: parse once at the input boundary, format once at the render
 * boundary, and stay integral in between.
 *
 * Never use +, -, parseFloat or toFixed arithmetic on money elsewhere in the
 * app. Use the helpers here.
 */

/** An amount in integer centavos. 1 peso = 100 centavos. */
export type Centavos = number;

/** Largest amount we can represent without losing integer precision. */
const MAX_SAFE_CENTAVOS = Number.MAX_SAFE_INTEGER;

export const ZERO: Centavos = 0;

function assertValid(n: number, label: string): asserts n is Centavos {
  if (!Number.isFinite(n)) {
    throw new RangeError(`${label}: not a finite number (${n})`);
  }
  if (!Number.isInteger(n)) {
    throw new RangeError(`${label}: centavos must be an integer, got ${n}`);
  }
  if (Math.abs(n) > MAX_SAFE_CENTAVOS) {
    throw new RangeError(`${label}: amount out of safe integer range (${n})`);
  }
}

/**
 * Convert a peso value to centavos.
 *
 * Rounds half away from zero, so -0.005 -> -1 rather than 0, keeping negative
 * amounts symmetric with positive ones.
 */
export function toCentavos(pesos: number): Centavos {
  if (!Number.isFinite(pesos)) {
    throw new RangeError(`toCentavos: not a finite number (${pesos})`);
  }
  const scaled = pesos * 100;
  // Nudge past binary representation error (2.675 * 100 === 267.49999...)
  const rounded =
    scaled < 0
      ? -Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled))
      : Math.round(scaled + Number.EPSILON * scaled);
  assertValid(rounded, "toCentavos");
  return rounded;
}

/** Convert centavos to a peso number. For display and charts only. */
export function toPesos(c: Centavos): number {
  assertValid(c, "toPesos");
  return c / 100;
}

/**
 * Parse user input into centavos.
 *
 * Accepts "1,234.56", "₱1234.56", "P 1234.56", "1234", " 1 234,56 " is *not*
 * supported (comma is a thousands separator here, matching PH convention).
 * Returns null for anything unparseable, so callers can show a field error
 * rather than silently recording zero.
 */
export function parseAmount(input: string | number | null | undefined): Centavos | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? toCentavos(input) : null;
  }

  const cleaned = input
    .replace(/[₱P]/gi, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;

  try {
    return toCentavos(n);
  } catch {
    return null;
  }
}

const PESO_FORMAT = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PESO_FORMAT_COMPACT = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export interface FormatOptions {
  /** Prefix with "₱". Default true. */
  symbol?: boolean;
  /** Drop centavos when the amount is a whole peso. Default false. */
  compact?: boolean;
  /** Render negatives as "-₱1,234.56" rather than "₱-1,234.56". Default true. */
  signBeforeSymbol?: boolean;
}

/** Format centavos for display: 579574 -> "₱5,795.74" */
export function formatMoney(c: Centavos, options: FormatOptions = {}): string {
  const {
    symbol = true,
    compact = false,
    signBeforeSymbol = true,
  } = options;

  assertValid(c, "formatMoney");

  const negative = c < 0;
  const abs = Math.abs(c);
  const useCompact = compact && abs % 100 === 0;
  const body = (useCompact ? PESO_FORMAT_COMPACT : PESO_FORMAT).format(abs / 100);

  // U+2212 MINUS SIGN, never a hyphen: style guide §2.2.
  const MINUS = "−";
  const withSymbol = symbol ? `₱${body}` : body;
  if (!negative) return withSymbol;
  return signBeforeSymbol
    ? `${MINUS}${withSymbol}`
    : symbol
      ? `₱${MINUS}${body}`
      : `${MINUS}${body}`;
}

/** Format without the symbol: for table cells that carry it in the header. */
export function formatAmount(c: Centavos): string {
  return formatMoney(c, { symbol: false });
}

// ── arithmetic ─────────────────────────────────────────────────────────────
// Trivial, but named so money math is greppable and never mixes with
// dimensionless numbers by accident.

export function add(...amounts: Centavos[]): Centavos {
  let sum = 0;
  for (const a of amounts) sum += a;
  assertValid(sum, "add");
  return sum;
}

export function subtract(a: Centavos, b: Centavos): Centavos {
  const r = a - b;
  assertValid(r, "subtract");
  return r;
}

export function sum(amounts: readonly Centavos[]): Centavos {
  let total = 0;
  for (const a of amounts) total += a;
  assertValid(total, "sum");
  return total;
}

export function sumBy<T>(items: readonly T[], pick: (item: T) => Centavos): Centavos {
  let total = 0;
  for (const item of items) total += pick(item);
  assertValid(total, "sumBy");
  return total;
}

/** Multiply by a dimensionless factor (e.g. a 1.03 forecast buffer). */
export function scale(c: Centavos, factor: number): Centavos {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`scale: factor must be finite, got ${factor}`);
  }
  const r = Math.round(c * factor);
  assertValid(r, "scale");
  return r;
}

/** Divide into n parts, returning the (rounded) size of one part. */
export function divide(c: Centavos, divisor: number): Centavos {
  if (!Number.isFinite(divisor) || divisor === 0) {
    throw new RangeError(`divide: bad divisor ${divisor}`);
  }
  const r = Math.round(c / divisor);
  assertValid(r, "divide");
  return r;
}

/** Round to the nearest whole peso multiple (Module10 rounds to nearest ₱10). */
export function roundToPesos(c: Centavos, nearestPesos: number): Centavos {
  const step = nearestPesos * 100;
  if (step <= 0) throw new RangeError(`roundToPesos: bad step ${nearestPesos}`);
  return Math.round(c / step) * step;
}

export function clamp(c: Centavos, min: Centavos, max: Centavos): Centavos {
  return Math.min(Math.max(c, min), max);
}

/** Ratio of two amounts as a plain number, safe when the denominator is zero. */
export function ratio(numerator: Centavos, denominator: Centavos): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export const isZero = (c: Centavos): boolean => c === 0;
export const isNegative = (c: Centavos): boolean => c < 0;
export const isPositive = (c: Centavos): boolean => c > 0;
export const abs = (c: Centavos): Centavos => Math.abs(c);

/** Convenience for tests and fixtures: pesos(5795.74) === 579574 */
export const pesos = toCentavos;
