/**
 * Debt: SYSTEM-ANALYSIS / spec rule 5.6.
 *
 * The concept the Excel never had. It booked ₱5,450.00 of borrowing as
 * Revenue and ₱2,688.79 of repayment as a Bill, so reported income was
 * overstated and net worth ignored the liability entirely.
 *
 * Four statements the module rests on (spec 5.6.1):
 *
 *   Event      Wallet   Liability   Income?   Spending?
 *   draw         ▲          ▲         NO         no
 *   repay        ▼          ▼         no         NO
 *   interest     ▼          flat      no        YES
 *   writeoff     –          ▼        yes¹        no
 *
 * ¹ booked as Debt/writeoff, never Revenue, so it cannot contaminate the
 *   income trend.
 *
 * Mirror image for money lent out: lend (wallet ▼, asset ▲) and
 * collect (wallet ▲, asset ▼). Neither is spending or income.
 */

import { addMonths, daysBetween, today } from "./dates";
import { formatMoney as fmt, type Centavos } from "./money";
import type { DebtEffect, IsoDate, Transaction } from "./types";
import type { CounterpartyKind, DebtForm } from "./debtForms";

/** Re-exported so debt consumers import from one place. */
export type { DebtEffect } from "./types";

// ── Entity ─────────────────────────────────────────────────────────────────

export type DebtKind = "payable" | "receivable";
export type DebtStatus = "open" | "settled" | "written_off";
export type InterestType = "none" | "flat" | "monthly_pct";

export interface Debt {
  readonly id: string;
  readonly name: string;
  readonly kind: DebtKind;
  readonly counterparty: string;
  readonly openedDate: IsoDate;
  readonly dueDate?: IsoDate | undefined;
  /** Wallet the money moves through. */
  readonly wallet: string;
  readonly interestType: InterestType;
  /** Basis points. 3.5%/month → 350. */
  readonly interestRate: number;
  /**
   * A credit line's limit, or a term loan's original principal. One field
   * because both answer "how big is this arrangement".
   */
  readonly creditLimit?: Centavos | undefined;
  /**
   * What kind of arrangement it is. See `domain/debtForms.ts`. Absent on rows
   * written before the distinction existed, which are all credit lines.
   */
  readonly form?: DebtForm | undefined;
  /** Whether the other side is an institution or a person. */
  readonly counterpartyType?: CounterpartyKind | undefined;
  /** Term loans only: how many monthly payments the schedule has. */
  readonly termMonths?: number | undefined;
  readonly notes: string;
  readonly archived: boolean;
}

/** Everything about a debt's current state. Derived, never stored. */
export interface DebtPosition {
  readonly debt: Debt;
  readonly drawn: Centavos;
  readonly repaid: Centavos;
  readonly interestPaid: Centavos;
  readonly writtenOff: Centavos;
  /** drawn − repaid − writtenOff. Interest is excluded, it is expense. */
  readonly outstanding: Centavos;
  readonly status: DebtStatus;
  readonly utilisation?: number | undefined;
  /** Negative when overdue. */
  readonly daysToDue?: number | undefined;
  readonly transactionCount: number;
  /** Repayment rows so far. A term loan's schedule counts instalments from this. */
  readonly repaymentCount: number;
}

/**
 * A stable id from the name.
 *
 * Transactions reference a debt by `debtId`, so this must be derived the same
 * way everywhere: a second scheme would orphan every row filed under the
 * first.
 */
export function makeDebtId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "debt";
}

// ── Classification ─────────────────────────────────────────────────────────

/** Effects that increase what is owed (or owed to you). */
const INCREASING: ReadonlySet<DebtEffect> = new Set(["draw", "lend"]);
/** Effects that decrease it. */
const DECREASING: ReadonlySet<DebtEffect> = new Set(["repay", "collect"]);
/** Effects that are genuine expense, not principal movement. */
const EXPENSE: ReadonlySet<DebtEffect> = new Set(["interest", "fee"]);

export const isDebtRow = (t: Transaction): boolean => t.type === "Debt";

/** Debt interest and fees ARE spending. Principal movement is not. */
export const isDebtExpense = (t: Transaction): boolean =>
  t.type === "Debt" && t.debtEffect !== undefined && EXPENSE.has(t.debtEffect);

