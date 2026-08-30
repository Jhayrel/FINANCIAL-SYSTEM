/**
 * Years.
 *
 * ── What happens when the year ends ───────────────────────────────────────
 *
 * Nothing. That is the design, and it is deliberate.
 *
 * The ledger is continuous. A balance is the running sum of every transaction
 * ever recorded, so 1 January opens with exactly what 31 December closed with,
 * without anyone doing anything. A year is a filter over the ledger, not a
 * container the ledger is divided into. There is no year-end ritual to
 * remember, nothing to run in the wrong order, and no way for a balance to
 * drift away from the transactions that produced it.
 *
 * The Excel did the opposite. Each January it wrote one "Transfer of balance"
 * row per account to carry the prior year forward, and booked each of them as
 * Revenue. Records #1 to #5 are the 2025 carry-forward: PHP 953.89 of opening
 * position counted as 2026 income. It is the same defect as booking a debt
 * draw as revenue, and it has the same consequence: the income line describes
 * something that never happened.
 *
 * ── So why does this module exist ─────────────────────────────────────────
 *
 * Three jobs that a continuous ledger still needs:
 *
 *   1. Reclassify the carry-forward rows the Excel already wrote, so they stop
 *      inflating income. Balances must not move by a single centavo, which is
 *      the invariant `year.test.ts` asserts across all 440 rows.
 *
 *   2. Report an opening and closing balance per year, derived on demand. A
 *      statement wants those lines; the database does not need to store them.
 *
 *   3. Close a year for real, but only when archiving. If the ledger is ever
 *      trimmed to keep the working set small, the balance carried by the rows
 *      being removed has to be written down as an opening row, or it is gone.
 *      That is the one case where a stored opening balance is correct, and it
 *      is an explicit operation, never automatic.
 *
 * ── Detecting the Excel's carry-forward rows ──────────────────────────────
 *
 * Not by item name. Record #371 is `item = "Transfer of balance"` too, dated
 * 30 June, described "From pnb 2000 to 1700": PHP 1,522.00 of real money
 * arriving from a bank outside the wallet list. Matching on the name alone
 * would reclassify PHP 1,522.00 of genuine income as an opening balance.
 *
 * A carry-forward is: dated 1 January, no source wallet, and describing the
 * previous year. All three, or it is not one.
 */

import { getYear } from "./dates";
import { walletBalance } from "./balances";
import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

/** The category that means "this is where the money started", not income. */
export const OPENING = "Opening";

// ── Opening and closing positions ──────────────────────────────────────────

export interface YearPosition {
  readonly account: string;
  readonly opening: Centavos;
  readonly closing: Centavos;
  readonly movement: Centavos;
}

/** Everything dated on or before the last day of `year`. */
const upTo = (transactions: readonly Transaction[], year: number): Transaction[] =>
  transactions.filter((t) => getYear(t.date) <= year);

/**
 * Opening and closing balance per account for one year.
 *
 * Derived from the ledger every time. Nothing here is stored, so these can
 * never disagree with the transactions they come from.
 */
export function yearPositions(
  transactions: readonly Transaction[],
  year: number,
  accounts: readonly string[],
): YearPosition[] {
  const before = upTo(transactions, year - 1);
  const through = upTo(transactions, year);

  return accounts.map((account) => {
    const opening = walletBalance(before, account);
    const closing = walletBalance(through, account);
    return { account, opening, closing, movement: closing - opening };
  });
}

/** Which years the ledger actually covers, oldest first. */
export function yearsCovered(transactions: readonly Transaction[]): number[] {
  const years = new Set<number>();
  for (const t of transactions) years.add(getYear(t.date));
  return [...years].sort((a, b) => a - b);
}

// ── The Excel's carry-forward rows ─────────────────────────────────────────

export interface CarryForward {
  readonly transaction: Transaction;
  /** The year the balance came from. */
  readonly fromYear: number;
}

const isJanuaryFirst = (date: IsoDate): boolean => date.slice(5) === "01-01";

/**
 * Find opening-balance rows the Excel wrote.
 *
 * All three conditions are required. Dropping any one of them starts matching
 * real income: see the note about record #371 at the top of this file.
 */
