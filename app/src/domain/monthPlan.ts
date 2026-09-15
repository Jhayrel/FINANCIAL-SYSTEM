/**
 * A month in brief, and what is safe to spend in what is left of it.
 *
 * ── What it is for ─────────────────────────────────────────────────────────
 *
 * The owner's workbook ended its Insights sheet with a block its VBA wrote
 * out: the budget, the balances, the spending against each track, the top
 * categories, the bills paid and still to come, and a daily allocation that
 * closed on one sentence, "After bills (Php 358), spend under Php 65 daily".
 * That sentence is the one that changes what happens today, and nothing in
 * the app said it.
 *
 * This works the same questions out from the ledger, once, for the Dashboard
 * and Insights both, so the two screens cannot give different answers.
 *
 * ── Safe to spend ──────────────────────────────────────────────────────────
 *
 *   free     = what the spending wallets hold
 *              − bills still due this month
 *              − debt payments due before the month ends
 *   safe     = free, or what is left of the spending budget when that is less
 *   per day  = safe ÷ the days left, today included, rounded down
 *
 * Savings are left out: they are not meant to be spent from. The bills are the
 * Budget screen's own list (`monthBills`) and the debt dates are the Debt
 * screen's (`debtDue`), so what is set aside here is what those screens show.
 * Rounded down, so the daily figure never promises a centavo that is not there.
 */

import { learnPatterns } from "./allocation";
import { totalSavingsBalance, totalWalletBalance } from "./balances";
import { assessMonthFor } from "./budget";
import { monthBills, phaseOf, type MonthBill, type MonthBills, type MonthPhase } from "./budgetView";
import { debtDue, positionsOf, type Debt, type DebtKind, type DueBasis } from "./debt";
import { addDays, daysInMonth, firstOfMonth, getDay, lastOfMonth, monthName } from "./dates";
import { formatMoney as money, type Centavos } from "./money";
import { monthTotals, spendingAttribution } from "./totals";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "./types";

type Tracks = ReturnType<typeof assessMonthFor>;

export interface KindLine {
  readonly name: string;
  readonly amount: Centavos;
  /** The same kind of spending in the month before. */
  readonly lastMonth: Centavos;
}

export interface DueDebt {
  readonly debtId: string;
  readonly name: string;
  readonly kind: DebtKind;
  readonly amount: Centavos;
  readonly dueOn: IsoDate;
  /** Negative when late. */
  readonly daysToDue: number;
  readonly basis: DueBasis;
}

export interface HabitSpend {
  readonly name: string;
  /** What it usually costs. */
  readonly amount: Centavos;
  /** When it usually comes round next, going by how often it has. Today when that is already past. */
  readonly nextOn: IsoDate;
}

export interface SafeToSpend {
  /** Today included. */
  readonly daysLeft: number;
  readonly wallets: Centavos;
  readonly reservedBills: Centavos;
  readonly reservedDebt: Centavos;
  /** Wallets less everything still due. Negative when they cannot cover it. */
  readonly free: Centavos;
  /** What is left of the spending budget, or null with none set. Negative when over. */
  readonly budgetLeft: Centavos | null;
  readonly safe: Centavos;
  readonly perDay: Centavos;
  /** Which of the two sets the figure. */
  readonly limitedBy: "wallets" | "budget";
  /** Spending that usually comes round before the month ends. Shown, not set aside. */
  readonly habits: readonly HabitSpend[];
}

export interface MonthBrief {
  readonly year: number;
  readonly month: number;
  readonly phase: MonthPhase;
  readonly daysInMonth: number;
  /** Today included. 0 for a month that is over, every day for one ahead. */
  readonly daysLeft: number;
  /** Rule 3.6's two tracks and their sum, exactly as the Budget screen judges them. */
  readonly tracks: Tracks;
  readonly cameIn: Centavos;
  readonly wentOut: Centavos;
  /** What came in less what went out. */
  readonly kept: Centavos;
  /** At the end of a month that is over; today for this month and any ahead. */
  readonly wallets: Centavos;
  readonly savings: Centavos;
  /** The largest kinds of spending, with the month before beside each. */
  readonly kinds: readonly KindLine[];
  readonly bills: MonthBills;
  /** This month only: debt payments late, or due before it ends. */
  readonly debts: readonly DueDebt[];
  /** This month only. */
  readonly safe: SafeToSpend | null;
  /** Plain sentences, each a figure and what it is measured against. */
  readonly notes: readonly string[];
}

