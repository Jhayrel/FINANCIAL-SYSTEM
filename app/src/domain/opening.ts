/**
 * Starting balances.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 *
 * Every ledger has to start somewhere. On day one you already have money: some
 * in Maya, some in cash, some in a savings account. None of it is income. You
 * did not earn it today, you just started counting today.
 *
 * The Excel had no way to say that, so it used a revenue category called
 * "Transfer of balance" and booked the lot as income. Records #1 to #5 are the
 * 2025 carry-forward doing exactly that: PHP 953.89 of money already owned,
 * reported as 2026 earnings. It is the same defect as booking a debt draw as
 * revenue, and it inflates the one number a budget is measured against.
 *
 * ── What replaces it ──────────────────────────────────────────────────────
 *
 * A starting balance is its own thing: `category: "Opening"`. It credits the
 * account exactly like any other inflow, because rule 3.1 credits a
 * destination wallet regardless of type, and it is excluded from income
 * everywhere income is reported.
 *
 * Two moments need it, and only two:
 *
 *   FIRST RUN     You are new. Enter what each account holds right now.
 *   ARCHIVING     Old years are being trimmed out of the working ledger, so
 *                 the balance they carried has to be written down. See
 *                 `domain/year.ts`.
 *
 * A year ending is NOT one of them. The ledger is continuous: 1 January opens
 * with whatever 31 December closed with, because it is the same running sum.
 * Nothing needs carrying, which is why "Transfer of balance" has no successor
 * as a yearly ritual.
 */

import { walletBalance } from "./balances";
import type { Account } from "./accounts";
import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

/** The category that means "this is where the money started". */
export const OPENING_CATEGORY = "Opening";
export const OPENING_ITEM = "Opening balance";

/** The revenue category the Excel used for this. Offering it again would repeat the mistake. */
export const OBSOLETE_REVENUE_CATEGORY = "Transfer of balance";

export interface StartingBalance {
  readonly account: string;
  readonly amount: Centavos;
}

/**
 * Build the opening rows.
 *
 * Zero balances are skipped. An opening row saying an account started empty
 * tells you nothing and clutters the first page of the ledger.
 */
export function openingRows(
  balances: readonly StartingBalance[],
  date: IsoDate,
  nextRecordNumber: number,
): Transaction[] {
  return balances
    .filter((b) => b.amount !== 0)
    .map((b, i) => ({
      id: `opening-${slug(b.account)}-${date}`,
      recordNumber: nextRecordNumber + i,
      date,
      // Revenue so that rule 3.1 credits the destination. `Opening` is what
      // keeps it out of the income line.
      type: "Revenue" as const,
      fromWallet: "",
      toWallet: b.account,
      category: OPENING_CATEGORY as Transaction["category"],
      item: OPENING_ITEM,
      description: `Starting balance for ${b.account}`,
      amount: b.amount,
      fee: 0,
      total: b.amount,
      notes: "",
      status: "Done" as const,
    }));
}

/** True once any account has a starting balance recorded. */
export function hasOpeningBalances(transactions: readonly Transaction[]): boolean {
  return transactions.some((t) => t.category === OPENING_CATEGORY);
}

/**
 * Accounts that have never had a starting balance and hold nothing.
 *
 * These are the ones a new owner still has to fill in. An account already
 * carrying transactions is not offered: its balance is already the truth, and
 * adding an opening row on top would double it.
 */
export function accountsNeedingOpening(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): Account[] {
  return accounts.filter(
    (a) => !a.archived && walletBalance(transactions, a.name) === 0 && !hasOpeningFor(transactions, a.name),
  );
}

function hasOpeningFor(transactions: readonly Transaction[], account: string): boolean {
  return transactions.some(
    (t) => t.category === OPENING_CATEGORY && t.toWallet === account,
  );
}

export interface OpeningCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Whether a starting balance can be added for this account.
 *
 * The one refusal that matters: an account that already holds money does not
 * need a starting balance, and adding one would silently double it. That is
 * the mistake this whole module exists to prevent, so it is refused rather
 * than warned about.
 */
/** How many entries make a ledger no longer new. */
const SETUP_GRACE = 0;

/**
 * Whether a starting balance can be set for this account.
 *
 * ── The rule, and why the first version of it was wrong ──────────────────
 *
 * A starting balance is only meaningful while you are setting the system up.
 * It says what an account already held on the day the record begins, which is
 * a statement about the past, and the only moment that statement can be made
 * honestly is before there is a past to contradict it.
 *
 * The first version offered it whenever an account's balance was zero. That
 * looked reasonable and produced a lie: an account sitting at zero in August
 * was offered a starting balance, took it, and the row was dated back to
 * January, so the ledger then claimed the money had been there all year. It
 * had not. It arrived in August.
 *
 * Money reaching an account partway through is not a starting balance. It is
 * a Transfer if it came from somewhere else you track, or Revenue if it came
 * from outside, and either way it belongs on the day it happened. Both of
 * those already exist on the Add screen, which is why the option disappears
 * rather than being replaced by anything.
 */
export function canSetOpening(
  account: string,
  transactions: readonly Transaction[],
): OpeningCheck {
  if (hasOpeningFor(transactions, account)) {
    return {
      ok: false,
      reason: `${account} already has a starting balance. Edit that row instead of adding another.`,
    };
  }

  const balance = walletBalance(transactions, account);
  if (balance !== 0) {
    return {
      ok: false,
      reason: `${account} already has transactions and a balance. A starting balance would be counted on top of them.`,
    };
  }

  // Anything that is not itself a starting balance counts as history.
  const recorded = transactions.filter((t) => t.category !== OPENING_CATEGORY).length;
  if (recorded > SETUP_GRACE) {
    return {
      ok: false,
      reason:
        `The ledger already has ${recorded.toLocaleString()} entries, so there is no "before" left to describe. ` +
        `Money arriving in ${account} now is a Transfer if it came from another account, or Revenue if it came from outside, ` +
        "dated the day it actually arrived.",
    };
  }

  return { ok: true };
}

