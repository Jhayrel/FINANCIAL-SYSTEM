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
 *              − bills and subscriptions still due this month
 *              − debt payments due before the month ends
 *   safe     = free, never below zero
 *   today    = (safe + what today already spent) ÷ the days left, today
 *              included, less what today already spent
 *   after    = safe ÷ the days after today
 *
 * The owner, 6 October 2026: "5000 money then 1700 alloted for subscription
 * and bills then I have 3,300 safe to spend and the safe to spend today
 * is ... make it accurate based on real things". Safe to spend is the money
 * that is there, less what is already promised to bills, subscriptions and
 * lenders. Until then the spending budget could lower it, so the Dashboard
 * said one figure and the chat, reading the wallets, another (₱297.95 a day
 * against ₱201.13 on 6 October). The budget is a plan, not money: it is
 * still worked out (`budgetLeft`, `budgetPerDay`) and said beside the figure
 * when it is the tighter of the two, but it no longer changes it.
 *
 * Today is a share, not a rate. Spending ₱3,201.00 in the morning used to
 * divide what was left by every day still to come, today included, so the
 * day's figure dropped for the whole month and never said today was spent.
 * Now today's share is set from what the wallets held before today's
 * spending, today's spending comes out of it, and the rest of the month
 * gets the rest.
 *
 * Only spending is put back for today's share. Money that moved today
 * without being spent (income, a transfer to savings, money paid for someone
 * and paid back) changes every day's share alike, as it changes what is
 * there for all of them: on 6 October the father's ₱599.00 out and ₱600.00
 * back moved today's share by under a centavo a day. A bill, subscription or
 * debt payment paid today is not today's spending either: it was set aside
 * already, and paying it leaves the wallets and what is set aside alike.
 *
 * Savings are left out: they are not meant to be spent from. The bills are the
 * Budget screen's own list (`monthBills`) and the debt dates are the Debt
 * screen's (`debtDue`), so what is set aside here is what those screens show.
 * Rounded down, so a daily figure never promises a centavo that is not there.
 */

import { learnPatterns } from "./allocation";
import { totalSavingsBalance, totalWalletBalance } from "./balances";
import { assessMonthFor } from "./budget";
import { monthBills, phaseOf, type MonthBill, type MonthBills, type MonthPhase } from "./budgetView";
import { debtDue, positionsOf, type Debt, type DebtKind, type DueBasis } from "./debt";
import { addDays, daysInMonth, firstOfMonth, getDay, lastOfMonth, monthName } from "./dates";
import { formatMoney as money, type Centavos } from "./money";
import { costByKind } from "./kinds";
import { monthTotals, totalsFor } from "./totals";
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
  /** What the spending budget leaves a day, the Budget screen's figure. Null with none set; 0 when over. */
  readonly budgetPerDay: Centavos | null;
  /** Wallets less what is still due, never below zero: safe to spend until the month ends. */
  readonly safe: Centavos;
  /** Safe to spend today: today's share less what today already spent, never below zero. */
  readonly perDay: Centavos;
  /** Today's share, set from what the wallets held before today's spending. */
  readonly todayShare: Centavos;
  /** Spent today out of the spending wallets, bills and subscriptions apart (they are set aside already). */
  readonly spentToday: Centavos;
  /** How far today's spending went past today's share. 0 when it did not. */
  readonly overToday: Centavos;
  /** A day from tomorrow: what is safe over the days after today. 0 on the month's last day. */
  readonly perDayAfter: Centavos;
  /**
   * Which is tighter. The wallets set the figure; "budget" says the spending
   * budget leaves less than they do, so it is said beside it.
   */
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
  /**
   * Of those, the ones that need doing something about: over a budget, past
   * today's share, more due than held. The Dashboard shows only these, since
   * its lines already say the rest (6 October 2026: "make it clean").
   */
  readonly warnings: readonly string[];
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

  /*
   * Where it went, the same way Insights says it.
   *
   * This read `spendingAttribution`, the spending track's split, under a
   * heading that says where the money went. Bills, subscriptions and what a
   * lender charged are not in that split, so the Dashboard was short by
   * PHP 1,641.00 in most of the owner's months, and in a month whose biggest
   * outgoing is a bill it left the biggest thing off the list. Insights had
   * already been put right on its own; `domain/kinds.ts` is now the one
   * answer both screens read (`agreement.test.ts`).
   */
  const back = year * 12 + (month - 1) - 1;
  const prevYear = Math.floor(back / 12);
  const prevMonth = (back % 12) + 1;
  const inThis = transactions.filter((t) => t.date >= start && t.date <= end);
  const inPrevious = transactions.filter(
    (t) => t.date >= firstOfMonth(prevYear, prevMonth) && t.date <= lastOfMonth(prevYear, prevMonth),
  );
  const before = new Map(costByKind(inPrevious, debts).map((k) => [k.name, k.amount]));
  const kinds = costByKind(inThis, debts)
    .slice(0, TOP_KINDS)
    .map(({ name, amount }) => ({ name, amount, lastMonth: before.get(name) ?? 0 }));

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
    const amount = Math.max(0, free);
    const limitedBy = budgetLeft !== null && budgetLeft < amount ? "budget" : "wallets";
    const budgetPerDay = budgetLeft === null ? null : daysLeft > 0 ? Math.floor(Math.max(0, budgetLeft) / daysLeft) : 0;

    /*
     * What today already took out of the spending wallets, bills and
     * subscriptions apart: a bill paid today leaves the wallets and the
     * bills still due alike, so it changes nothing here. A transfer between
     * two of the owner's own accounts counts only its fee; money sent away
     * counts whole (`totalsFor`).
     */
    const spendingWallets = new Set(reference.wallets);
    const today = totalsFor(transactions.filter((t) => t.date === asOf && spendingWallets.has(t.fromWallet)));
    const spentToday = today.spending + today.fees;
    const todayShare = daysLeft > 0 ? Math.floor((amount + spentToday) / daysLeft) : 0;
    const leftToday = todayShare - spentToday;
    const after = daysLeft - 1;

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
      budgetPerDay,
      safe: amount,
      // Never more than is safe for the whole month, whatever today's share says.
      perDay: Math.min(amount, Math.max(0, leftToday)),
      todayShare,
      spentToday,
      overToday: Math.max(0, -leftToday),
      /*
       * As if the rest of today's share is spent: the same rate as today's
       * when today kept to it (never a centavo more, as rounding could give),
       * and what is left spread over the days after when today went past it.
       */
      perDayAfter: after <= 0 ? 0 : leftToday >= 0 ? Math.min(todayShare, Math.floor((amount - leftToday) / after)) : Math.floor(amount / after),
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
    ...(() => {
      const warnings: string[] = [];
      return { notes: notesFor(phase, month, tracks, cameIn, wentOut, safe, warnings), warnings };
    })(),
  };
}

