/**
 * Domain types.
 *
 * Mirrors the Excel ledger (DATABASE columns B:N) as documented in
 * docs/SYSTEM-ANALYSIS.md section 2. Field semantics are load-bearing,
 * read that document before changing anything here.
 */

import type { Centavos } from "./money";

/** Re-exported so consumers have a single domain import surface. */
export type { Centavos } from "./money";

/**
 * Ledger transaction type (DATABASE column D).
 *
 * `Transfer` moves money between the owner's own wallets and is NOT spending,
 * except for its transaction fee and for "Money Send" items, see
 * SYSTEM-ANALYSIS section 3.3.
 */
export type TransactionType =
  | "Revenue" /** money in from outside: actual income */
  | "Spending" /** money out to outside */
  | "Transfer" /** between your own wallets: net zero */
  | "Debt"; /** creates or settles a liability or asset */

/**
 * What a Debt transaction does to its debt.
 *
 * The four statements the whole module rests on (spec 5.6.1):
 *   draw     wallet UP,   liability UP.    NOT revenue.
 *   repay    wallet DOWN, liability DOWN.  NOT spending.
 *   interest wallet DOWN, liability flat.  IS spending.
 *   writeoff no wallet,   liability DOWN.
 *
 * Mirror image for money you lend out: lend / collect.
 */
export type DebtEffect =
  | "draw"
  | "repay"
  | "interest"
  | "fee"
  | "writeoff"
  | "lend"
  | "collect";

/**
 * Ledger category (DATABASE column G).
 *
 * Blank on 64 of 440 historical rows. Those rows still move wallet balances
 * but drop out of every category-filtered total, preserved, not repaired.
 */
export type TransactionCategory =
  | "Revenue"
  | "Spending"
  | "Bills"
  | "Subscriptions"
  | "Transfer"
  /**
   * Where the money started, not income. Carries a prior year's closing
   * balance into the next. See `domain/year.ts` for why this is a category
   * rather than a kind of revenue.
   */
  | "Opening"
  | "";

/** Ledger status (DATABASE column N). Free text in the source; these are the observed values. */
export type TransactionStatus =
  | "Done"
  | "Paid"
  | "Transferred"
  | "Withdrawn"
  | "Received"
  | "";

/** An ISO calendar date, `YYYY-MM-DD`. Never a Date object, no timezone traps. */
export type IsoDate = string;

/**
 * A single ledger entry.
 *
 * `id` is a stable surrogate key. `recordNumber` is the Excel's sequential
 * display number, which is reassigned on every write and must never be used
 * as a reference.
 */
export interface Transaction {
  readonly id: string;
  readonly recordNumber: number;
  readonly date: IsoDate;
  readonly type: TransactionType;
  /** Source wallet. Empty on most Revenue rows. */
  readonly fromWallet: string;
  /** Destination wallet. Empty on most Spending rows. */
  readonly toWallet: string;
  readonly category: TransactionCategory;
  /** The real classifier: drives every ranking and most totals. */
  readonly item: string;
  readonly description: string;
  readonly amount: Centavos;
  /** Transaction fee, borne entirely by `fromWallet`. */
  readonly fee: Centavos;
  /** Invariant: always `amount + fee`. */
  readonly total: Centavos;
  readonly notes: string;
  readonly status: TransactionStatus;

  /** Links a Debt row to its debt. Required when type is "Debt" (rule D1). */
  readonly debtId?: string | undefined;
  /** What this row does to that debt. Required when type is "Debt". */
  readonly debtEffect?: DebtEffect | undefined;
  /** Cleared through the integrity review queue. */
  readonly reviewed?: boolean | undefined;
  /**
   * Who filled this row in.
   *
   * Absent on every row written before the assistant existed, and on every
   * row imported from the Excel, so absent reads as "typed". `firestore.rules`
   * validates it when present, and the activity trail holds the fuller story;
   * this is here so the Database screen can mark a row without a lookup.
   */
  readonly entrySource?: "manual" | "ai" | undefined;
}

