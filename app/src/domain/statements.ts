/**
 * Statements: spec rule 5.10, ported from VBA Module5.
 *
 * Views over the same ledger. Four are the Excel's; the rest are new. The
 * Debt statement came first and is the most useful of them: a running
 * outstanding column is the only way to see how a balance actually moved.
 *
 * ── The ones added on 26 September 2026 ────────────────────────────────────
 *
 * The owner asked for "more option in the statement like credit or loan, all
 * borrowed". So a statement can now be one wallet, the bills and
 * subscriptions, the transfers, everything borrowed, only the credit lines,
 * everything lent, or what was handled on someone's behalf. Each is a filter
 * here and a running column in `statementSheet.ts`.
 *
 * ── Income and spending mean what they mean everywhere else ──────────────
 *
 * The revenue and expense sheets used their own filters, and both disagreed
 * with the rest of the app. The revenue sheet listed opening balances as
 * income (rule Y1 says they are not). The expense sheet listed a transfer
 * between two of the owner's own wallets at its whole amount when only its
 * fee is a cost, so a PHP 15.00 fee on a PHP 9,000.00 withdrawal was PHP
 * 9,015.00 of "expense". They now use `incomeOf` and `costOf`, the one
 * definition each, so a sheet's total is the total every other screen shows.
 */

import type { Centavos } from "./money";
import { firstOfMonth, lastOfMonth } from "./dates";
import { owedChange, type Debt } from "./debt";
import { costOf, incomeOf } from "./totals";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export type StatementType =
  | "account"
  | "wallet"
  | "revenue"
  | "expense"
  | "bills"
  | "transfers"
  | "savings"
  | "debt"
  | "borrowed"
  | "credit"
  | "lent"
  | "onbehalf";

/** In the order a picker offers them: money first, then what is owed. */
export const STATEMENT_TYPES: readonly StatementType[] = [
  "account",
  "wallet",
  "revenue",
  "expense",
  "bills",
  "transfers",
  "savings",
  "debt",
  "borrowed",
  "credit",
  "lent",
  "onbehalf",
];

export const STATEMENT_LABEL: Record<StatementType, string> = {
  account: "Account statement",
  wallet: "Wallet statement",
  revenue: "Revenue sheet",
  expense: "Expense sheet",
  bills: "Bills and subscriptions",
  transfers: "Transfers",
  savings: "Savings sheet",
  debt: "Debt statement",
  borrowed: "Everything borrowed",
  credit: "Credit cards and lines",
  lent: "Everything lent",
  onbehalf: "On behalf",
};

export const STATEMENT_HINT: Record<StatementType, string> = {
  account: "Everything in the period, with what you held after each row",
  wallet: "One wallet, with its balance after each row",
  revenue: "Income only: not opening balances, not borrowing",
  expense: "What counts as spending, including transfer fees and debt interest",
  bills: "Every bill and subscription paid",
  transfers: "Money moved between wallets or sent out, with what each cost",
  savings: "Anything touching a savings account, with what savings held",
  debt: "One debt, with what is owed after each row",
  borrowed: "Every loan and credit line you owe, with the total owed",
  credit: "Credit cards and credit lines only, with the total owed",
  lent: "Money you lent, with what is still owed to you",
  onbehalf: "Money paid or held for someone else",
};

/** A statement that follows one wallet or one debt needs it named. */
export const needsWallet = (type: StatementType): boolean => type === "wallet";
export const needsDebt = (type: StatementType): boolean => type === "debt";

/** Which debts a debt statement covers. Absent `form` is a credit line: rows written before forms existed. */
export function debtInScope(debt: Debt, type: StatementType): boolean {
  const form = debt.form ?? "credit-line";
  switch (type) {
    case "borrowed":
      return debt.kind === "payable" && form !== "pass-through";
    case "credit":
      return debt.kind === "payable" && form === "credit-line";
    case "lent":
      return debt.kind === "receivable" && form !== "pass-through";
    case "onbehalf":
      return form === "pass-through";
    default:
      return false;
  }
}

export interface StatementScope {
  /** Wallet statements: the wallet. */
  readonly wallet?: string | undefined;
  /** The debts the settings hold, for the statements that cover several. */
  readonly debts?: readonly Debt[] | undefined;
}

/**
 * Whether a row belongs in a statement.
 *
 * The expense filter is the interesting one: it is what `costOf` counts, so
 * transfer fees and debt interest are in and repaid principal, which is
 * balance-sheet movement rather than cost, is not.
 */
export function belongsIn(
  t: Transaction,
  type: StatementType,
  savingsWallets: ReadonlySet<string>,
  scope: StatementScope = {},
): boolean {
  switch (type) {
    case "account":
      return true;

    case "wallet":
      return !!scope.wallet && (t.fromWallet === scope.wallet || t.toWallet === scope.wallet);

    case "revenue":
      // Retained on someone's behalf is income, and is on this statement.
      return incomeOf(t) > 0;

    case "expense":
      // Written off on someone's behalf is spending, and is on this statement.
      return costOf(t) > 0;

    case "bills":
      return t.type === "Spending" && (t.category === "Bills" || t.category === "Subscriptions");

    case "transfers":
      return t.type === "Transfer" && t.category !== "Opening";

    case "savings":
      return savingsWallets.has(t.fromWallet) || savingsWallets.has(t.toWallet);

    case "debt":
      return t.debtId !== undefined;

    case "borrowed":
    case "credit":
    case "lent":
    case "onbehalf": {
      if (t.debtId === undefined) return false;
      const debt = scope.debts?.find((d) => d.id === t.debtId);
      return !!debt && debtInScope(debt, type);
    }
  }
}

