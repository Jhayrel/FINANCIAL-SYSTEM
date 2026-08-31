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

/**
 * A whole set named at once, rather than one row described.
 *
 * ── Why this is separate from `findRows` ──────────────────────────────────
 *
 * "delete all data entered by ai in financial dataabse" was asked three times
 * in three minutes and did nothing each time. `findRows` strips instruction
 * words and then matches on what is left, keeping only words longer than two
 * letters, so the phrase came down to "entered financial dataabse" and "ai",
 * the only word that mattered, was dropped for being two characters long.
 *
 * The deeper problem is that it is not a description of a row. Every rule in
 * `findRows` asks "which one did you mean", and the answer here is "all of
 * them, and you already know which because you wrote it on each one". Rows
 * carry `entrySource`, which is exactly this question answered at write time.
 *
 * So a sweep is its own thing: a named set, returned whole and uncapped,
 * because five of forty is not a useful answer to "delete all of them".
 */
export interface Sweep {
  readonly what: "ai";
  /** How to say it back, so the confirmation names the set and not a count. */
  readonly label: string;
}

/**
 * Naming the assistant's own entries.
 *
 * Both halves are required. "delete the ai suggestion" is about the card on
 * screen and must not sweep the ledger, so a quantifier has to be present:
 * nothing here fires without "all", "every" or "everything".
 */
const EVERYTHING = /\b(all|every|everything|entire|whole)\b/i;
const BY_THE_AI =
  /\b(ai|a\.i\.|assistant|bot|chatbot|robot|chat)\b/i;

/** A set the phrase names, or null when it names none. */
export function detectSweep(phrase: string): Sweep | null {
  if (!EVERYTHING.test(phrase) || !BY_THE_AI.test(phrase)) return null;
  return { what: "ai", label: "entered by the assistant" };
}

/**
 * Every row in the set. Not capped, and not scored.
 *
 * `entrySource` is written at the moment a row is saved and says which of the
 * two put it there, so this is a fact being read back rather than a guess
 * being made. Rows saved before the assistant existed have no `entrySource`
 * and are correctly left alone: absent is not "ai".
 */
export function sweepRows(
  sweep: Sweep,
  rows: readonly Transaction[],
): Transaction[] {
  if (sweep.what !== "ai") return [];
  return rows.filter((row) => row.entrySource === "ai");
}

/**
 * "discard all": throwing away every card on screen at once.
 *
 * Read a screenshot of a statement, got eleven cards back, and wanted none of
 * them. Typing "discard all" did nothing, so they were rejected one at a
 * time: eleven clicks in thirty seconds, at 09:31:27 through 09:31:48.
 *
 * This is not `detectSweep`. That names rows already in the ledger; this
 * names cards that have not been added to anything, so it is the cheapest,
 * most reversible action in the app. There is nothing to confirm: the cards
 * were never money.
 */
export function wantsDiscardAll(text: string): boolean {
  const said = text.trim();
  if (!said || said.length > 40) return false;
  if (!EVERYTHING.test(said)) return false;
  /**
   * `throw` bare, not "throw away".
   *
   * "throw them all away" puts two words between the halves, and a phrase
   * match wanted them adjacent. The quantifier and the length cap are what
   * make this safe, not the precision of the verb.
   */
  return /\b(discard|reject|throw|clear|cancel|delete|remove|no|nope|scrap|forget)\b/i.test(said);
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
