/**
 * Finding a row you are talking about, to bin it or to bring it back.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * "delete the data I created yesterday about the groceries" is a perfectly
 * clear instruction to a person and was previously answered with a summary of
 * the month. It names a day and a thing, which is how anyone refers to an
 * entry they wrote, and both are in the ledger.
 *
 * ── Why it finds rather than deletes ──────────────────────────────────────
 *
 * It returns candidates, ranked, and nothing else. The caller shows them and
 * the owner presses a button. A sentence that matches three rows must never
 * pick one, and a sentence that matches one row must still be looked at:
 * deleting the wrong entry is a silent loss, and the whole point of a soft
 * delete is that a mistake is recoverable rather than that mistakes are fine.
 *
 * ── Why the bin is searched the same way ──────────────────────────────────
 *
 * "bring back the groceries I deleted" is the same sentence with the opposite
 * verb, and the same search answers it.
 */

import type { IsoDate, Transaction } from "./types";

export type RecallAction = "bin" | "restore";

export interface Recall {
  readonly action: RecallAction;
  /** The words left once the instruction is taken out, for matching on. */
  readonly phrase: string;
}

/** Getting rid of one. */
const BIN =
  /\b(delete|remove|erase|bin|cancel|undo|scrap|discard|take out|get rid of)\b/i;

/** Bringing one back. */
const RESTORE = /\b(restore|bring back|undelete|recover|put back|unbin|retrieve)\b/i;

/**
 * Words that describe the instruction rather than the row.
 *
 * Stripped before matching, so "delete the entry I created yesterday about
 * the groceries" is matched on "yesterday groceries" and not on "entry",
 * which every row would answer to.
 */
const INSTRUCTION =
  /\b(delete|remove|erase|bin|cancel|undo|scrap|discard|restore|bring|back|undelete|recover|put|unbin|retrieve|the|a|an|my|me|i|data|entry|entries|row|rows|record|records|transaction|transactions|that|this|about|for|from|with|of|created|made|added|wrote|logged|please|can|you|it|one|last)\b/gi;

export function detectRecall(text: string): Recall | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Restore first: "undelete" contains "delete".
  const action: RecallAction | null = RESTORE.test(trimmed)
    ? "restore"
    : BIN.test(trimmed)
      ? "bin"
      : null;
  if (!action) return null;

  const phrase = trimmed.replace(INSTRUCTION, " ").replace(/\s+/g, " ").trim();
  return { action, phrase };
}

const shift = (asOf: IsoDate, days: number): IsoDate => {
  const at = new Date(`${asOf}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/** A day named in the phrase, or null when none was. */
function dayIn(phrase: string, asOf: IsoDate): IsoDate | null {
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(phrase);
  if (iso?.[1]) return iso[1];

  const slashed = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(phrase);
  if (slashed) {
    const [, m, d, y] = slashed;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  if (/\bday before yesterday\b/i.test(phrase)) return shift(asOf, -2);
  if (/\byesterday\b/i.test(phrase)) return shift(asOf, -1);
  if (/\btoday\b/i.test(phrase)) return asOf;
  return null;
}

/** A figure in the phrase, two digits or more so a stray "2" is not one. */
function amountIn(phrase: string): number | null {
  const match = /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{1,2}|\d{2,})/i.exec(phrase);
  if (!match?.[1]) return null;
  const pesos = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(pesos) ? Math.round(pesos * 100) : null;
}

/** A record number, said as "#441" or "441". */
function numberIn(phrase: string): number | null {
  const hash = /#\s*(\d{1,5})\b/.exec(phrase);
  return hash?.[1] ? Number(hash[1]) : null;
}

export interface Candidate {
  readonly row: Transaction;
  /** Higher is a better match. Only for ordering. */
  readonly score: number;
  /** What matched, so the card can say why this one is here. */
  readonly why: readonly string[];
}

/** How many to put in front of someone. More than this is not a choice. */
const MOST = 5;

/**
 * Rows that answer to this phrase, best first.
 *
 * Every signal has to come from the phrase: a phrase naming nothing returns
 * nothing, rather than the whole ledger sorted arbitrarily. Being unable to
 * find a row is a fine outcome; offering the wrong one to be deleted is not.
 */
export function findRows(
  phrase: string,
  rows: readonly Transaction[],
  asOf: IsoDate,
): Candidate[] {
  const day = dayIn(phrase, asOf);
  const amount = amountIn(phrase);
  const number = numberIn(phrase);

  const words = phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));

  if (!day && amount === null && number === null && words.length === 0) return [];

  const scored: Candidate[] = [];

  for (const row of rows) {
    let score = 0;
    const why: string[] = [];

    // A record number is unambiguous, and outranks everything else.
    if (number !== null && row.recordNumber === number) {
      score += 100;
      why.push(`record #${String(row.recordNumber).padStart(4, "0")}`);
    }

    if (day && row.date === day) {
      score += 10;
      why.push(row.date);
    }

    if (amount !== null && row.amount === amount) {
      score += 8;
      why.push("the amount");
    }

    const haystack = `${row.item} ${row.description} ${row.category} ${row.fromWallet} ${row.toWallet}`.toLowerCase();
    const hits = words.filter((w) => haystack.includes(w));
    if (hits.length > 0) {
      score += hits.length * 5;
      why.push(hits.join(", "));
    }

    if (score > 0) scored.push({ row, score, why });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.row.recordNumber - a.row.recordNumber)
    .slice(0, MOST);
}