function notesFor(
  phase: MonthPhase,
  month: number,
  tracks: Tracks,
  cameIn: Centavos,
  wentOut: Centavos,
  safe: SafeToSpend | null,
  /** Filled with the notes that need doing something about, as they are written. */
  warnings: string[] = [],
): string[] {
  const out: string[] = [];
  const warn = (line: string): void => {
    out.push(line);
    warnings.push(line);
  };
  const name = monthName(month);
  const over = phase === "past";

  if (phase !== "future") {
    if (tracks.combined.budget <= 0) {
      warn(`No budget ${over ? "was" : "is"} set for ${name}.`);
    } else {
      const lines = [
        ["Spending", tracks.spending],
        ["Bills and subscriptions", tracks.billsSubs],
      ] as const;
      for (const [label, t] of lines) {
        if (t.budget <= 0) out.push(`${label} ${over ? "had" : "has"} no budget.`);
        else if (t.remaining < 0) warn(`${label} ${over ? "went" : "is"} ${money(-t.remaining)} over its budget.`);
        else out.push(`${label} ${over ? "stayed" : "is"} within its budget, ${money(t.remaining)} ${over ? "to spare" : "left"}.`);
      }
    }
  }

  if (safe) {
    const reserved = safe.reservedBills + safe.reservedDebt;
    const what =
      safe.reservedDebt > 0
        ? safe.reservedBills > 0
          ? "bills, subscriptions and debt payments"
          : "debt payments"
        : "bills and subscriptions";

    if (safe.wallets < 0) {
      // Said as what it is. "The ₱0.00 of bills still due is more than your wallets hold" was true and meant nothing.
      warn(`Your wallets are ${money(-safe.wallets)} below zero, so nothing is safe to spend until that is put right.`);
    } else if (safe.free < 0) {
      warn(`The ${money(reserved)} of ${what} still due this month is ${money(-safe.free)} more than your wallets hold.`);
    } else {
      out.push(
        reserved > 0
          ? `Your wallets hold ${money(safe.wallets)}. Less the ${money(reserved)} of ${what} still to pay, ${money(safe.safe)} is safe to spend until ${name} ends.`
          : `Your wallets hold ${money(safe.wallets)} and nothing is still due, so all of it is safe to spend until ${name} ends.`,
      );
      if (safe.overToday > 0) {
        warn(`Today's share was ${money(safe.todayShare)} and ${money(safe.spentToday)} went out today, ${money(safe.overToday)} past it.`);
      }
    }

    if (safe.budgetLeft !== null && safe.budgetLeft <= 0) {
      warn("The spending budget is used up: anything more this month is past the plan, even with the money there.");
    } else if (safe.limitedBy === "budget" && safe.budgetLeft !== null) {
      warn(`The spending budget has less left than this, ${money(safe.budgetLeft)}: ${money(safe.budgetPerDay ?? 0)} a day keeps to it.`);
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
