/**
 * An amount far larger than anything of its kind before it.
 *
 * ── The figure this is for ────────────────────────────────────────────────
 *
 * On 2026-09-15 the Dashboard read September revenue of PHP 1,005,006.95 and
 * a net worth of PHP 937,921.32, against wallets that had held about
 * PHP 1,300 the month before. Nothing on any screen asked about it. Extra
 * zeros are not something the form can refuse, because a real windfall looks
 * exactly the same, but they are something it can ask about once, before the
 * row moves every total in the app.
 *
 * The test is deliberately blunt: five times the largest row of the same
 * kind, and at least PHP 10,000.00, with at least five rows of that kind to
 * judge by. A new ledger with three entries has nothing to compare against,
 * and a PHP 600 lunch after a PHP 100 one is not what this is about.
 */

import { addDays } from "./dates";
import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export const UNUSUAL_TIMES = 5;
/** PHP 10,000.00. Below this a slip costs less than the question would annoy. */
export const UNUSUAL_FLOOR: Centavos = 1_000_000;
const MIN_PEERS = 5;

type Kind = Pick<Transaction, "type" | "category" | "debtEffect">;

/** One key per kind: the type, and for a debt row its effect. Starting balances have none. */
export function kindKey(row: Kind): string | null {
  if (row.category === "Opening") return null;
  return row.type === "Debt" ? `Debt:${row.debtEffect ?? ""}` : row.type;
}

export interface Unusual {
  /** The largest row of the kind it is measured against. */
  readonly largest: Centavos;
  /** How many times larger, rounded down. */
  readonly times: number;
}

/** Whether `total` is unusual against these rows. Null when not, or with too little to go by. */
export function unusualAgainst(total: Centavos, peers: readonly Transaction[]): Unusual | null {
  if (total < UNUSUAL_FLOOR || peers.length < MIN_PEERS) return null;
  let largest = 0;
  for (const p of peers) if (p.total > largest) largest = p.total;
  if (largest <= 0 || total < largest * UNUSUAL_TIMES) return null;
  return { largest, times: Math.floor(total / largest) };
}

export interface UnusualRow extends Unusual {
  readonly row: Transaction;
}

/**
 * Rows from the last `days` that were unusual against every row of their
 * kind dated before them. Measured against what came before, so the row
 * cannot excuse itself, and a second large row after the first is not
 * flagged again.
 */
export function unusualRows(
  transactions: readonly Transaction[],
  asOf: IsoDate,
  days = 60,
): UnusualRow[] {
  const from = addDays(asOf, -days);
  const sorted = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.recordNumber - b.recordNumber,
  );
  const seen = new Map<string, { count: number; largest: Centavos }>();
  const out: UnusualRow[] = [];

  for (const t of sorted) {
    const key = kindKey(t);
    if (key === null) continue;
    const prior = seen.get(key) ?? { count: 0, largest: 0 };
    if (
      t.date > from &&
      t.date <= asOf &&
      prior.count >= MIN_PEERS &&
      prior.largest > 0 &&
      t.total >= UNUSUAL_FLOOR &&
      t.total >= prior.largest * UNUSUAL_TIMES
    ) {
      out.push({ row: t, largest: prior.largest, times: Math.floor(t.total / prior.largest) });
    }
    seen.set(key, { count: prior.count + 1, largest: Math.max(prior.largest, t.total) });
  }

  return out;
}
