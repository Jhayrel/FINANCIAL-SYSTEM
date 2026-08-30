/**
 * Statements: spec rule 5.10, ported from VBA Module5.
 *
 * Five views over the same ledger. Four are the Excel's; the Debt statement
 * is new, and is the most useful of them: a running outstanding column is
 * the only way to see how a balance actually moved.
 */

import type { Centavos } from "./money";
import { getMonth, getYear } from "./dates";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export type StatementType =
  | "account"
  | "revenue"
  | "expense"
  | "savings"
  | "debt";

export const STATEMENT_LABEL: Record<StatementType, string> = {
  account: "Account statement",
  revenue: "Revenue sheet",
  expense: "Expense sheet",
  savings: "Savings sheet",
  debt: "Debt statement",
};

export const STATEMENT_HINT: Record<StatementType, string> = {
  account: "Everything in the period",
  revenue: "Money in from outside",
  expense: "Money out, including transfer fees and debt interest",
  savings: "Anything touching a savings account",
  debt: "Every debt row, with a running balance",
};

const FEE_ITEM = "transaction fee";

/**
 * Whether a row belongs in a statement.
 *
 * The expense filter is the interesting one: it includes Spending rows, the
 * transfer fees that are genuinely expense, and debt interest, but never
 * repaid principal, which is balance-sheet movement rather than cost.
 */
export function belongsIn(
  t: Transaction,
  type: StatementType,
  savingsWallets: ReadonlySet<string>,
): boolean {
  switch (type) {
    case "account":
      return true;

    case "revenue":
      return t.type === "Revenue";

    case "expense":
      if (t.type === "Spending") return true;
      if (
        t.type === "Transfer" &&
        t.category === "Spending" &&
        t.item.trim().toLowerCase() === FEE_ITEM
      ) {
        return true;
      }
      return t.type === "Debt" && (t.debtEffect === "interest" || t.debtEffect === "fee");

    case "savings":
      return savingsWallets.has(t.fromWallet) || savingsWallets.has(t.toWallet);

    case "debt":
      return t.debtId !== undefined;
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
): Statement {
  const savings = new Set(reference.savings);
  const lo = Math.min(fromMonth, toMonth);
  const hi = Math.max(fromMonth, toMonth);

  const inPeriod = transactions
    .filter((t) => {
      if (getYear(t.date) !== year) return false;
      const m = getMonth(t.date);
      if (m < lo || m > hi) return false;
      if (type === "debt" && debtId && t.debtId !== debtId) return false;
      return belongsIn(t, type, savings);
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
    const start = `${year}-${String(lo).padStart(2, "0")}-01`;
    for (const t of transactions) {
      if (t.debtId !== debtId || t.date >= start) continue;
      if (t.debtEffect === "draw" || t.debtEffect === "lend") running += t.amount;
      else if (t.debtEffect === "repay" || t.debtEffect === "collect" || t.debtEffect === "writeoff") {
        running -= t.amount;
      }
    }
  }

  const rows: StatementRow[] = inPeriod.map((t) => {
    if (type !== "debt") return { transaction: t };

    if (t.debtEffect === "draw" || t.debtEffect === "lend") running += t.amount;
    else if (t.debtEffect === "repay" || t.debtEffect === "collect" || t.debtEffect === "writeoff") {
      running -= t.amount;
    }
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

  return {
    type,
    rows,
    from: `${year}-${String(lo).padStart(2, "0")}-01`,
    to: `${year}-${String(hi).padStart(2, "0")}-01`,
    totalIn,
    totalOut,
    net: totalIn - totalOut,
  };
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
export function statementFilename(statement: Statement): string {
  return `${STATEMENT_LABEL[statement.type].toLowerCase().replace(/\s+/g, "-")}-${statement.from.slice(0, 7)}-to-${statement.to.slice(0, 7)}.csv`;
}
