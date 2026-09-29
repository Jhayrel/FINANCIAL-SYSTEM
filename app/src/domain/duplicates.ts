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
  /**
   * The other rows, when one line on a statement is two rows here: the
   * ₱30,010.00 GCash sent to PNB was logged as ₱5,010.00 of the owner's own
   * and ₱25,000.00 held for a relative. `row` is the largest of them.
   */
  readonly also?: readonly Transaction[];
}

const clean = (value: string | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Both sides said something, and they said the same thing. */
const agree = (a: string | undefined, b: string | undefined): boolean => {
  const left = clean(a);
  return left !== "" && left === clean(b);
};

/**
 * Two wallet names that are the same, counting two blanks as the same.
 *
 * A Spending row has no destination on either side, and that agreement is
 * real: neither of them went anywhere. `agree` deliberately refuses two
 * blanks, because it is used where a blank means "not stated", and here a
 * blank means "there is no such end to this movement".
 */
const same = (a: string, b: string): boolean => clean(a) === clean(b);

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
  options: {
    readonly ignoreId?: string | undefined;
    readonly most?: number;
    /**
     * Typed rather than read off a picture. A typed entry's date is the day
     * it happened, so another row a day or two away is another purchase:
     * "gas 300" today was reported as yesterday's ₱300.00 of gas (28
     * September 2026), which is a routine, not a repeat. A picture's rows are
     * dated by reading a screen, which is where the wider window is for.
     */
    readonly typed?: boolean;
  } = {},
): readonly Duplicate[] {
  const nearby = options.typed ? 0 : NEARBY_DAYS;
  const otherKindDays = options.typed ? 0 : 2;
  const amount = draft.amount;
  // Nothing to anchor on. A blank amount is a card that is not finished, and
  // zero matches half the ledger's fee column.
  if (amount === null || amount === 0) return [];

  const flow = draft.flow;
  const found: Duplicate[] = [];

  for (const row of transactions) {
    if (!live(row)) continue;
    if (options.ignoreId && row.id === options.ignoreId) continue;
    /*
     * The figure a statement shows is what left the account, fee and all.
     * "BAUANG CROSSING -1,518.00" is the ledger's withdrawal of ₱1,500.00
     * with its ₱18.00 fee, and "Sent GCash to Maya -9,990.00" is ₱9,980.00
     * with ₱10.00 (28 September 2026): compared on the amount alone, neither
     * was found. Either side's total counts, as well as its amount.
     */
    const byTotal =
      row.amount !== amount && (row.total === amount || row.total === amount + draft.fee || (draft.fee > 0 && row.amount === amount + draft.fee));
    if (row.amount !== amount && !byTotal) continue;
    const apart = Math.abs(daysBetween(draft.date, row.date));
    const figure = byTotal
      ? `${formatMoney(row.amount)} plus its ${formatMoney(row.fee)} fee there, ${formatMoney(row.total)} in all`
      : formatMoney(amount);
    // PHP 300 received and PHP 300 spent are two rows, not one row twice.
    if (flow && row.type !== flow) {
      /*
       * Unless it is the same money filed as another kind: the same amount
       * out of the same wallet, or into it, within a day. Maya's "Withdrawal
       * from 00201002 SF LA UNION" of PHP 2.00 was in the ledger as Unknown
       * spending and went in again as a withdrawal to Cash (27 September
       * 2026), because a withdrawal and a spending were never compared.
       */
      /*
       * Two days either way: a list's rows are dated by headings that are
       * easy to misread by one group (28 September 2026). A card that names
       * no account at all ("Bills Payment for Maya Bank", read with neither
       * end) still compares, on a figure no ordinary purchase shares.
       */
      const noWallet = !draft.fromWallet.trim() && !draft.toWallet.trim();
      const distinctive = amount % 100 !== 0 || amount >= 100_000;
      const wallet = sameMoneyOtherKind(draft, row) || (noWallet && distinctive && apart <= 1 ? "with no account named on this card" : "");
      if (!wallet || apart > otherKindDays) continue;
      found.push({
        row,
        certainty: "close",
        evidence: [
          `Both ${figure} ${wallet}, ${apart === 0 ? "the same day" : apart === 1 ? "a day apart" : "two days apart"}.`,
          `That one is filed as ${row.type}${row.item ? `, ${row.item}` : ""}; this one as ${flow}. If it is the same money, keep one and fix its kind there.`,
        ],
        score: apart === 0 ? 5 : 4,
      });
      continue;
    }

    const sameDescription = agree(draft.description, row.description) && apart <= SAME_WORDS_DAYS;

    // Far apart, with nothing in common but a figure. Every month has a 300.
    if (apart > nearby && !sameDescription) continue;

    const evidence: string[] = [`Both ${figure}.`];
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

    /**
     * ── Both ends, not one ─────────────────────────────────────────────
     *
     * Sharing a single wallet used to be enough, and for a transfer that is
     * almost no evidence at all. A PHP 5,000 movement out of Maya today was
     * reported as a duplicate of two other PHP 5,000 movements out of Maya
     * today, on the strength of: same amount, same date, "both through
     * Maya". One of them went to Cash and the other did not, which is the
     * only thing that distinguishes a transfer from another transfer, and it
     * was not being compared.
     *
     * Transfers have no item either, so the item test could not save it. The
     * owner put it plainly: it was calling things duplicates off the amount
     * alone.
     *
     * So both ends have to agree. Two blanks agree with each other, which is
     * what makes this work for Spending, where the destination is always
     * blank on both sides.
     */
    /*
     * A transfer whose other end is still to be said ("my own", from a
     * statement that shows only its own side) agrees at that end with any
     * account, so long as the end it does name agrees.
     */
    const open = flow === "Transfer" && !draft.sentOut;
    const fromOpen = open && !draft.fromWallet.trim() && draft.toWallet.trim() !== "";
    const toOpen = open && !draft.toWallet.trim() && draft.fromWallet.trim() !== "" && row.toWallet.trim() !== "";
    const sameFrom = fromOpen || same(draft.fromWallet, row.fromWallet);
    const sameTo = toOpen || same(draft.toWallet, row.toWallet);
    const sameWallets = sameFrom && sameTo;

    if (sameWallets) {
      const named = [draft.fromWallet.trim() && `out of ${row.fromWallet}`, draft.toWallet.trim() && `into ${row.toWallet}`]
        .filter(Boolean)
        .join(", ");
      if (named) evidence.push(`Both ${named}.`);
      score += 2;
    }

    // The same row in another wallet is the case that moves a balance: say which side is wrong to check.
    if (!sameWallets && (sameDescription || sameItem)) {
      const where = (from: string, to: string): string => (to ? `into ${to}` : from ? `out of ${from}` : "with no wallet");
      evidence.push(
        `That one is ${where(row.fromWallet, row.toWallet)}, this one ${where(draft.fromWallet, draft.toWallet)}. If it is the same money, one of them has the wrong wallet.`,
      );
    }

    if (draft.fee !== 0 && draft.fee === row.fee) {
      evidence.push(`The same ${formatMoney(row.fee)} fee.`);
      score += 1;
    }

    /**
     * The amount agreeing on its own is a coincidence, not a duplicate.
     *
     * A ledger of 567 rows has plenty of PHP 100.00 in it, and plenty of
     * PHP 5,000.00 moved out of Maya. Something that identifies the movement
     * has to agree as well, or every card about a round figure carries a
     * warning and the warning stops being read.
     */
    if (!sameDescription && !sameItem && !sameWallets) continue;

    const certainty: Certainty =
      apart === 0 && sameWallets && (sameDescription || sameItem)
        ? "same"
        : "close";

    found.push({ row, certainty, evidence, score });
  }

  if (found.length === 0 && !options.typed) {
    const parts = partsOf(draft, transactions, options.ignoreId);
    if (parts) return [parts];
  }

  return found
    .sort((a, b) => b.score - a.score || b.row.recordNumber - a.row.recordNumber)
    .slice(0, options.most ?? 3);
}

