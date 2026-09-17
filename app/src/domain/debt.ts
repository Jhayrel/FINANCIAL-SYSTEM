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
 *   charge       no         ▲         no        YES
 *   repay        ▼          ▼         no         NO
 *   interest     ▼          flat      no        YES
 *   writeoff     no         ▼        yes¹        no
 *
 * `charge` was added on 2026-09-17 (spec 5.6.1). Most lenders do not take
 * interest out of the wallet: they add a fee, a tax or interest to what is
 * owed, and the next payment clears it. Maya Credit adds a service fee and
 * documentary stamp tax to every draw, so ₱2,500.00 borrowed on July 29 was
 * ₱2,688.79 owed and paid on August 3. A charge is spending on the day it is
 * added, and the payment that clears it is not spending a second time.
 *
 * ¹ booked as Debt/writeoff, never Revenue, so it cannot contaminate the
 *   income trend.
 *
 * Mirror image for money lent out: lend (wallet ▼, asset ▲) and
 * collect (wallet ▲, asset ▼). Neither is spending or income.
 */

import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  getDay,
  getMonth,
  getYear,
  makeDate,
  today,
} from "./dates";
import { formatMoney as fmt, type Centavos } from "./money";
import type { DebtEffect, IsoDate, Transaction } from "./types";
import { loanSchedule, type CounterpartyKind, type DebtForm } from "./debtForms";

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
  /**
   * The day of the month a payment falls due, 1 to 31. Without it a credit
   * line is expected a month after its last payment, the way bills are. A day
   * past the end of a short month means that month's last day.
   */
  readonly dueDay?: number | undefined;
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
  /** Fees, taxes and interest the lender added to what is owed: spending, and owed. */
  readonly charged: Centavos;
  readonly repaid: Centavos;
  /** Interest and fees paid out of a wallet, inside a payment or on their own. */
  readonly interestPaid: Centavos;
  readonly writtenOff: Centavos;
  /** drawn + charged − repaid − writtenOff. Interest paid from a wallet is excluded: it is expense. */
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
const EXPENSE: ReadonlySet<DebtEffect> = new Set(["interest", "fee", "charge"]);

/**
 * What one row does to what is owed, signed.
 *
 * The one place the rule lives. The Debt screen's history, the statements and
 * the due date each kept their own copy of it, and a new effect would have
 * had to be taught to every one of them.
 */
export function owedChange(t: Pick<Transaction, "debtEffect" | "amount">): Centavos {
  switch (t.debtEffect) {
    case "draw":
    case "lend":
    case "charge":
      return t.amount;
    case "repay":
    case "collect":
    case "writeoff":
      return -t.amount;
    default:
      return 0;
  }
}

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
 *   outstanding = Σ draw + Σ charge − Σ repay − Σ writeoff
 *
 * Interest paid out of a wallet is deliberately excluded. Paying ₱2,688.79
 * against a ₱2,500.00 draw reduces principal by ₱2,500.00 and books ₱188.79 as
 * interest expense: the liability falls by the principal only.
 *
 * A charge the lender added to the balance is included, because it is owed.
 * It is what the lender's own app shows as the outstanding balance, and what
 * the next payment has to clear.
 */
export function outstandingOf(
  transactions: readonly Transaction[],
  debtId: string,
): Centavos {
  let total = 0;
  for (const t of transactions) {
    if (t.debtId !== debtId) continue;
    total += owedChange(t);
  }
  return total;
}