export function findCarryForward(transactions: readonly Transaction[]): CarryForward[] {
  const out: CarryForward[] = [];

  for (const t of transactions) {
    if (!isJanuaryFirst(t.date)) continue;
    if (t.fromWallet.trim() !== "") continue;
    if (t.toWallet.trim() === "") continue;

    const year = getYear(t.date);
    // "Transfer of balance 2025" on a row dated 2026-01-01.
    const mentionsPriorYear = t.description.includes(String(year - 1));
    if (!mentionsPriorYear) continue;

    out.push({ transaction: t, fromYear: year - 1 });
  }

  return out;
}

export interface OpeningPlan {
  readonly rows: readonly CarryForward[];
  /** Income the ledger currently reports that was never income. */
  readonly overstatedIncome: Centavos;
}

/**
 * Plan the reclassification.
 *
 * Reports what it would do and what it is worth, so the change is visible
 * before it is applied rather than after.
 */
export function planOpeningMigration(transactions: readonly Transaction[]): OpeningPlan {
  const rows = findCarryForward(transactions);
  const overstatedIncome = rows
    .filter((r) => r.transaction.type === "Revenue")
    .reduce((a, r) => a + r.transaction.total, 0);

  return { rows, overstatedIncome };
}

/**
 * Apply it.
 *
 * Only `category` changes. `type` stays "Revenue" and both wallet fields stay
 * exactly as they were, which is why no balance can move: rule 3.1 credits a
 * destination wallet by `amount` regardless of type, and these rows have no
 * source wallet for the other two clauses to touch.
 */
export function applyOpeningMigration(
  transactions: readonly Transaction[],
  plan: OpeningPlan,
): Transaction[] {
  const ids = new Set(plan.rows.map((r) => r.transaction.id));
  return transactions.map((t) =>
    ids.has(t.id) ? { ...t, category: OPENING as Transaction["category"] } : t,
  );
}

/** True once every carry-forward row is classified. Running twice is a no-op. */
export function openingMigrationDone(transactions: readonly Transaction[]): boolean {
  return findCarryForward(transactions).every((r) => r.transaction.category === OPENING);
}

// ── Closing a year, for archiving only ─────────────────────────────────────

export interface YearCloseRow {
  readonly account: string;
  readonly balance: Centavos;
}

export interface YearClosePlan {
  readonly year: number;
  readonly opensOn: IsoDate;
  readonly rows: readonly YearCloseRow[];
  /** Rows that would be archived away. */
  readonly archives: number;
  readonly total: Centavos;
}

/**
 * Plan a real year-end close.
 *
 * Only needed when old years are being moved out of the working ledger. In
 * normal use this is never called: the balance carries itself.
 *
 * Accounts that close at zero are left out. Writing a zero opening row for an
 * account nobody used adds a row that says nothing.
 */
export function planYearClose(
  transactions: readonly Transaction[],
  year: number,
  accounts: readonly string[],
): YearClosePlan {
  const through = upTo(transactions, year);

  const rows = accounts
    .map((account) => ({ account, balance: walletBalance(through, account) }))
    .filter((r) => r.balance !== 0);

  return {
    year,
    opensOn: `${year + 1}-01-01`,
    rows,
    archives: through.length,
    total: rows.reduce((a, r) => a + r.balance, 0),
  };
}

/**
 * Turn a close plan into the opening rows for the next year.
 *
 * `nextRecordNumber` is the first free number: the archived rows are leaving,
 * but their numbers should not be reused while they still exist anywhere.
 */
export function openingRowsFor(
  plan: YearClosePlan,
  nextRecordNumber: number,
): Transaction[] {
  return plan.rows.map((r, i) => ({
    id: `open-${plan.year + 1}-${slug(r.account)}`,
    recordNumber: nextRecordNumber + i,
    date: plan.opensOn,
    type: "Revenue" as const,
    fromWallet: "",
    toWallet: r.account,
    category: OPENING as Transaction["category"],
    item: "Opening balance",
    description: `Balance carried from ${plan.year}`,
    amount: r.balance,
    fee: 0,
    total: r.balance,
    notes: "",
    status: "Done" as const,
  }));
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