/**
 * One statement line that is two or three rows here.
 *
 * "Sent GCash to Philippine N... -30,010.00" was logged as ₱5,010.00 sent to
 * the owner's business account and ₱25,000.00 of a relative's money passed
 * on; "Send Money +40,000.00" as ₱15,000.00 of allowance and ₱25,000.00 held
 * for the funeral (27 September 2026). The statement shows one movement and
 * the ledger rightly shows its parts. Rows through the same account, the
 * same way, within a day, that add up to the line to the centavo.
 */
function partsOf(draft: Draft, transactions: readonly Transaction[], ignoreId?: string): Duplicate | null {
  const amount = draft.amount;
  if (amount === null || amount <= 0) return null;
  const out = draft.flow !== "Revenue" ? draft.fromWallet.trim() : "";
  const into = draft.flow !== "Spending" && !out ? draft.toWallet.trim() : "";
  if (!out && !into) return null;
  const wallet = out || into;
  const figureOf = (t: Transaction): number => (out ? t.total : t.amount);
  /*
   * Between two of the owner's own accounts, the parts go the same way at
   * both ends. A ₱1,000.00 withdrawal from Maya into Cash was "#0280 and
   * #0281 together", ₱700.00 and ₱300.00 spent out of Maya the same day
   * (29 September 2026): purchases are not a withdrawal in parts.
   */
  const alsoInto = draft.flow === "Transfer" && out ? draft.toWallet.trim() : "";
  const near = transactions
    .filter((t) => live(t) && t.id !== ignoreId && Math.abs(daysBetween(draft.date, t.date)) <= 1)
    .filter((t) => (out ? same(t.fromWallet, wallet) : same(t.toWallet, wallet)) && figureOf(t) > 0 && figureOf(t) < amount)
    .filter((t) => !alsoInto || same(t.toWallet, alsoInto))
    .slice(0, 16);
  const targets = [amount, amount + draft.fee];
  let best: Transaction[] | null = null;
  for (let i = 0; i < near.length && !best; i += 1) {
    for (let j = i + 1; j < near.length && !best; j += 1) {
      const a = near[i]!;
      const b = near[j]!;
      if (targets.includes(figureOf(a) + figureOf(b))) best = [a, b];
      for (let k = j + 1; k < near.length && !best; k += 1) {
        const c = near[k]!;
        if (targets.includes(figureOf(a) + figureOf(b) + figureOf(c))) best = [a, b, c];
      }
    }
  }
  if (!best) return null;
  const parts = [...best].sort((a, b) => figureOf(b) - figureOf(a));
  const [row, ...also] = parts;
  if (!row) return null;
  const numbered = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")} (${formatMoney(figureOf(t))})`;
  return {
    row,
    also,
    certainty: "close",
    evidence: [
      `${parts.map(numbered).join(" and ")} come to ${formatMoney(amount)} ${out ? `out of ${wallet}` : `into ${wallet}`}, ${parts.every((t) => t.date === draft.date) ? "the same day" : "within a day"}.`,
      "The statement shows one movement; the ledger has it in parts.",
    ],
    score: 4,
  };
}

