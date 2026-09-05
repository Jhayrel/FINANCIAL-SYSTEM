/**
 * The same receipt, twice.
 *
 * ── What went wrong ───────────────────────────────────────────────────────
 *
 * The owner uploads a photo, reads the card, gets distracted, and uploads the
 * same photo again. The recorded history has it plainly: one message carried
 * three files all called `image.png`, all 32,562 bytes, and the next carried
 * three more at 34,184 bytes each, every one of them reading as
 * "Spending, PHP 1,447.90". Nothing anywhere said "you have already got this
 * one". Three identical cards went up and the only thing standing between the
 * ledger and three identical rows was the owner noticing.
 *
 * A financial ledger cannot silently accept the same payment three times, and
 * it cannot silently refuse the third one either: buying the same coffee twice
 * in a day is a real thing that happens. So this reports, and never decides.
 * That is CLAUDE.md section 4: integrity checks report, they never
 * auto-correct.
 *
 * ── Why it carries its evidence ───────────────────────────────────────────
 *
 * "This might be a duplicate" is not actionable. You cannot tell from it
 * whether the machine spotted something real or is guessing, so you either
 * ignore every warning or you check every one by hand, and both of those are
 * the warning failing. Every match here arrives with the exact list of fields
 * that agree, in words, plus the row it agrees with and when that row was
 * added. Then the decision is yours and it takes two seconds.
 *
 * ── What counts ───────────────────────────────────────────────────────────
 *
 * The amount is the anchor: it must match to the centavo, because without it
 * there is nothing worth saying. Everything else scores. The flow must agree
 * when both are known, since PHP 300 in and PHP 300 out on one day is a pair
 * of ordinary rows, not a repeat.
 */

import { formatMoney } from "./money";
import { daysBetween, formatMedium } from "./dates";
import type { Draft } from "./entry";
import type { Transaction } from "./types";

/** How far apart two rows can sit and still be worth mentioning. */
const NEARBY_DAYS = 3;

/**
 * How far a word-for-word identical description reaches, and why it stops.
 *
 * A repeated description is strong evidence up to a point and then becomes
 * the opposite. "ANTHROPIC* CLAUDE.AI SUBSCRIPTION" for PHP 1,160.00 is
 * identical every month by design, and flagging next month's payment as a
 * repeat of this month's would put a warning on every subscription the owner
 * has. Ten days sits clear of every billing cycle in the ledger and still
 * covers the case this exists for: logging something a second time a week
 * later, having forgotten the first.
 */
const SAME_WORDS_DAYS = 10;

/**
 * How sure this is.
 *
 * `same` means every field that identifies an entry agrees: the day, the
 * amount, the direction, the wallet, and what it was for. `close` means the
 * amount and the direction agree and enough else does to be worth a look.
 */
export type Certainty = "same" | "close";

export interface Duplicate {
  /** The row already in the ledger. */
  readonly row: Transaction;
  readonly certainty: Certainty;
  /**
   * Why, in the words the card prints. One line per field that agrees,
   * strongest first, so the top line alone usually settles it.
   */
  readonly evidence: readonly string[];
  /** Ranking only. Never shown: a number is not evidence. */
  readonly score: number;
}