/** Rows belonging to one debt. */
export function rowsFor(
  transactions: readonly Transaction[],
  debtId: string,
): Transaction[] {
  return transactions
    .filter((t) => t.debtId === debtId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Position, rule 5.6.2 ──────────────────────────────────────────────────

/**
 * Outstanding balance.
 *
 *   outstanding = Σ draw − Σ repay − Σ writeoff
 *
 * Interest is deliberately excluded. Paying ₱2,688.79 against a ₱2,500.00
 * draw reduces principal by ₱2,500.00 and books ₱188.79 as interest expense,
 * the liability falls by the principal only.
 */
export function outstandingOf(
  transactions: readonly Transaction[],
  debtId: string,
): Centavos {
  let total = 0;
  for (const t of transactions) {
    if (t.debtId !== debtId || t.debtEffect === undefined) continue;
    if (INCREASING.has(t.debtEffect)) total += t.amount;
    else if (DECREASING.has(t.debtEffect) || t.debtEffect === "writeoff") {
      total -= t.amount;
    }
  }
  return total;
}

export function positionOf(
  debt: Debt,
  transactions: readonly Transaction[],
  asOf: IsoDate = today(),
): DebtPosition {
  let drawn = 0;
  let repaid = 0;
  let interestPaid = 0;
  let writtenOff = 0;
  let count = 0;
  let repaymentCount = 0;

  for (const t of transactions) {
    if (t.debtId !== debt.id || t.debtEffect === undefined) continue;
    count++;

    if (INCREASING.has(t.debtEffect)) drawn += t.amount;
    else if (DECREASING.has(t.debtEffect)) {
      repaid += t.amount;
      repaymentCount++;
    }
    else if (t.debtEffect === "writeoff") writtenOff += t.amount;
    else if (EXPENSE.has(t.debtEffect)) interestPaid += t.amount;
  }

  const outstanding = drawn - repaid - writtenOff;

  // Rule D4: auto-closes at zero, reopens on a new draw.
  const status: DebtStatus =
    writtenOff > 0 && outstanding <= 0
      ? "written_off"
      : outstanding <= 0
        ? "settled"
        : "open";

  return {
    debt,
    drawn,
    repaid,
    interestPaid,
    writtenOff,
    outstanding,
    status,
    utilisation:
      debt.creditLimit && debt.creditLimit > 0
        ? outstanding / debt.creditLimit
        : undefined,
    daysToDue: debt.dueDate ? daysBetween(asOf, debt.dueDate) : undefined,
    transactionCount: count,
    repaymentCount,
  };
}

export function positionsOf(
  debts: readonly Debt[],
  transactions: readonly Transaction[],
  asOf: IsoDate = today(),
): DebtPosition[] {
  return debts
    .map((d) => positionOf(d, transactions, asOf))
    .sort((a, b) => b.outstanding - a.outstanding);
}

/** Total you owe. Rule D8: shown even at zero, so the concept stays visible. */
export function totalPayables(positions: readonly DebtPosition[]): Centavos {
  return positions
    .filter((p) => p.debt.kind === "payable")
    .reduce((a, p) => a + Math.max(0, p.outstanding), 0);
}

/** Total owed to you. */
export function totalReceivables(positions: readonly DebtPosition[]): Centavos {
  return positions
    .filter((p) => p.debt.kind === "receivable")
    .reduce((a, p) => a + Math.max(0, p.outstanding), 0);
}

// ── Net worth, rule 5.6.3 ─────────────────────────────────────────────────

export interface NetWorth {
  readonly wallets: Centavos;
  readonly savings: Centavos;
  readonly receivables: Centavos;
  readonly payables: Centavos;
  /** wallets + savings + receivables − payables */
  readonly total: Centavos;
}

/**
 * The figure the Excel never had.
 *
 * Its TOTAL FUNDS tile showed ₱7,670.03 while ₱2,762.06 of that was borrowed
 *, an overstatement of more than half.
 */
export function netWorth(
  walletTotal: Centavos,
  savingsTotal: Centavos,
  positions: readonly DebtPosition[],
): NetWorth {
  const receivables = totalReceivables(positions);
  const payables = totalPayables(positions);

  return {
    wallets: walletTotal,
    savings: savingsTotal,
    receivables,
    payables,
    total: walletTotal + savingsTotal + receivables - payables,
  };
}

// ── True income, rule 5.6.4 ───────────────────────────────────────────────

export interface IncomeQuality {
  /** Everything booked as Revenue. */
  readonly cashIn: Centavos;
  /** Cash in, less borrowing and self-moves. */
  readonly trueIncome: Centavos;
  readonly borrowed: Centavos;
  readonly openingBalance: Centavos;
  readonly selfMoves: Centavos;
}

/**
 * Split reported revenue into real income and everything masquerading as it.
 *
 * Shown as both figures on Insights: `Income` and `Cash in (incl. borrowing)`
 *, so the difference is visible rather than hidden.
 */
export function incomeQuality(
  transactions: readonly Transaction[],
  debts: readonly Debt[],
  range?: { start: IsoDate; end: IsoDate },
): IncomeQuality {
  const inRange = (t: Transaction): boolean =>
    !range || (t.date >= range.start && t.date <= range.end);

  /**
   * Whether each debt has been migrated.
   *
   * This matters because a Revenue row named after a debt means different
   * things before and after. Before, it is unconverted borrowing. After, the
   * borrowing lives in Debt/draw rows and anything still filed as Revenue
   * under that name is what the migration deliberately kept, record #411's
   * ₱0.85 reward, which is genuinely earned. Counting it as borrowing in both
   * passes double-counts it.
   */
  const migrated = new Set(
    transactions
      .filter((t) => t.type === "Debt" && t.debtId !== undefined)
      .map((t) => t.debtId as string),
  );
  const unmigratedNames = new Set(
    debts.filter((d) => !migrated.has(d.id)).map((d) => d.name.trim().toLowerCase()),
  );

  let cashIn = 0;
  let borrowedInRevenue = 0;
  let borrowedAsDebt = 0;
  let openingBalance = 0;
  let selfMoves = 0;

  for (const t of transactions) {
    if (!inRange(t)) continue;

    if (t.type === "Debt") {
      if (t.debtEffect === "draw") borrowedAsDebt += t.amount;
      continue;
    }

    if (t.type !== "Revenue") continue;
    cashIn += t.total;

    const item = t.item.trim().toLowerCase();
    if (unmigratedNames.has(item)) borrowedInRevenue += t.total;
    else if (item === "transfer of balance") openingBalance += t.total;
    else if (item === "cash on hand") selfMoves += t.total;
  }

  return {
    cashIn,
    borrowed: borrowedInRevenue + borrowedAsDebt,
    openingBalance,
    selfMoves,
    // Only what is *inside* cashIn gets subtracted from it.
    trueIncome: cashIn - borrowedInRevenue - openingBalance - selfMoves,
  };
}

// ── Repayment split, rule D2 ──────────────────────────────────────────────

export interface RepaymentSplit {
  readonly principal: Centavos;
  readonly interest: Centavos;
}

/**
 * Split a payment into principal and interest.
 *
 * A repayment may not exceed what is outstanding; the excess is interest.
 * Shown to the user before saving, never applied silently.
 */
export function splitRepayment(
  payment: Centavos,
  outstanding: Centavos,
): RepaymentSplit {
  const principal = Math.max(0, Math.min(payment, Math.max(0, outstanding)));
  return { principal, interest: payment - principal };
}

// ── Validation, rules D1, D3 ──────────────────────────────────────────────

export interface DebtValidation {
  readonly ok: boolean;
  /** Blocks the save. */
  readonly errors: readonly string[];
  /** Proceed-able. */
  readonly warnings: readonly string[];
}

export function validateDebtTransaction(
  draft: Pick<Transaction, "type" | "amount" | "debtId" | "debtEffect">,
  debt: Debt | undefined,
  outstanding: Centavos,
): DebtValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (draft.type === "Debt") {
    // Rule D1: reject the save outright.
    if (!draft.debtId) errors.push("Pick which debt this belongs to.");
    if (!draft.debtEffect) errors.push("Pick what this does: draw, repay, interest or write-off.");
    if (draft.amount <= 0) errors.push("Amount must be more than ₱0.00.");
  }

  if (debt && draft.debtEffect === "repay" && draft.amount > outstanding) {
    const split = splitRepayment(draft.amount, outstanding);
    warnings.push(
      `Only ${fmt(split.principal)} is principal. The remaining ${fmt(split.interest)} will be recorded as interest.`,
    );
  }

  // Rule D3: warn, but allow the override.
  if (debt?.creditLimit && draft.debtEffect === "draw") {
    const available = debt.creditLimit - outstanding;
    if (draft.amount > available) {
      warnings.push(
        `This exceeds the ${fmt(debt.creditLimit)} limit on ${debt.name} by ${fmt(draft.amount - available)}.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ── Due dates, rule D6 ────────────────────────────────────────────────────

export interface DebtAlert {
  readonly position: DebtPosition;
  readonly severity: "warn" | "over";
  readonly message: string;
}

/** Debts due within 7 days, or already overdue. */
export function debtAlerts(
  positions: readonly DebtPosition[],
  asOf: IsoDate = today(),
): DebtAlert[] {
  const out: DebtAlert[] = [];

  for (const p of positions) {
    if (p.status !== "open" || !p.debt.dueDate) continue;
    const days = daysBetween(asOf, p.debt.dueDate);

    if (days < 0) {
      out.push({
        position: p,
        severity: "over",
        message: `${p.debt.name} is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue, ${fmt(p.outstanding)} outstanding.`,
      });
    } else if (days <= 7) {
      out.push({
        position: p,
        severity: "warn",
        message: `${p.debt.name} is due in ${days} day${days === 1 ? "" : "s"}, ${fmt(p.outstanding)} outstanding.`,
      });
    }
  }

  return out;
}

/** Next due date for a monthly debt with no explicit date set. */
export function projectNextDue(
  position: DebtPosition,
  transactions: readonly Transaction[],
): IsoDate | undefined {
  if (position.debt.dueDate) return position.debt.dueDate;

  const repayments = rowsFor(transactions, position.debt.id).filter(
    (t) => t.debtEffect === "repay",
  );
  const last = repayments.at(-1);
  return last ? addMonths(last.date, 1) : undefined;
}