/**
 * The wallet two rows of different kinds both move money through, in words,
 * or "" when they do not: out of it for both, or into it for both.
 *
 * A transfer moves money at both of its ends, and either end can be the one
 * a statement shows. The owner sent ₱9,980.00 from GCash to Maya and logged
 * it; Maya's own history then showed it as "Received money from" their own
 * name, read as income into Maya, and it was offered as a new entry because
 * a transfer only ever counted as money out (27 September 2026). Into Maya is
 * into Maya, whichever kind of row says so.
 */
function sameMoneyOtherKind(draft: Draft, row: Transaction): string {
  const draftOut = draft.flow === "Revenue" ? "" : draft.fromWallet.trim();
  const draftIn = draft.flow === "Spending" ? "" : draft.toWallet.trim();
  if (draftOut && same(draftOut, row.fromWallet)) return `out of ${row.fromWallet}`;
  if (draftIn && same(draftIn, row.toWallet)) return `into ${row.toWallet}`;
  return "";
}

/**
 * The one line at the top of the warning.
 *
 * Says what it found and how sure it is, so the evidence underneath is read
 * as support for a claim rather than as a list to interpret.
 */
export function duplicateHeadline(match: Duplicate): string {
  const number = `#${String(match.row.recordNumber).padStart(4, "0")}`;
  if (match.also && match.also.length > 0) {
    const all = [match.row, ...match.also].map((t) => `#${String(t.recordNumber).padStart(4, "0")}`);
    return `This looks like ${all.slice(0, -1).join(", ")} and ${all[all.length - 1]} together, already in the ledger.`;
  }
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

/**
 * One warning, standing for every match that gives the same reasons.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The owner sent the same paragraph three times while testing, so the ledger
 * holds three identical rows: #0560, #0564 and #0567, all "lunch at the
 * canteen", all PHP 250.00, all out of Cash on the same day. The fourth card
 * matched all three, and the card printed the whole warning once per match:
 * three headlines, three row lines, and the same five reasons written out
 * three times. Eighteen lines saying one thing.
 *
 * A warning that long is a warning nobody finishes reading, and the record
 * shows this one being overridden 31 times. The reasons are identical
 * because the rows are identical, so they are said once and the record
 * numbers are listed.
 */
export interface DuplicateGroup {
  readonly headline: string;
  /** The rows this covers, strongest first. Never empty. */
  readonly rows: readonly Duplicate[];
  /** Why, written once for all of them. */
  readonly evidence: readonly string[];
}

/** "#0567", "#0567 and #0564", "#0567, #0564 and #0560". */
function listNumbers(rows: readonly Duplicate[]): string {
  const numbers = rows.map((d) => `#${String(d.row.recordNumber).padStart(4, "0")}`);
  if (numbers.length <= 1) return numbers[0] ?? "";
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/** Plain words up to the three the card will ever show. */
const HOW_MANY: Readonly<Record<number, string>> = { 2: "twice", 3: "three times" };

export function groupDuplicates(matches: readonly Duplicate[]): readonly DuplicateGroup[] {
  const byReason = new Map<string, Duplicate[]>();

  for (const match of matches) {
    // The same reasons and the same certainty is the same warning.
    const key = `${match.certainty}|${match.evidence.join("|")}`;
    const group = byReason.get(key);
    if (group) group.push(match);
    else byReason.set(key, [match]);
  }

  return [...byReason.values()].map((rows) => {
    const first = rows[0] as Duplicate;
    if (rows.length === 1) {
      return { headline: duplicateHeadline(first), rows, evidence: first.evidence };
    }

    const times = HOW_MANY[rows.length] ?? `${rows.length} times`;
    const headline =
      first.certainty === "same"
        ? `Already in the ledger ${times}, as ${listNumbers(rows)}.`
        : `${rows.length} rows in the ledger look like this: ${listNumbers(rows)}.`;

    return { headline, rows, evidence: first.evidence };
  });
}
