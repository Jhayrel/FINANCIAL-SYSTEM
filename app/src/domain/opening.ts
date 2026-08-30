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

  return { ok: true };
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

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