const TOP_KINDS = 6;
const HABITS = 3;

/** A bill still to pay this month: late, due soon, or due. */
export const isOpenBill = (b: MonthBill): boolean =>
  b.state === "late" || b.state === "soon" || b.state === "due";

export function monthBrief(input: {
  readonly transactions: readonly Transaction[];
  readonly reference: ReferenceLists;
  readonly budgets: Budgets;
  readonly debts: readonly Debt[];
  readonly year: number;
  readonly month: number;
  readonly asOf: IsoDate;
}): MonthBrief {
  const { transactions, reference, budgets, debts, year, month, asOf } = input;

  const phase = phaseOf(year, month, asOf);
  const inMonth = daysInMonth(year, month);
  const start = firstOfMonth(year, month);
  const end = lastOfMonth(year, month);
  const daysLeft = phase === "past" ? 0 : phase === "future" ? inMonth : inMonth - getDay(asOf) + 1;

  const tracks = assessMonthFor(transactions, budgets, year, month);
  const cameIn = monthTotals(transactions, year, month).revenue;
  const wentOut = tracks.combined.spent;

  // A month that is over, as it ended. This month and later, as net worth counts
  // it: an entry dated later in the month is already in the wallets there, and
  // leaving it out here put two different wallet totals on one screen.
  const held = phase === "past" ? transactions.filter((t) => t.date <= end) : transactions;
  const wallets = totalWalletBalance(held, reference.wallets);
  const savings = totalSavingsBalance(held, reference.savings);

  const back = year * 12 + (month - 1) - 1;
  const prevYear = Math.floor(back / 12);
  const prevMonth = (back % 12) + 1;
  const before = spendingAttribution(transactions, {
    start: firstOfMonth(prevYear, prevMonth),
    end: lastOfMonth(prevYear, prevMonth),
  });
  const kinds = [...spendingAttribution(transactions, { start, end })]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_KINDS)
    .map(([name, amount]) => ({ name, amount, lastMonth: before.get(name) ?? 0 }));

  const bills = monthBills(transactions, reference, year, month, asOf);

  const due: DueDebt[] = [];
  if (phase === "current") {
    for (const p of positionsOf(debts.filter((d) => !d.archived), transactions, asOf)) {
      const d = debtDue(p, transactions, asOf);
      if (d.nextDue === undefined || d.daysToDue === undefined || d.nextDue > end) continue;
      due.push({
        debtId: p.debt.id,
        name: p.debt.name,
        kind: p.debt.kind,
        amount: d.amountDue,
        dueOn: d.nextDue,
        daysToDue: d.daysToDue,
        basis: d.basis,
      });
    }
    due.sort((a, b) => a.daysToDue - b.daysToDue);
  }

  let safe: SafeToSpend | null = null;
  if (phase === "current") {
    const reservedBills = bills.bills.filter(isOpenBill).reduce((s, b) => s + b.amount, 0);
    const reservedDebt = due.filter((d) => d.kind === "payable").reduce((s, d) => s + d.amount, 0);
    const free = wallets - reservedBills - reservedDebt;
    const budgetLeft = tracks.spending.budget > 0 ? tracks.spending.remaining : null;
    const room = Math.max(0, free);
    const limitedBy = budgetLeft !== null && budgetLeft < room ? "budget" : "wallets";
    const amount = Math.max(0, limitedBy === "budget" ? (budgetLeft ?? 0) : room);

    const habits = learnPatterns(transactions, asOf)
      .filter((p) => p.isRecurring)
      .map((p) => {
        const next = addDays(p.lastDate, Math.max(1, Math.round(p.averageGapDays)));
        return { name: p.name, amount: p.averageAmount, nextOn: next < asOf ? asOf : next };
      })
      .filter((h) => h.nextOn <= end)
      .sort((a, b) => a.nextOn.localeCompare(b.nextOn) || b.amount - a.amount)
      .slice(0, HABITS);

    safe = {
      daysLeft,
      wallets,
      reservedBills,
      reservedDebt,
      free,
      budgetLeft,
      safe: amount,
      perDay: daysLeft > 0 ? Math.floor(amount / daysLeft) : 0,
      limitedBy,
      habits,
    };
  }

  return {
    year,
    month,
    phase,
    daysInMonth: inMonth,
    daysLeft,
    tracks,
    cameIn,
    wentOut,
    kept: cameIn - wentOut,
    wallets,
    savings,
    kinds,
    bills,
    debts: due,
    safe,
    notes: notesFor(phase, month, tracks, cameIn, wentOut, safe),
  };
}