const clean = (value: string | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Both sides said something, and they said the same thing. */
const agree = (a: string | undefined, b: string | undefined): boolean => {
  const left = clean(a);
  return left !== "" && left === clean(b);
};

/**
 * The wallet this row moved money through, whichever end it used.
 *
 * Spending names the payer, Revenue names the receiver, and a Transfer names
 * both. Comparing "the wallet" rather than the two columns separately keeps a
 * Spending card matched against a Spending row without four cases.
 */
const walletsOf = (row: {
  readonly fromWallet: string;
  readonly toWallet: string;
}): readonly string[] => [row.fromWallet, row.toWallet].map(clean).filter((w) => w !== "");

/**
 * A binned row is not part of the ledger.
 *
 * `Transaction` has no `deletedAt`: a binned row is a `DeletedTransaction` in
 * a separate list, so a caller normally cannot pass one in. This is the belt
 * to that braces, and it matters more here than elsewhere, because warning
 * that an entry repeats something you have already thrown away is noise about
 * a decision you already made.
 */
const live = (t: Transaction): boolean =>
  !(t as Transaction & { deletedAt?: string }).deletedAt;

const sharedWallet = (a: readonly string[], b: readonly string[]): string | null => {
  for (const wallet of a) if (b.includes(wallet)) return wallet;
  return null;
};

/**
 * Which of the two wallet names to print, given one that agrees.
 *
 * `walletsOf` lower-cases for comparison, and a warning that says "both out of
 * maya" when the ledger says "Maya" reads as a different system talking.
 */
const asWritten = (
  row: { readonly fromWallet: string; readonly toWallet: string },
  lowered: string,
): string => (clean(row.fromWallet) === lowered ? row.fromWallet : row.toWallet);

/**
 * Rows that look like this draft is already in the ledger.
 *
 * Deleted rows are skipped. A row in the bin is one you have already decided
 * about, and warning that a new entry matches something you threw away is
 * noise about a decision you have made.
 *
 * `ignoreId` exists because editing a saved row and checking it again would
 * otherwise report the row against itself.
 */
export function duplicatesOf(
  draft: Draft,
  transactions: readonly Transaction[],
  options: { readonly ignoreId?: string | undefined; readonly most?: number } = {},
): readonly Duplicate[] {
  const amount = draft.amount;
  // Nothing to anchor on. A blank amount is a card that is not finished, and
  // zero matches half the ledger's fee column.
  if (amount === null || amount === 0) return [];

  const flow = draft.flow;
  const drafted = walletsOf(draft);
  const found: Duplicate[] = [];

  for (const row of transactions) {
    if (!live(row)) continue;
    if (options.ignoreId && row.id === options.ignoreId) continue;
    if (row.amount !== amount) continue;
    // PHP 300 received and PHP 300 spent are two rows, not one row twice.
    if (flow && row.type !== flow) continue;

    const apart = Math.abs(daysBetween(draft.date, row.date));
    const sameDescription = agree(draft.description, row.description) && apart <= SAME_WORDS_DAYS;

    // Far apart, with nothing in common but a figure. Every month has a 300.
    if (apart > NEARBY_DAYS && !sameDescription) continue;

    const evidence: string[] = [`Both ${formatMoney(amount)}.`];
    let score = 3;

    if (apart === 0) {
      evidence.push(`Both dated ${formatMedium(row.date)}.`);
      score += 3;
    } else {
      evidence.push(
        `${apart} day${apart === 1 ? "" : "s"} apart: this one ${formatMedium(draft.date)}, that one ${formatMedium(row.date)}.`,
      );
      score += 1;
    }

    if (sameDescription) {
      evidence.push(`Word for word the same description: "${row.description}".`);
      score += 3;
    }

    const sameItem = agree(draft.item, row.item);
    if (sameItem) {
      evidence.push(`Both ${row.item}.`);
      score += 2;
    }

    const wallet = sharedWallet(drafted, walletsOf(row));
    if (wallet) {
      evidence.push(`Both through ${asWritten(row, wallet)}.`);
      score += 2;
    }

    if (draft.fee !== 0 && draft.fee === row.fee) {
      evidence.push(`The same ${formatMoney(row.fee)} fee.`);
      score += 1;
    }

    /**
     * The amount agreeing on its own is a coincidence, not a duplicate.
     *
     * A ledger of 513 rows has plenty of PHP 100.00 in it. Something about
     * the row itself has to agree as well, or every card about a round figure
     * would carry a warning and the warning would stop being read.
     */
    if (!sameDescription && !sameItem && !wallet) continue;

    const certainty: Certainty =
      apart === 0 && (sameDescription || sameItem) && (wallet !== null || sameDescription)
        ? "same"
        : "close";

    found.push({ row, certainty, evidence, score });
  }

  return found
    .sort((a, b) => b.score - a.score || b.row.recordNumber - a.row.recordNumber)
    .slice(0, options.most ?? 3);
}

/**
 * The one line at the top of the warning.
 *
 * Says what it found and how sure it is, so the evidence underneath is read
 * as support for a claim rather than as a list to interpret.
 */
export function duplicateHeadline(match: Duplicate): string {
  const number = `#${String(match.row.recordNumber).padStart(4, "0")}`;
  return match.certainty === "same"
    ? `This is already in the ledger as ${number}.`
    : `This looks like ${number}, which is already in the ledger.`;
}

/**
 * Two cards in one batch proposing the same row.
 *
 * The same photo attached three times produces three cards, and none of them
 * is in the ledger yet, so `duplicatesOf` has nothing to compare against. This
 * compares the batch with itself. It returns the index of the earlier card
 * each later one repeats, so the first of a set keeps its place and only the
 * repeats are marked.
 */
export function repeatsWithin(drafts: readonly Draft[]): ReadonlyMap<number, number> {
  const repeats = new Map<number, number>();

  for (let i = 0; i < drafts.length; i++) {
    const later = drafts[i];
    if (!later || later.amount === null || later.amount === 0) continue;

    for (let j = 0; j < i; j++) {
      const earlier = drafts[j];
      if (!earlier) continue;
      if (earlier.amount !== later.amount) continue;
      if (earlier.date !== later.date) continue;
      if (earlier.flow !== later.flow) continue;
      if (!agree(earlier.item, later.item) && !agree(earlier.description, later.description)) {
        continue;
      }
      repeats.set(i, j);
      break;
    }
  }

  return repeats;
}
