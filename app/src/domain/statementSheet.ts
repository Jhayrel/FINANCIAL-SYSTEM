/**
 * A statement as a sheet: money in, money out, and a running balance.
 *
 * `buildStatement` decides which rows are on a statement. This decides what
 * each row says in the three money columns, and what the balance was before
 * the first of them, so the screen and the PDF print the same figures.
 *
 * ── The owner's layout ────────────────────────────────────────────────────
 *
 * The Excel's ACCOUNT STATEMENT, sent on 26 September 2026: Date,
 * Description, Type, Wallet from, Wallet to, Income, Expense, Balance. A
 * transfer between two wallets showed only its fee as expense, money sent out
 * showed all of it, and the balance column was everything held across every
 * wallet. This reproduces that balance to the centavo.
 *
 * ── What changed from the Excel, and why ─────────────────────────────────
 *
 * 1. Opening rows are not listed. The Excel opened a year with five "Transfer
 *    of balance" rows booked as income. Rule Y1 says an opening balance is
 *    where the year started, not money that came in, so here it is one line,
 *    "Balance brought forward", and the first real row's balance is exactly
 *    the balance the Excel printed beside it.
 * 2. On the account and wallet statements the columns are Money in and Money
 *    out, not Income and Expense. Borrowed money arriving in a wallet is money
 *    in, and calling it income is the mistake the debt module exists to stop.
 *    The revenue and expense sheets keep Income and Expense, because there the
 *    words are exact.
 */

import { formatMoney, type Centavos } from "./money";
import { allWalletBalances } from "./balances";
import { MONTH_NAMES } from "./dates";
import { owedChange, type Debt, type DebtEffect } from "./debt";
import { effectLabel } from "./debtWords";
import { costOf, incomeOf } from "./totals";
import {
  belongsIn,
  buildStatementBetween,
  rangeOf,
  STATEMENT_LABEL,
  type StatementScope,
  type StatementType,
} from "./statements";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export interface SheetLine {
  readonly id: string;
  readonly recordNumber: number;
  readonly date: IsoDate;
  readonly description: string;
  /** The Type column: Revenue, Spending, Bill, Transfer, Borrowed, Repaid... */
  readonly kind: string;
  readonly fromWallet: string;
  readonly toWallet: string;
  readonly moneyIn: Centavos;
  readonly moneyOut: Centavos;
  /** Null on a sheet with no running column. */
  readonly balance: Centavos | null;
}

export interface StatementSheet {
  readonly type: StatementType;
  /** "Account statement". */
  readonly title: string;
  /** The wallet or debt a statement follows; empty otherwise. */
  readonly subject: string;
  /** "January to September 2026". */
  readonly period: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly headings: { readonly moneyIn: string; readonly moneyOut: string; readonly balance: string };
  /** What the running column stood at before the first row. Null where it starts from nothing. */
  readonly broughtForward: Centavos | null;
  readonly lines: readonly SheetLine[];
  readonly totalIn: Centavos;
  readonly totalOut: Centavos;
  /** The running column after the last row. */
  readonly closing: Centavos;
  /** Said under the totals, when a figure needs a sentence to be read right. */
  readonly notes: readonly string[];
}

export interface SheetRequest {
  readonly type: StatementType;
  /** The first month's year. */
  readonly year: number;
  readonly fromMonth: number;
  readonly toMonth: number;
  /** The last month's year, when the statement runs across years. Defaults to `year`. */
  readonly toYear?: number | undefined;
  /** Wallet statements. */
  readonly wallet?: string | undefined;
  /** Debt statements. */
  readonly debtId?: string | undefined;
}

type Mode = "held" | "income" | "cost" | "bills" | "transfers" | "owed";

const MODE: Record<StatementType, Mode> = {
  account: "held",
  wallet: "held",
  savings: "held",
  revenue: "income",
  expense: "cost",
  bills: "bills",
  transfers: "transfers",
  debt: "owed",
  borrowed: "owed",
  credit: "owed",
  lent: "owed",
  onbehalf: "owed",
};