function notesFor(
  phase: MonthPhase,
  month: number,
  tracks: Tracks,
  cameIn: Centavos,
  wentOut: Centavos,
  safe: SafeToSpend | null,
): string[] {
  const out: string[] = [];
  const name = monthName(month);
  const over = phase === "past";

  if (phase !== "future") {
    if (tracks.combined.budget <= 0) {
      out.push(`No budget ${over ? "was" : "is"} set for ${name}.`);
    } else {
      const lines = [
        ["Spending", tracks.spending],
        ["Bills and subscriptions", tracks.billsSubs],
      ] as const;
      for (const [label, t] of lines) {
        if (t.budget <= 0) out.push(`${label} ${over ? "had" : "has"} no budget.`);
        else if (t.remaining < 0) out.push(`${label} ${over ? "went" : "is"} ${money(-t.remaining)} over its budget.`);
        else out.push(`${label} ${over ? "stayed" : "is"} within its budget, ${money(t.remaining)} ${over ? "to spare" : "left"}.`);
      }
    }
  }

  if (safe) {
    const reserved = safe.reservedBills + safe.reservedDebt;
    const what =
      safe.reservedDebt > 0 ? (safe.reservedBills > 0 ? "bills and debt payments" : "debt payments") : "bills";
    const days = `${safe.daysLeft} ${safe.daysLeft === 1 ? "day" : "days"}`;

    if (safe.wallets < 0) {
      // Said as what it is. "The ₱0.00 of bills still due is more than your wallets hold" was true and meant nothing.
      out.push(`Your wallets are ${money(-safe.wallets)} below zero, so nothing is safe to spend until that is put right.`);
    } else if (safe.free < 0) {
      out.push(`The ${money(reserved)} of ${what} still due this month is ${money(-safe.free)} more than your wallets hold.`);
    } else if (reserved > 0) {
      out.push(`After the ${money(reserved)} of ${what} still due, ${money(safe.safe)} is safe to spend: ${money(safe.perDay)} a day for ${days}.`);
    } else {
      out.push(`${money(safe.safe)} is safe to spend: ${money(safe.perDay)} a day for ${days}.`);
    }

    if (safe.budgetLeft === null) {
      out.push("With no spending budget set, this goes by your wallets alone.");
    } else if (safe.budgetLeft <= 0) {
      out.push("The spending budget is used up, so nothing more is budgeted this month.");
    } else if (safe.limitedBy === "budget") {
      out.push(`The budget is the limit this month: your wallets could cover ${money(Math.max(0, safe.free))}.`);
    } else if (safe.budgetLeft > Math.max(0, safe.free)) {
      out.push(`Your wallets are the limit this month, not the budget, which still has ${money(safe.budgetLeft)}.`);
    }
  }

  if (phase !== "future" && (cameIn > 0 || wentOut > 0)) {
    const kept = cameIn - wentOut;
    const so = phase === "current" ? "So far, " : "";
    out.push(
      kept >= 0
        ? `${so}${phase === "current" ? "you have kept" : "You kept"} ${money(kept)} of the ${money(cameIn)} that came in.`
        : `${so}${money(-kept)} more went out than came in.`,
    );
  }

  return out;
}
