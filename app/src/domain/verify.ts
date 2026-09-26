/**
 * The check between the model reading a message and the app acting on it.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `domain/proposal.ts` checks every field the model sends, one at a time,
 * against the owner's own lists: a wallet that is not an account is dropped,
 * an item that is not on the list is flagged, an unreadable date falls back
 * to today, and the figure is compared with the characters the model says it
 * read off the page. All of that is about whether a field is well formed.
 *
 * Nothing compared the finished row back against the sentence it came from.
 * So a reading could pass every field check and still be wrong about the
 * message: the right shape, built from the wrong half of what was said. The
 * owner asked for the reading to be checked before it is handed to the code
 * that acts on it, and this is that check.
 *
 * ── Why it does not ask a model ───────────────────────────────────────────
 *
 * Asking a second time is another call, another wait, and another thing that
 * can be rate limited, to check work with the same tool that produced it. The
 * questions here are all answerable from the sentence and the owner's own
 * lists, which is arithmetic and string matching: it runs in under a
 * millisecond, works with no key and no network, and cannot itself be wrong
 * about the ledger.
 *
 * ── What it does not do ───────────────────────────────────────────────────
 *
 * Change anything. Every finding is a note on the card, next to the field it
 * is about, and the owner decides. `checkDraft` remains the only thing that
 * can stop a save, and a row this flags is still a row they can add.
 */

import { itemsFor, needs, type Draft, type FieldName } from "./entry";
import { numbersInWords } from "./numberWords";
import { matchExact, type Confidence } from "./proposal";
import type { IsoDate, ReferenceLists } from "./types";

/** Which question was asked of the reading. */
export type CheckName = "figure" | "wallet" | "item" | "date" | "ready";

export interface Finding {
  readonly check: CheckName;
  /** What it found, in the words the card will show. */
  readonly says: string;
}

export interface Verified {
  /** Everything worth saying, in the order it was checked. */
  readonly findings: readonly Finding[];
  /** The same, as lines for the card. */
  readonly notes: readonly string[];
  /** Every field this flow requires is filled in. */
  readonly ready: boolean;
  /** The ones that are not, when it is not. */
  readonly missing: readonly FieldName[];
  /** Never raised, only lowered: a reading with a question over it is not high. */
  readonly confidence: Confidence;
}

/**
 * The fields worth reporting as missing.
 *
 * Taken from `needs`, never listed here, so this cannot drift from the form
 * and from `checkDraft` the way a private copy would.
 */
const REQUIRED: readonly FieldName[] = ["date", "amount", "fromWallet", "toWallet"];

