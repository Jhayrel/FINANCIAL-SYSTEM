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
    const spoken = known.filter((name) => names(flat, name));
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