/**
 * Starting balances that claim to predate entries recorded before them.
 *
 * These cannot be created any more, but rows written under the old rule exist
 * and are quietly wrong: they date money back to the beginning of the ledger
 * when it actually arrived partway through, so every balance and every report
 * before that day is overstated.
 *
 * Reported, never corrected. The right answer depends on where the money came
 * from, which only the owner knows: a Transfer from another account, or
 * Revenue from outside. Guessing would replace one wrong row with another.
 */
export function suspectOpenings(
  transactions: readonly Transaction[],
): Transaction[] {
  return transactions.filter((t) => {
    if (t.category !== OPENING_CATEGORY) return false;

    // Something that is not a starting balance, recorded before this claims
    // to have existed, means the account was already being tracked.
    return transactions.some(
      (other) =>
        other.category !== OPENING_CATEGORY &&
        other.recordNumber < t.recordNumber &&
        other.date <= t.date,
    );
  });
}
/**
 * Rows still using the Excel's revenue workaround.
 *
 * Reported, never rewritten on their own. `domain/year.ts` handles the ones
 * that are genuine carry-forwards; anything else under this name is real money
 * from somewhere and needs a person to look at it.
 */
export function legacyCarryForwardRows(
  transactions: readonly Transaction[],
): Transaction[] {
  return transactions.filter(
    (t) => t.item === OBSOLETE_REVENUE_CATEGORY && t.category !== OPENING_CATEGORY,
  );
}

/**
 * Starting balances that were filed before the ledger begins.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The first version of the starting balance dated its row the day before the
 * ledger's earliest entry, which sounded more correct than sharing that day
 * and was wrong in every way that shows. On a ledger starting 1 January it
 * lands on 31 December of the year before: outside the year every report
 * filters by, so the money counts towards no annual figure, and last in a list
 * sorted newest first, where the owner could not find it and reasonably
 * concluded it had not saved.
 *
 * The balance was always right. Only the date was wrong, and only on rows this
 * app wrote itself, so this is a repair of its own mistake rather than a
 * judgement about the owner's data. It moves nothing else and changes no
 * amount.
 *
 * ── Why it corrects rather than reports ───────────────────────────────────
 *
 * Integrity checks in this app report and never auto-correct, because they are
 * looking at entries a person made and cannot know what was meant. This is the
 * other case: the row was generated, the intended date is known exactly, and
 * there is nothing for a person to decide. `year.ts` corrects on the same
 * grounds.
 */
/**
 * The day the ledger begins, for the purpose of placing a starting balance.
 *
 * `except` is the row being judged or placed, so a starting balance is never
 * compared against itself. Without that the two callers disagreed: one asked
 * where the ledger starts including opening rows and got 1 January, the other
 * asked excluding them and got the 4th, so a balance written on the 1st was
 * immediately "repaired" onto the 4th. One definition, one answer.
 */
export function ledgerStart(
  transactions: readonly Transaction[],
  except?: string,
): string | null {
  return transactions
    .filter((t) => t.id !== except)
    .reduce<string | null>(
      (soonest, t) => (soonest === null || t.date < soonest ? t.date : soonest),
      null,
    );
}

/**
 * Starting balances filed before the ledger begins.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The first version of the starting balance dated its row the day before the
 * ledger's earliest entry, which sounded more correct than sharing that day
 * and was wrong in every way that shows. On a ledger starting 1 January it
 * lands on 31 December of the year before: outside the year every report
 * filters by, so the money counts towards no annual figure, and last in a list
 * sorted newest first, where the owner could not find it and reasonably
 * concluded it had never saved.
 *
 * The balance was always right. Only the date was wrong, and only on rows this
 * app generated itself, so this repairs its own mistake rather than judging
 * anything the owner entered. It moves nothing else and changes no amount.
 *
 * ── Why it corrects rather than reports ───────────────────────────────────
 *
 * Integrity checks here report and never auto-correct, because they look at
 * entries a person made and cannot know what was meant. This is the other
 * case: the row was generated, the intended date is known exactly, and there
 * is nothing for a person to decide. `year.ts` corrects on the same grounds.
 */
export function misdatedOpenings(
  transactions: readonly Transaction[],
): Transaction[] {
  const out: Transaction[] = [];

  for (const t of transactions) {
    if (t.category !== OPENING_CATEGORY) continue;

    // Everything except this row. A starting balance that is itself the
    // oldest entry is not misplaced: it is where the record begins.
    const begins = ledgerStart(transactions, t.id);
    if (begins === null) continue;

    /**
     * Only a different year counts as misplaced.
     *
     * Sitting a few days before the first transaction is exactly what a
     * starting balance is for, so earlier is not by itself wrong. What was
     * wrong is landing in the year before: every report filters by year, so
     * the money then counts towards nothing, and it sorts to the very bottom
     * of a list ordered newest first. That is the harm, and it is the only
     * thing worth moving a saved row for.
     */
    if (t.date.slice(0, 4) >= begins.slice(0, 4)) continue;

    out.push({ ...t, date: begins });
  }

  return out;
}
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