/** A sentence reduced to spaced words, so a name can be found whole. */
function flatten(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Whether a name appears in the sentence as a whole word run. */
function names(sentence: string, name: string): boolean {
  const flat = flatten(name).trim();
  return flat !== "" && sentence.includes(` ${flat} `);
}

/**
 * Somewhere you went, rather than something you bought.
 *
 * "School" is one of the owner's spending types and also an ordinary place.
 * "On the way to school I bought breakfast for a hundred and twenty pesos"
 * is a Food row, and the card told them "You named School but this was read
 * as Food. Check the item." The sentence does contain the word. It is not
 * naming the expense with it.
 *
 * A short list, and deliberately short. "to school", "at school", "from
 * school" are places. "in school fees" and "for school" are purchases, so
 * "in", "for", "on" and the Tagalog "sa" are all left out: "nagbayad ako sa
 * school" really is a school expense, and losing that to catch this would be
 * the worse trade.
 */
const WENT_THERE = /\b(?:to|at|from|near|outside|inside|toward|towards|past|around)$/;

/** The name appears, and at least once as a thing bought rather than a place. */
function namesAPurchase(sentence: string, name: string): boolean {
  const flat = flatten(name).trim();
  if (flat === "") return false;
  const needle = ` ${flat} `;

  for (let at = sentence.indexOf(needle); at !== -1; at = sentence.indexOf(needle, at + 1)) {
    if (!WENT_THERE.test(sentence.slice(0, at + 1).trimEnd())) return true;
  }
  return false;
}

/**
 * A figure written in a sentence, as integer centavos.
 *
 * No `parseFloat`: money is integer centavos end to end (CLAUDE.md), and the
 * whole point of this check is that a figure read one way and written another
 * is the mistake that matters most.
 */
export function centavosIn(token: string): number | null {
  const clean = token.replace(/,/g, "");
  const parts = clean.split(".");
  const whole = parts[0] ?? "";
  const frac = parts[1] ?? "";
  if (parts.length > 2) return null;
  if (!/^\d+$/.test(whole)) return null;
  if (frac !== "" && !/^\d{1,2}$/.test(frac)) return null;
  // Guard against a figure long enough to lose precision as a number.
  if (whole.length > 12) return null;
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/**
 * Every figure in a sentence, largest first, without the ones that name a
 * thing rather than a price: a shop ("sa 711"), or one of the owner's own
 * items with a number in it ("Microsoft Office 365").
 */
function figuresIn(said: string, reference?: ReferenceLists): number[] {
  let text = said.replace(/\b(?:7[\s-]?eleven|seven[\s-]?eleven|7[\s/-]?11|711|24[\s/-]?7)\b/gi, " ");
  if (reference) {
    const numbered = [
      ...reference.bills,
      ...reference.subscriptions,
      ...reference.spendingTypes.map((t) => t.name),
      ...reference.revenueCategories,
    ]
      .filter((name) => /\d/.test(name))
      .sort((a, b) => b.length - a.length);
    for (const name of numbered) {
      text = text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
    }
  }
  const found = text.match(/\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  return found
    .map(centavosIn)
    .filter((c): c is number => c !== null)
    .sort((a, b) => b - a);
}

const pesos = (centavos: number): string =>
  `PHP ${(centavos / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * A message in the pieces one row could have come from.
 *
 * Deliberately not `splitEntries`, which decides how many cards a message
 * makes and is tuned for the short way the owner types entries. This is the
 * other job: a paragraph written in full sentences, already turned into
 * cards by the model, being cut up only so each card can be checked against
 * its own words. Cutting too finely here costs nothing, because a piece that
 * holds no figure is never chosen.
 *
 * What it splits on, and what it will not:
 *
 *   - A full stop, question mark or exclamation followed by a space. The
 *     point inside "1,000.00" is followed by a digit, so it survives.
 *   - A comma followed by a space. The comma inside "1,000" is not.
 *   - "then".
 *   - "and", but only where a figure follows it. "a hundred and twenty" is
 *     one number and splitting it would turn PHP 120.00 into PHP 100.00,
 *     which is the whole reason this is not a plain split on the word.
 */
function clausesIn(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .flatMap((part) => part.split(/,\s+/))
    .flatMap((part) => part.split(/\s+then\s+/i))
    .flatMap((part) => part.split(/\s+and\s+(?=(?:₱|php\s*)?\d)/i))
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}

/**
 * The part of a message this row came from.
 *
 * ── Why a card cannot be checked against the whole paragraph ──────────────
 *
 * Every check below asks a question about "the sentence": did you write a
 * bigger figure than this, did you name a different wallet, did you name a
 * different item. All three assume the words describe this row and no other.
 *
 * A paragraph describes several. The owner wrote, on 20 September 2026:
 * "On the way to school I bought breakfast for a hundred and twenty pesos
 * using that cash, and at lunch I spent two hundred and fifty more at the
 * canteen." Two rows, one message. Both cards were checked against the whole
 * of it, so both carried "You named School but this was read as Food. Check
 * the item." Neither was about school. The word belonged to a clause that
 * was not theirs, and on a paragraph of four clauses nearly every card
 * collects a warning that belongs to a different one.
 *
 * So the row is matched to its own clause by its amount, in digits or in
 * words. When exactly one clause holds the figure, that clause is the
 * sentence. When none does, or several do, this returns nothing at all and
 * the sentence checks are skipped: a question asked of the wrong words is
 * worse than no question, because it teaches the owner to ignore the line.
 */
export function clauseFor(said: string, amount: number | null, reference?: ReferenceLists): string {
  const text = said.trim();
  if (text === "") return "";

  const parts = clausesIn(text);
  // One clause, or nothing to match on: the message is the sentence, as before.
  if (parts.length <= 1 || amount === null || amount <= 0) return text;

  const holds = (part: string): boolean =>
    figuresIn(part, reference).includes(amount) ||
    numbersInWords(part).some((n) => n * 100 === amount);

  const found = parts.filter(holds);
  return found.length === 1 ? (found[0] as string) : "";
}

/**
 * Check a reading against the sentence that produced it.
 *
 * `said` is the owner's own words. When there are none, which is the case for
 * a photo, the checks that need a sentence are skipped rather than guessed
 * at, and the readiness check still runs.
 */
export function verifyReading(
  draft: Draft,
  said: string,
  reference: ReferenceLists,
  asOf: IsoDate,
  was: Confidence = "medium",
): Verified {
  const findings: Finding[] = [];
  const sentence = said.trim();
  const flat = flatten(sentence);

  // ── The figure ──────────────────────────────────────────────────────────
  /**
   * A larger figure in the sentence than the one that was read.
   *
   * Only larger, and only against a figure that was actually read. A sentence
   * carrying a bigger number than the row is the case that loses money and
   * the one worth a second look; smaller numbers in a sentence are ordinary,
   * because dates, quantities and times are all small, and flagging those
   * would make this noise rather than a check.
   */
  if (sentence !== "" && draft.amount !== null && draft.amount > 0) {
    const biggest = figuresIn(sentence, reference)[0];
    if (biggest !== undefined && biggest > draft.amount && biggest !== draft.fee) {
      findings.push({
        check: "figure",
        says: `You wrote ${pesos(biggest)} and this was read as ${pesos(
          draft.amount,
        )}. Check the amount before adding it.`,
      });
    }
  }

  // ── The wallet ──────────────────────────────────────────────────────────
  /**
   * An account named in the sentence that is not the one on the row.
   *
   * Skipped entirely when a credit line is named. "Maya Credit" contains
   * "Maya", and a sentence about borrowing is about the line rather than the
   * account: reading the account out of it is the exact mistake that put
   * PHP 5,000 of borrowed money through a wallet.
   */
  const credits = reference.credits ?? [];
  const aboutACredit = credits.some((name) => names(flat, name));

  if (sentence !== "" && !aboutACredit && draft.flow !== "") {
    const accounts = [...reference.wallets, ...reference.savings];
    const spoken = accounts.filter((name) => names(flat, name));
    const side: "fromWallet" | "toWallet" =
      draft.flow === "Revenue" ? "toWallet" : "fromWallet";
    const chosen = draft[side];

    // One account named, and the row does not use it on the side it belongs.
    if (spoken.length === 1) {
      const only = spoken[0] ?? "";
      const usedAnywhere = draft.fromWallet === only || draft.toWallet === only;
      if (!usedAnywhere) {
        findings.push({
          check: "wallet",
          says:
            chosen === ""
              ? `You named ${only} and no wallet was filled in. Pick it before adding this.`
              : `You named ${only} but this was read as ${chosen}. Check the wallet.`,
        });
      }
    }
  }

  // ── The item ────────────────────────────────────────────────────────────
  /**
   * A thing named in the sentence that is not the item on the row.
   *
   * Only against the owner's own list for this flow and category, so a
   * sentence mentioning a word that happens to be a noun says nothing. A new
   * item is `readOne`'s business and is already flagged there.
   */
  if (sentence !== "" && draft.flow !== "") {
    const known = itemsFor(draft.flow, draft.category, reference);
    const spoken = known.filter((name) => namesAPurchase(flat, name));
    const chosen = matchExact(draft.item, known);

    if (spoken.length === 1) {
      const only = spoken[0] ?? "";
      if (chosen !== only) {
        findings.push({
          check: "item",
          says:
            draft.item.trim() === ""
              ? `You named ${only} and no item was filled in.`
              : `You named ${only} but this was read as ${draft.item}. Check the item.`,
        });
      }
    }
  }

  // ── The date ────────────────────────────────────────────────────────────
  // A row dated after today is almost always a year read wrong, and it moves
  // money into a month that has not happened.
  if (draft.date && draft.date > asOf) {
    findings.push({
      check: "date",
      says: `This is dated ${draft.date}, which is after today. Check the date.`,
    });
  }

  // ── Ready to hand over ──────────────────────────────────────────────────
  const missing = REQUIRED.filter((field) => {
    if (!needs(draft.flow, field)) return false;
    // A transfer that left the accounts has no destination, and that is the
    // answer rather than a gap (CLAUDE.md, "Transfers are derived").
    if (field === "toWallet" && draft.sentOut === true) return false;
    if (field === "amount") return draft.amount === null || draft.amount <= 0;
    if (field === "date") return draft.date === "";
    if (field === "fromWallet") return draft.fromWallet === "";
    return draft.toWallet === "";
  });

  if (missing.length > 0) {
    findings.push({
      check: "ready",
      says: `Still needs ${missing.length === 1 ? "one thing" : `${missing.length} things`}: ${missing
        .map(inWords)
        .join(", ")}.`,
    });
  }

  return {
    findings,
    notes: findings.map((f) => f.says),
    ready: missing.length === 0,
    missing,
    // A reading with a question hanging over it was never high confidence.
    confidence: findings.length > 0 ? "low" : was,
  };
}

/** A field name, as the form says it. */
function inWords(field: FieldName): string {
  switch (field) {
    case "amount":
      return "the amount";
    case "fromWallet":
      return "the wallet it came from";
    case "toWallet":
      return "the wallet it went to";
    case "date":
      return "the date";
    default:
      return field;
  }
}