/** A transaction in the recycle bin. Soft delete, never hard-delete money records. */
export interface DeletedTransaction extends Transaction {
  readonly deletedAt: string;
}

/** A draft being edited in the entry form, before it becomes a Transaction. */
export interface TransactionDraft {
  id?: string;
  recordNumber?: number;
  date: IsoDate;
  type: TransactionType | "";
  fromWallet: string;
  toWallet: string;
  category: TransactionCategory;
  item: string;
  description: string;
  amount: Centavos | null;
  fee: Centavos;
  notes: string;
  status: TransactionStatus;
}

// ── Reference data (CATEGORIES sheet) ──────────────────────────────────────

export interface SpendingType {
  readonly name: string;
  readonly remark: string;
}

/**
 * User-maintained lists.
 *
 * `wallets` and `savings` are the *currently active* lists. Historical
 * transactions reference wallets no longer listed (e.g. "Hidden cash
 * (fieldtrip)"), so never validate old data against these, see
 * SYSTEM-ANALYSIS section 2.
 */
export interface ReferenceLists {
  readonly wallets: readonly string[];
  readonly savings: readonly string[];
  readonly bills: readonly string[];
  readonly subscriptions: readonly string[];
  readonly revenueCategories: readonly string[];
  readonly spendingTypes: readonly SpendingType[];
  /**
   * The credit lines, by name. Optional, because most callers have no
   * opinion about debt and every existing fixture predates this field.
   *
   * ── Why the reader has to know these exist ────────────────────────────
   *
   * "the credit is from maya credit" produced a Transfer from Maya to Maya:
   * same wallet on both sides, PHP 5,000, and the error "A transfer needs two
   * different wallets". Maya Credit is a credit line, not an account, and
   * nothing in this list said so, so the reader found the wallet "Maya"
   * inside the words "maya credit" and used it twice.
   *
   * A credit line is where borrowed money comes from. It is never a wallet
   * and a sentence naming one is about debt.
   */
  readonly credits?: readonly string[];
}

// ── Budgets (BUDGETING sheet) ──────────────────────────────────────────────

/** Twelve monthly amounts, index 0 = January. */
export type MonthlyAmounts = readonly [
  Centavos, Centavos, Centavos, Centavos, Centavos, Centavos,
  Centavos, Centavos, Centavos, Centavos, Centavos, Centavos,
];

/** The two independent budget tracks the Excel maintains. */
export interface BudgetYear {
  readonly spending: MonthlyAmounts;
  readonly billsSubs: MonthlyAmounts;
}

export type Budgets = Readonly<Record<string, BudgetYear>>;

// ── Derived shapes ─────────────────────────────────────────────────────────

export interface WalletBalance {
  readonly name: string;
  readonly balance: Centavos;
  readonly isSavings: boolean;
}

/** A month's spend, split the way INSIGHTS splits it. */
export interface MonthTotals {
  readonly spending: Centavos;
  readonly bills: Centavos;
  readonly subscriptions: Centavos;
  readonly fees: Centavos;
  /** Debt interest and fees. Repaid principal is NOT spending. */
  readonly interest: Centavos;
  /** spending + bills + subscriptions + fees + interest */
  readonly total: Centavos;
  readonly revenue: Centavos;
}

export type BudgetStatus = "WITHIN THE BUDGET" | "OVER THE BUDGET" | "NO BUDGET SET";

export interface BudgetTrack {
  readonly budget: Centavos;
  readonly spent: Centavos;
  /** budget - spent. Negative means over. */
  readonly remaining: Centavos;
  readonly status: BudgetStatus;
}

/** The two-track budget assessment for a month. */
export interface BudgetAssessment {
  readonly spending: BudgetTrack;
  readonly billsSubs: BudgetTrack;
  readonly combined: BudgetTrack;
}

export interface RankedAmount {
  readonly name: string;
  readonly amount: Centavos;
}

/** An inclusive date window. */
export interface DateRange {
  readonly start: IsoDate;
  readonly end: IsoDate;
}