export interface StatementRow {
  readonly transaction: Transaction;
  /** Running outstanding, on the debt statement only. */
  readonly runningBalance?: Centavos | undefined;
}

export interface Statement {
  readonly type: StatementType;
  readonly rows: readonly StatementRow[];
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly totalIn: Centavos;
  readonly totalOut: Centavos;
  readonly net: Centavos;
}

/**
 * Build a statement for a month range.
 *
 * `fromMonth` and `toMonth` are 1-12 and inclusive, matching the Excel's
 * two dropdowns rather than a free date picker.
 */
export function buildStatement(
  transactions: readonly Transaction[],
  type: StatementType,
  year: number,
  fromMonth: number,
  toMonth: number,
  reference: ReferenceLists,
  debtId?: string,
  scope: StatementScope = {},
): Statement {
  const lo = Math.min(fromMonth, toMonth);
  const hi = Math.max(fromMonth, toMonth);
  /*
   * The last day of the last month, not the first of it. A statement for
   * January said "1 January to 1 January" while holding the whole month,
   * and one for January to August said it ended on 1 August with three
   * more weeks of rows under it.
   */
  return buildStatementBetween(transactions, type, firstOfMonth(year, lo), lastOfMonth(year, hi), reference, debtId, scope);
}

/**
 * A month in a year, for a statement that runs across years.
 *
 * The owner, 26 September 2026: "allow year too like what if january 2025 to
 * december 2026 or june 2024 to may 2026". A statement was one year's months;
 * it is now any first month to any last month. Given the wrong way round, the
 * two ends are swapped rather than giving an empty statement.
 */
export interface MonthOfYear {
  readonly year: number;
  readonly month: number;
}

export function rangeOf(from: MonthOfYear, to: MonthOfYear): { from: IsoDate; to: IsoDate } {
  const key = (m: MonthOfYear): number => m.year * 12 + m.month;
  const [a, b] = key(from) <= key(to) ? [from, to] : [to, from];
  return { from: firstOfMonth(a.year, a.month), to: lastOfMonth(b.year, b.month) };
}

export function buildStatementBetween(
  transactions: readonly Transaction[],
  type: StatementType,
  from: IsoDate,
  to: IsoDate,
  reference: ReferenceLists,
  debtId?: string,
  scope: StatementScope = {},
): Statement {
  const savings = new Set(reference.savings);

  const inPeriod = transactions
    .filter((t) => {
      if (t.date < from || t.date > to) return false;
      if (type === "debt" && debtId && t.debtId !== debtId) return false;
      return belongsIn(t, type, savings, scope);
    })
    .sort((a, b) =>
      a.date === b.date ? a.recordNumber - b.recordNumber : a.date.localeCompare(b.date),
    );

  /**
   * The debt statement's running column starts from the balance carried into
   * the period, not from zero: otherwise a mid-year statement would look
   * like the debt began there.
   */
  let running = 0;
  if (type === "debt" && debtId) {
    for (const t of transactions) {
      if (t.debtId !== debtId || t.date >= from) continue;
      running += owedChange(t);
    }
  }

  const rows: StatementRow[] = inPeriod.map((t) => {
    if (type !== "debt") return { transaction: t };

    running += owedChange(t);
    return { transaction: t, runningBalance: running };
  });

  let totalIn = 0;
  let totalOut = 0;
  for (const { transaction: t } of rows) {
    if (t.type === "Revenue" || t.debtEffect === "draw" || t.debtEffect === "collect") {
      totalIn += t.total;
    } else {
      totalOut += t.total;
    }
  }

  return { type, rows, from, to, totalIn, totalOut, net: totalIn - totalOut };
}

// ── Export ─────────────────────────────────────────────────────────────────

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const pesos = (c: Centavos): string => (c / 100).toFixed(2);

/**
 * CSV of a statement.
 *
 * Money is written as a plain decimal with no symbol or separators, so it
 * re-imports into a spreadsheet as a number rather than as text.
 */
export function statementToCsv(statement: Statement): string {
  const header = [
    "Record",
    "Date",
    "Type",
    "From wallet",
    "To wallet",
    "Category",
    "Item",
    "Description",
    "Amount",
    "Fee",
    "Total",
    "Notes",
    "Status",
    ...(statement.type === "debt" ? ["Outstanding"] : []),
  ];

  const lines = [header.map(csvCell).join(",")];

  for (const { transaction: t, runningBalance } of statement.rows) {
    lines.push(
      [
        String(t.recordNumber).padStart(4, "0"),
        t.date,
        t.debtEffect ? `Debt / ${t.debtEffect}` : t.type,
        t.fromWallet,
        t.toWallet,
        t.category,
        t.item,
        t.description,
        pesos(t.amount),
        pesos(t.fee),
        pesos(t.total),
        t.notes,
        t.status,
        ...(statement.type === "debt" ? [pesos(runningBalance ?? 0)] : []),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return lines.join("\n");
}

/** Filename for a downloaded statement. */
export function statementFilename(statement: Statement, extension: "csv" | "pdf" = "csv", subject = ""): string {
  const name = [STATEMENT_LABEL[statement.type], subject]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${name}-${statement.from.slice(0, 7)}-to-${statement.to.slice(0, 7)}.${extension}`;
}