/*
 * ── The Type column, named for what each row is ─────────────────────────
 *
 * The owner, 27 September 2026, on three statements: "it say barrowed to my
 * on behalf like thats wrong ... use proper naming like transaction fee,
 * credit etc.. revenue". Every debt movement read Borrowed, Repaid, Lent or
 * Collected whatever the debt was, so money held for a relative read as
 * borrowing, a fee between two of the owner's own accounts read as a
 * Transfer, and money sent to someone else read as a Transfer too. Each row
 * is now named by what it is, in the words the rest of the app uses:
 *
 *   Transfer          between your own accounts
 *   Transaction Fee   the fee on one, where only the fee moved money
 *   Money Send        money that left your accounts (`transfers.ts`)
 *   Credit ...        a credit line: drawn, payment, fees added, interest
 *   Loan ...          a bank loan: received, payment, fees added, interest
 *   ... (on behalf)   Held, Released, Retained, Advance, Reimbursed, Write off
 */

/** Debt movements on a credit line, a bank loan, and a loan between people. */
const DEBT_WORDS: Record<"credit" | "loan" | "personal" | "owedToYou", Record<DebtEffect, string>> = {
  credit: {
    draw: "Credit drawn",
    repay: "Credit payment",
    charge: "Credit fees added",
    interest: "Credit interest",
    fee: "Credit fee",
    writeoff: "Credit waived",
    lend: "Lent",
    collect: "Paid back to you",
  },
  loan: {
    draw: "Loan received",
    repay: "Loan payment",
    charge: "Loan fees added",
    interest: "Loan interest",
    fee: "Loan fee",
    writeoff: "Loan waived",
    lend: "Lent",
    collect: "Paid back to you",
  },
  personal: {
    draw: "Borrowed",
    repay: "Repaid",
    charge: "Charge added",
    interest: "Interest",
    fee: "Fee",
    writeoff: "Waived",
    lend: "Lent",
    collect: "Paid back to you",
  },
  owedToYou: {
    draw: "Borrowed",
    repay: "Repaid",
    charge: "Charge added",
    interest: "Interest",
    fee: "Fee",
    writeoff: "Given up",
    lend: "Lent",
    collect: "Paid back to you",
  },
};

/** A debt movement's name, by the debt it moved. */
function debtKind(effect: DebtEffect | undefined, debt: Debt | undefined): string {
  if (!effect) return "Debt";
  if (!debt) return DEBT_WORDS.personal[effect];
  // A debt saved before it had a form is a credit line, as it is everywhere else (`debt.form ?? "credit-line"`).
  const form = debt.form ?? "credit-line";
  if (form === "pass-through") return `${effectLabel(effect, debt)} (on behalf)`;
  if (debt.kind === "receivable") return DEBT_WORDS.owedToYou[effect];
  if (form === "term-loan") return DEBT_WORDS.loan[effect];
  if (form === "credit-line" && debt.counterpartyType !== "person") return DEBT_WORDS.credit[effect];
  return DEBT_WORDS.personal[effect];
}

/**
 * The Type column.
 *
 * `onlyFee` is for a transfer between the owner's own accounts on a sheet
 * that shows only what it cost: the expense sheet, or the account statement,
 * where both ends are counted and the fee is all that left.
 */
export function kindOf(t: Transaction, debts: readonly Debt[] = [], onlyFee = false): string {
  if (t.category === "Opening") return "Opening balance";
  if (t.type === "Debt") return debtKind(t.debtEffect, debts.find((d) => d.id === t.debtId));
  if (t.type === "Transfer") {
    if (!t.toWallet.trim()) return "Money Send";
    return onlyFee || (t.amount === 0 && t.fee > 0) ? "Transaction Fee" : "Transfer";
  }
  if (t.type === "Spending") {
    if (t.category === "Bills") return "Bill";
    if (t.category === "Subscriptions") return "Subscription";
    return "Spending";
  }
  return t.type;
}

/**
 * "January to September 2026", "September 2026" for one month, and
 * "June 2024 to May 2026" across years.
 */