export function positionOf(
  debt: Debt,
  transactions: readonly Transaction[],
  asOf: IsoDate = today(),
): DebtPosition {
  let drawn = 0;
  let charged = 0;
  let repaid = 0;
  let interestPaid = 0;
  let writtenOff = 0;
  let count = 0;
  let repaymentCount = 0;

  for (const t of transactions) {
    if (t.debtId !== debt.id || t.debtEffect === undefined) continue;
    count++;

    if (INCREASING.has(t.debtEffect)) drawn += t.amount;
    else if (t.debtEffect === "charge") charged += t.amount;
    else if (DECREASING.has(t.debtEffect)) {
      repaid += t.amount;
      repaymentCount++;
    }
    else if (t.debtEffect === "writeoff") writtenOff += t.amount;
    else if (EXPENSE.has(t.debtEffect)) interestPaid += t.amount;
  }

  const outstanding = drawn + charged - repaid - writtenOff;

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
    charged,
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
 *
 * ── Interest the owner states ─────────────────────────────────────────────
 *
 * The excess rule only finds interest in a payment larger than the balance.
 * The common case is the other one: PHP 1,000.00 borrowed, a bill for
 * PHP 1,000.00 of which PHP 120.00 is interest, and PHP 1,000.00 paid. Nothing
 * in the ledger can tell that PHP 120.00 of it was interest, and no rate can be
 * assumed, because every lender works it out its own way. So the owner says
 * how much, from the bill or the lender's app, and `statedInterest` carries
 * it: that much is interest, and the rest pays the balance down.
 *
 * The rest is still held to what is owed. Stating PHP 120.00 of a PHP 1,500.00
 * payment against PHP 1,000.00 owed leaves PHP 1,380.00 for a PHP 1,000.00
 * balance, and the PHP 380.00 over it is interest too, as rule D2 says, with
 * the screen saying so before anything is saved.
 */
export function splitRepayment(
  payment: Centavos,
  outstanding: Centavos,
  statedInterest?: Centavos | null,
): RepaymentSplit {
  const stated = Math.min(Math.max(0, statedInterest ?? 0), Math.max(0, payment));
  const principal = Math.max(0, Math.min(payment - stated, Math.max(0, outstanding)));
  return { principal, interest: payment - principal };
}

// ── One movement, two rows ────────────────────────────────────────────────

/**
 * The part a movement can carry, and the id suffix its row is given.
 *
 * A payment can have interest inside it (`interest`), and a borrowing can
 * have fees added on top of it (`charge`). Either way the owner made one
 * movement and the ledger holds two rows, so the second names the first in
 * `partOf`, and everything that shows the movement puts them back together.
 */
const PART_OF: Partial<Record<DebtEffect, { readonly part: DebtEffect; readonly suffix: string }>> = {
  repay: { part: "interest", suffix: "-interest" },
  draw: { part: "charge", suffix: "-charge" },
};

/** Whether `row` is the part saved with `parent`: its interest, or its fees. */
export function isPartOf(row: Transaction, parent: Transaction): boolean {
  const link = parent.debtEffect ? PART_OF[parent.debtEffect] : undefined;
  if (!link || row.id === parent.id || row.debtEffect !== link.part) return false;
  return row.partOf === parent.id || row.id === `${parent.id}${link.suffix}`;
}

/** The row saved as part of this movement, if there is one. */
export function partOf(parent: Transaction, transactions: readonly Transaction[]): Transaction | undefined {
  if (!parent.debtEffect || !PART_OF[parent.debtEffect]) return undefined;
  return transactions.find((t) => isPartOf(t, parent));
}

/** The movement a part belongs to: the payment an interest row came with, the borrowing a charge did. */
export function parentOf(row: Transaction, transactions: readonly Transaction[]): Transaction | undefined {
  if (row.debtEffect !== "interest" && row.debtEffect !== "charge") return undefined;
  const suffix = row.debtEffect === "interest" ? "-interest" : "-charge";
  const id = row.partOf ?? (row.id.endsWith(suffix) ? row.id.slice(0, -suffix.length) : undefined);
  if (!id) return undefined;
  const parent = transactions.find((t) => t.id === id);
  return parent && isPartOf(row, parent) ? parent : undefined;
}

/** Whether `row` is the interest split off the payment `payment`. */
export function isInterestOf(row: Transaction, payment: Transaction): boolean {
  return payment.debtEffect === "repay" && isPartOf(row, payment);
}

/** The interest row saved with this payment, if some of it was interest. */
export function interestOf(
  payment: Transaction,
  transactions: readonly Transaction[],
): Transaction | undefined {
  return payment.debtEffect === "repay" ? partOf(payment, transactions) : undefined;
}

/** The payment an interest row was split off, if it was. */
export function paymentOf(
  row: Transaction,
  transactions: readonly Transaction[],
): Transaction | undefined {
  return row.debtEffect === "interest" ? parentOf(row, transactions) : undefined;
}

/**
 * A debt movement as the owner made it: a payment with the interest inside
 * it, or a borrowing with the fees added on top of it.
 */
export interface DebtMovement {
  readonly row: Transaction;
  /** The interest or the fees saved with it. */
  readonly part?: Transaction | undefined;
  /** The whole movement: what was paid, or what was added to what is owed. */
  readonly total: Centavos;
}

/**
 * Rows with each movement's part folded into it.
 *
 * The Debt history listed "Interest ₱188.79" and "Paid back ₱2,500.00" as two
 * unrelated lines, when they were one ₱2,688.79 payment, and nothing on screen
 * said the two belonged together. Order is kept; a part whose movement is not
 * in `rows` stays a line of its own.
 */
export function movementsOf(rows: readonly Transaction[]): DebtMovement[] {
  const folded = new Set<string>();
  const byParent = new Map<string, Transaction>();
  for (const row of rows) {
    const parent = parentOf(row, rows);
    if (parent) {
      byParent.set(parent.id, row);
      folded.add(row.id);
    }
  }
  return rows
    .filter((row) => !folded.has(row.id))
    .map((row) => {
      const part = byParent.get(row.id);
      return { row, part, total: row.total + (part?.total ?? 0) };
    });
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

// ── Which way the money moves, by direction ─────────────────────────────────

const PAYABLE_EFFECTS: readonly DebtEffect[] = ["draw", "charge", "repay", "interest", "writeoff"];
const RECEIVABLE_EFFECTS: readonly DebtEffect[] = ["lend", "collect", "writeoff"];

/**
 * The effects a debt can take.
 *
 * The form offered draw, repay, interest and write-off for every debt, so
 * money lent to a friend could be recorded as a "draw": the wallet went up
 * (a draw lands money in an account) and so did what they owed you, and the
 * same PHP 500 was counted twice. Money owed to you is lent and collected.
 * Interest on it would be income, not spending, so it is not offered.
 */
export function effectsFor(kind: DebtKind): readonly DebtEffect[] {
  return kind === "payable" ? PAYABLE_EFFECTS : RECEIVABLE_EFFECTS;
}

/**
 * The effects offered as choices, which is fewer than the ones allowed.
 *
 * "Interest only" was a payment that was all interest, and a payment says
 * that itself now ("Interest included"), so a new entry is offered Borrowed,
 * Charge added, Paid and Waived. A saved interest row being corrected still
 * shows its own effect, or the form would open with nothing chosen.
 */
export function choicesFor(
  kind: DebtKind,
  current?: DebtEffect | undefined,
  form?: DebtForm | undefined,
): readonly DebtEffect[] {
  if (kind === "receivable") return RECEIVABLE_EFFECTS;
  // Money held for someone takes no charges: nobody is lending it.
  const base: DebtEffect[] = form === "pass-through" ? ["draw", "repay", "writeoff"] : ["draw", "charge", "repay", "writeoff"];
  return current && !base.includes(current) && PAYABLE_EFFECTS.includes(current) ? [...base, current] : base;
}

const sameText = (a: string): string => a.trim().toLowerCase();

/**
 * The debt a spending row's item names, if any.
 *
 * The Excel filed the Maya Credit bill under Bills, and that habit carries
 * over: the money leaves the wallet, counts as spending, and what is owed
 * never comes down. The item naming the debt is the tell. A name shorter
 * than six letters is only matched exactly, so "Joy" does not catch "Joyride".
 */
export function debtNamedBy(debts: readonly Debt[], item: string): Debt | undefined {
  const said = sameText(item);
  if (!said) return undefined;
  // An exact name is never ambiguous, whatever else the row reads like.
  const exact = debts.find((d) => sameText(d.name) === said);
  if (exact) return exact;

  /**
   * Two debts owed to the same person: "Tita loan" and "Tita loan 2".
   *
   * The loose match returned whichever came first, so a payment on the second
   * was offered against the first and the balance of a debt nobody was paying
   * came down. Two loose matches and no exact one means the row has to say
   * which, so nothing is offered and the form asks.
   */
  const loose = debts.filter((d) => {
    const name = sameText(d.name);
    return name.length >= 6 && said.includes(name);
  });
  return loose.length === 1 ? loose[0] : undefined;
}

/**
 * An account renamed in Settings, carried into the debts that move through it.
 *
 * The rows are renamed by `renameAccount`. A debt names its account too, and
 * left on the old name, "Record payment" filled in a wallet that no longer
 * existed: the payment saved against a name with no account behind it, and
 * that name's balance went negative on no screen at all.
 */
export function renameDebtAccount(debts: readonly Debt[], from: string, to: string): Debt[] {
  return debts.map((d) =>
    d.wallet === from || d.counterparty === from
      ? {
          ...d,
          wallet: d.wallet === from ? to : d.wallet,
          counterparty: d.counterparty === from ? to : d.counterparty,
        }
      : d,
  );
}

/** Spending rows that name a debt: payments or loans filed as spending. */
export function paymentsFiledAsSpending(
  debts: readonly Debt[],
  transactions: readonly Transaction[],
): { readonly debt: Debt; readonly row: Transaction }[] {
  const out: { debt: Debt; row: Transaction }[] = [];
  if (debts.length === 0) return out;
  for (const row of transactions) {
    if (row.type !== "Spending") continue;
    const debt = debtNamedBy(debts, row.item);
    if (debt) out.push({ debt, row });
  }
  return out;
}

// ── When the next payment falls due ────────────────────────────────────────

export type DueBasis = "due-day" | "schedule" | "last-payment" | "borrowed" | "none";

export interface DebtDue {
  readonly position: DebtPosition;
  /** The next payment date. Undefined when nothing is owed or there is no rhythm to go by. */
  readonly nextDue?: IsoDate | undefined;
  /** Negative when late. */
  readonly daysToDue?: number | undefined;
  /** How the date was worked out, so the screen can say "going by the last payment". */
  readonly basis: DueBasis;
  /** A loan's instalment; otherwise everything outstanding. Never more than is owed. */
  readonly amountDue: Centavos;
  /**
   * The last payment as it was made: `amount` is all of it, interest
   * included, and `interest` is the part of it that was interest. The card
   * said "Last payment PHP 2,500.00" for a PHP 2,688.79 payment.
   */
  readonly lastPayment?:
    | { readonly date: IsoDate; readonly amount: Centavos; readonly interest: Centavos }
    | undefined;
  /** When the balance now owed began: the first movement after it was last at zero. */
  readonly since?: IsoDate | undefined;
}

/**
 * A payment this close before a due day is taken as paying that due day.
 * Paying Maya Credit on the 30th for a bill due on the 3rd is on time, and
 * without this the 3rd would be reported late.
 */
const PAID_AHEAD_DAYS = 20;
/** A balance begun this close to a due day is first due the month after. */
const FIRST_DUE_DAYS = 14;

function onDay(year: number, month: number, day: number): IsoDate {
  return makeDate(year, month, Math.min(Math.max(1, day), daysInMonth(year, month)));
}

function monthAfter(date: IsoDate, day: number): IsoDate {
  const index = getYear(date) * 12 + getMonth(date); // the month after, zero-based
  return onDay(Math.floor(index / 12), (index % 12) + 1, day);
}

/** The first date after `from` that falls on `day` of its month. */
function nextOnDay(from: IsoDate, day: number): IsoDate {
  const same = onDay(getYear(from), getMonth(from), day);
  return same > from ? same : monthAfter(from, day);
}

/**
 * When the next payment on a debt is due, and how much.
 *
 * ── Why this replaced the fixed due date ─────────────────────────────────
 *
 * Rule D6 only knew `dueDate`, one date that nothing in the app could set,
 * so no debt was ever reported due. The Debt screen did project a date, a
 * month after the last repayment, and printed it without judging it: Maya
 * Credit read "next due September 3, 2026" on September 15 with nothing
 * saying that was twelve days ago.
 *
 * In order:
 *
 *   1. A loan with a schedule: its next instalment.
 *   2. A due day: the first one after the last payment, skipping one a
 *      payment was made for in the twenty days before it.
 *   3. A credit line: a month after the last payment, or after the balance
 *      began if nothing has been paid since.
 *   4. Money borrowed from or lent to a person, with no due day: none. A
 *      handshake has no schedule, and inventing one would nag.
 */
export function debtDue(
  position: DebtPosition,
  transactions: readonly Transaction[],
  asOf: IsoDate,
): DebtDue {
  const { debt } = position;
  const paying: DebtEffect = debt.kind === "payable" ? "repay" : "collect";

  let balance = 0;
  let since: IsoDate | undefined;
  let lastPayment: { date: IsoDate; amount: Centavos; interest: Centavos } | undefined;
  const rows = rowsFor(transactions, debt.id);
  for (const t of rows) {
    if (t.debtEffect === undefined) continue;
    const before = balance;
    balance += owedChange(t);
    if (before <= 0 && balance > 0) since = t.date;
    if (t.debtEffect === paying) {
      const interest = interestOf(t, rows)?.amount ?? 0;
      lastPayment = { date: t.date, amount: t.amount + interest, interest };
    }
  }

  const none: DebtDue = { position, basis: "none", amountDue: 0, lastPayment, since };
  if (position.status !== "open" || position.outstanding <= 0) return none;

  const withDate = (nextDue: IsoDate, basis: DueBasis, amountDue: Centavos): DebtDue => ({
    position,
    nextDue,
    daysToDue: daysBetween(asOf, nextDue),
    basis,
    amountDue: Math.min(amountDue, position.outstanding),
    lastPayment,
    since,
  });

  const form = debt.form ?? "credit-line";
  if (form === "term-loan") {
    const schedule = loanSchedule(position, asOf);
    if (schedule?.nextDue) return withDate(schedule.nextDue, "schedule", schedule.monthlyPayment);
  }

  // A payment made for this balance, rather than for one already cleared.
  const paidSince = lastPayment && (!since || lastPayment.date >= since) ? lastPayment : undefined;
  const anchor = paidSince?.date ?? since;
  if (!anchor) return none;

  const day = debt.dueDay ?? (debt.dueDate ? getDay(debt.dueDate) : undefined);
  if (day !== undefined && day >= 1 && day <= 31) {
    let next = nextOnDay(anchor, day);
    const gap = daysBetween(anchor, next);
    // Paid within the twenty days before it: that due day is covered. Begun
    // within the fortnight before it: the balance is first due the month after.
    if (paidSince ? gap <= PAID_AHEAD_DAYS : gap < FIRST_DUE_DAYS) {
      next = monthAfter(next, day);
    }
    return withDate(next, "due-day", position.outstanding);
  }

  if (form === "informal") return none;
  return withDate(addMonths(anchor, 1), paidSince ? "last-payment" : "borrowed", position.outstanding);
}

/** Payments late or due within `days`, soonest first. */
export function duesWithin(dues: readonly DebtDue[], days = 7): DebtDue[] {
  return dues
    .filter((d) => d.daysToDue !== undefined && d.daysToDue <= days)
    .sort((a, b) => (a.daysToDue ?? 0) - (b.daysToDue ?? 0));
}

/** "going by the last payment", for a date that was worked out rather than set. */
export function basisWords(basis: DueBasis): string {
  switch (basis) {
    case "last-payment":
      return "a month after the last payment";
    case "borrowed":
      return "a month after it was borrowed";
    case "schedule":
      return "the loan's schedule";
    case "due-day":
      return "its due day";
    default:
      return "";
  }
}

// ── How fast it is moving ──────────────────────────────────────────────────

export interface DebtPace {
  /** Borrowed, or lent, in the last 30 days. */
  readonly added30: Centavos;
  /** Paid down, or collected, in the last 30 days. */
  readonly paid30: Centavos;
  /** Charges the lender added in the last 30 days. */
  readonly charged30: Centavos;
  /** A month's payments, averaged over the last three months. 0 when none. */
  readonly monthlyPayment: Centavos;
  /** Months to clear at that rate, or null when nothing is being paid. */
  readonly monthsToClear: number | null;
}

/**
 * Whether a debt is shrinking, and how long it has left at this rate.
 *
 * Not a forecast: a statement about the last three months, said as one.
 */
export function debtPace(
  position: DebtPosition,
  transactions: readonly Transaction[],
  asOf: IsoDate,
): DebtPace {
  const month = addDays(asOf, -30);
  const quarter = addDays(asOf, -90);
  let added30 = 0;
  let paid30 = 0;
  let charged30 = 0;
  let paid90 = 0;
  for (const t of rowsFor(transactions, position.debt.id)) {
    if (t.date > asOf || t.debtEffect === undefined) continue;
    if (INCREASING.has(t.debtEffect) && t.date > month) added30 += t.amount;
    if (t.debtEffect === "charge" && t.date > month) charged30 += t.amount;
    if (DECREASING.has(t.debtEffect)) {
      if (t.date > month) paid30 += t.amount;
      if (t.date > quarter) paid90 += t.amount;
    }
  }
  const monthlyPayment = Math.round(paid90 / 3);
  return {
    added30,
    paid30,
    charged30,
    monthlyPayment,
    monthsToClear:
      monthlyPayment > 0 && position.outstanding > 0
        ? Math.ceil(position.outstanding / monthlyPayment)
        : null,
  };
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