export function periodLabel(year: number, fromMonth: number, toMonth: number, toYear: number = year): string {
  const { from, to } = rangeOf({ year, month: fromMonth }, { year: toYear, month: toMonth });
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  if (fy !== ty) return `${MONTH_NAMES[fm - 1]} ${fy} to ${MONTH_NAMES[tm - 1]} ${ty}`;
  return fm === tm ? `${MONTH_NAMES[fm - 1]} ${fy}` : `${MONTH_NAMES[fm - 1]} to ${MONTH_NAMES[tm - 1]} ${fy}`;
}

const isOpening = (t: Transaction): boolean => t.category === "Opening";

export function buildSheet(
  transactions: readonly Transaction[],
  request: SheetRequest,
  reference: ReferenceLists,
  debts: readonly Debt[] = [],
): StatementSheet {
  const { type, year, fromMonth, toMonth } = request;
  const toYear = request.toYear ?? year;
  const scope: StatementScope = { wallet: request.wallet, debts };
  const range = rangeOf({ year, month: fromMonth }, { year: toYear, month: toMonth });
  const statement = buildStatementBetween(transactions, type, range.from, range.to, reference, request.debtId, scope);
  const mode = MODE[type];
  const savings = new Set(reference.savings);

  // Which wallets the held column adds up.
  const counts = (wallet: string): boolean => {
    if (!wallet) return false;
    if (type === "wallet") return wallet === request.wallet;
    if (type === "savings") return savings.has(wallet);
    return true;
  };
  const heldChange = (t: Transaction): Centavos => {
    let sum = 0;
    for (const [wallet, delta] of allWalletBalances([t])) if (counts(wallet)) sum += delta;
    return sum;
  };

  const debtName = new Map(debts.map((d) => [d.id, d.name]));
  const inScope = (t: Transaction): boolean =>
    type === "debt" ? (request.debtId ? t.debtId === request.debtId : t.debtId !== undefined) : belongsIn(t, type, savings, scope);

  // Where the running column stood when the period began: every row before
  // it, and the opening rows on its first day, which say where it started.
  // An opening row later on (a statement running across a New Year) is a
  // line of its own, on the day it happened, so the months before it keep
  // the balances they had.
  const foldedIn = (t: Transaction): boolean => isOpening(t) && t.date === statement.from;
  let broughtForward: Centavos | null = null;
  if (mode === "held" || mode === "owed") {
    let start = 0;
    for (const t of transactions) {
      const before = t.date < statement.from;
      if (!before && !foldedIn(t)) continue;
      if (mode === "held") start += heldChange(t);
      else if (inScope(t)) start += owedChange(t);
    }
    broughtForward = start;
  }

  let running = broughtForward ?? 0;
  let totalIn = 0;
  let totalOut = 0;
  let interest = 0;
  let sentOut = 0;
  let sentCount = 0;
  const lines: SheetLine[] = [];

  for (const { transaction: t } of statement.rows) {
    if ((mode === "held" || mode === "owed") && foldedIn(t)) continue;

    let moneyIn = 0;
    let moneyOut = 0;
    switch (mode) {
      case "held": {
        const d = heldChange(t);
        if (d > 0) moneyIn = d;
        else if (d < 0) moneyOut = -d;
        running += d;
        break;
      }
      case "income":
        moneyIn = incomeOf(t);
        running += moneyIn;
        break;
      case "cost":
      case "bills":
        moneyOut = costOf(t);
        running += moneyOut;
        break;
      case "transfers":
        // What moved, and its fee. Money sent to someone else is spending in
        // full (`transfers.ts`), and is said apart under the table rather
        // than added to the fees as if it were one.
        moneyIn = t.amount;
        moneyOut = t.fee;
        running += moneyOut;
        if (!t.toWallet.trim()) {
          sentOut += t.amount;
          sentCount += 1;
        }
        break;
      case "owed": {
        const d = owedChange(t);
        if (d > 0) moneyIn = d;
        else if (d < 0) moneyOut = -d;
        else if (t.debtEffect === "interest" || t.debtEffect === "fee") {
          // Paid from a wallet, never part of what is owed: shown, not subtracted.
          moneyOut = t.total;
          interest += t.total;
        }
        running += d;
        break;
      }
    }
    totalIn += moneyIn;
    totalOut += moneyOut;

    const onlyFee =
      t.type === "Transfer" && !!t.toWallet.trim() && (mode === "cost" || (mode === "held" && moneyIn === 0 && moneyOut > 0 && moneyOut === t.fee));
    const kind = kindOf(t, debts, onlyFee);
    const owner = debtName.get(t.debtId ?? "");
    const named = mode === "owed" && type !== "debt" ? owner : undefined;
    let text = t.description.trim() || t.item.trim() || owner || kind;
    // On a sheet of money held, a lender's fee or a waiver moves what is owed and no money: said, since its columns are blank.
    if (mode === "held" && t.type === "Debt" && moneyIn === 0 && moneyOut === 0 && owedChange(t) !== 0) {
      const d = owedChange(t);
      const whose = debts.find((x) => x.id === t.debtId)?.kind === "receivable" ? "what is owed to you" : "what you owe";
      text = `${text} (${formatMoney(Math.abs(d))} ${d > 0 ? "added to" : "taken off"} ${whose}, no money moved)`;
    }
    // Income saved with its wallet on the other side still arrived in it, as its balance counts it.
    const arrived = t.type === "Revenue" && !t.toWallet.trim() && !!t.fromWallet.trim();
    lines.push({
      id: t.id,
      recordNumber: t.recordNumber,
      date: t.date,
      description: named && named !== text ? `${named}: ${text}` : text,
      kind,
      fromWallet: arrived ? "" : t.fromWallet,
      toWallet: arrived ? t.fromWallet : t.toWallet,
      moneyIn,
      moneyOut,
      balance: running,
    });
  }

  const notes: string[] = [];
  if (sentOut > 0) {
    notes.push(
      `${sentCount === 1 ? "One of these" : `${sentCount} of these`}, ${formatMoney(sentOut)} in all, left your accounts for someone else (Money Send). That money counts as spending in full, not only its fee. Every other row moved between your own accounts, where only the fee is spending.`,
    );
  }
  if (interest > 0) {
    notes.push(
      `Of what was paid, ${formatMoney(interest)} was interest and fees. It was paid from a wallet and was never part of what is owed, so it does not lower the running figure.`,
    );
  }

  const owedWords = (): { moneyIn: string; moneyOut: string; balance: string } => {
    const debt = type === "debt" ? debts.find((d) => d.id === request.debtId) : undefined;
    if (type === "lent" || debt?.kind === "receivable") return { moneyIn: "Lent", moneyOut: "Collected", balance: "Owed to you" };
    if (type === "onbehalf") return { moneyIn: "Added", moneyOut: "Settled", balance: "Outstanding" };
    return { moneyIn: "Borrowed", moneyOut: "Paid", balance: "You owe" };
  };

  const headings =
    mode === "held"
      ? { moneyIn: "Money in", moneyOut: "Money out", balance: type === "savings" ? "Savings" : "Balance" }
      : mode === "income"
        ? { moneyIn: "Income", moneyOut: "", balance: "Total so far" }
        : mode === "cost" || mode === "bills"
          ? { moneyIn: "", moneyOut: "Expense", balance: "Total so far" }
          : mode === "transfers"
            ? { moneyIn: "Moved", moneyOut: "Fees", balance: "Fees so far" }
            : owedWords();

  const subject =
    type === "wallet" ? (request.wallet ?? "") : type === "debt" ? (debts.find((d) => d.id === request.debtId)?.name ?? "") : "";

  return {
    type,
    title: STATEMENT_LABEL[type],
    subject,
    period: periodLabel(year, fromMonth, toMonth, toYear),
    from: statement.from,
    to: statement.to,
    headings,
    broughtForward,
    lines,
    totalIn,
    totalOut,
    closing: running,
    notes,
  };
}
