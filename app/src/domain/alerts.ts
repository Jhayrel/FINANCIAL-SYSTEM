/**
 * Finance alerts.
 *
 * Ported from `GenerateFinanceAlerts` in Module6, with one change of approach.
 *
 * ── Why this is not a direct port ─────────────────────────────────────────
 *
 * The VBA works backwards. `GetBurnRate`, `GetShortfall`, `GetDailyBudget` and
 * `GetAvailableSpending` all read the same cell, `INSIGHTS!B26`, and pull
 * numbers back out of the sentence that was written into it:
 *
 *     searchPos = InStr(1, fullText, "Burn Rate:", vbTextCompare)
 *     numStr = Mid(fullText, numStart + 3, 20)
 *
 * The figures were computed, rendered to prose, then parsed out of the prose.
 * Rewording the sentence breaks the alert; a missing "Php" returns zero and the
 * alert quietly says everything is fine. Every one of those functions is
 * wrapped in `On Error Resume Next`, so a failure looks like a zero.
 *
 * Here the alerts read the ledger. Nothing is parsed, so nothing can be lost in
 * the round trip, and the wording is free to change.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 *
 * No alert invents advice. Each one states a figure the owner can check and
 * says what it is measured against. "You are spending too much" is not an
 * alert, it is an opinion; "PHP 8,791.37 spent of a PHP 7,700.00 budget with
 * 3 days left" is a fact they can act on.
 */

import { walletBalance } from "./balances";
import { assessMonthFor } from "./budget";
import { overdue, upcoming, type BillStatus } from "./bills";
import { debtAlerts, positionsOf, type Debt } from "./debt";
import { daysInMonth, getMonth, getYear } from "./dates";
import { actionableIssues, checkIntegrity } from "./integrity";
import { monthTotals } from "./totals";
import { overdueGoals } from "./goalClose";
import { patternFindings, type Finding } from "./patterns";
import type { Account } from "./accounts";
import type { Centavos } from "./money";
import type { Budgets, IsoDate, Transaction } from "./types";

export type AlertLevel = "over" | "warn" | "info";

/** Which part of the app a finding belongs to, so it can link there. */
export type AlertArea =
  | "budget"
  | "wallet"
  | "bills"
  | "debt"
  | "goals"
  /** How the money moved, rather than what it came to. */
  | "pattern"
  | "review";

export interface Alert {
  readonly id: string;
  readonly level: AlertLevel;
  readonly area: AlertArea;
  readonly title: string;
  /** One line. The figure and what it is measured against. */
  readonly detail: string;
  /** Sorted on this, highest first. */
  readonly weight: number;
}

/**
 * Plain headings. The detail carries the figures, so the title only has to
 * say which kind of thing this is.
 */
const PATTERN_TITLE: Record<Finding["kind"], string> = {
  velocity: "Money left quickly after it arrived",
  migration: "Spending moved rather than stopped",
  repetition: "This has happened before",
  streak: "A long gap ended",
  uncategorised: "Rows with no category",
};

export interface AlertInput {
  readonly transactions: readonly Transaction[];
  readonly accounts: readonly Account[];
  readonly budgets: Budgets;
  readonly debts: readonly Debt[];
  readonly bills: readonly BillStatus[];
  readonly lowBalanceThreshold: Centavos;
  readonly asOf: IsoDate;
}

/** Pace of spending so far this month, per day. */
export function burnRate(
  transactions: readonly Transaction[],
  asOf: IsoDate,
): Centavos {
  const year = getYear(asOf);
  const month = getMonth(asOf);
  const dayOfMonth = Number(asOf.slice(8, 10));
  if (dayOfMonth <= 0) return 0;
  return Math.round(monthTotals(transactions, year, month).total / dayOfMonth);
}

/** Days left in the month, including today. */
export function daysLeft(asOf: IsoDate): number {
  const total = daysInMonth(getYear(asOf), getMonth(asOf));
  return Math.max(0, total - Number(asOf.slice(8, 10)) + 1);
}

/**
 * What is left of the budget, spread over the days remaining.
 *
 * Null when no budget is set for the month: a daily figure derived from no
 * budget is a number with nothing behind it.
 */
export function dailyAllowance(
  transactions: readonly Transaction[],
  budgets: Budgets,
  asOf: IsoDate,
): Centavos | null {
  const assessment = assessMonthFor(transactions, budgets, getYear(asOf), getMonth(asOf));
  if (assessment.combined.budget <= 0) return null;
  const left = daysLeft(asOf);
  if (left === 0) return 0;
  return Math.round(assessment.combined.remaining / left);
}

/**
 * Every finding, worst first.
 *
 * Reporting only. Nothing here changes a row, and nothing auto-corrects, which
 * is the same rule the integrity checks follow (CLAUDE.md §4).
 */
export function financeAlerts(input: AlertInput): Alert[] {
  const { transactions, accounts, budgets, debts, bills, lowBalanceThreshold, asOf } = input;
  const out: Alert[] = [];

  const year = getYear(asOf);
  const month = getMonth(asOf);
  const assessment = assessMonthFor(transactions, budgets, year, month);
  const left = daysLeft(asOf);

  // ── Budget ───────────────────────────────────────────────────────────────
  if (assessment.combined.budget > 0) {
    const over = -assessment.combined.remaining;
    if (over > 0) {
      out.push({
        id: "budget-over",
        level: "over",
        area: "budget",
        title: "Over budget this month",
        detail: `${money(assessment.combined.spent)} spent of ${money(assessment.combined.budget)}, over by ${money(over)}, with ${left} day${left === 1 ? "" : "s"} left.`,
        weight: 100 + fraction(over, assessment.combined.budget),
      });
    } else {
      const perDay = dailyAllowance(transactions, budgets, asOf);
      const rate = burnRate(transactions, asOf);
      // Only worth saying when the current pace would actually break it.
      if (perDay !== null && rate > perDay && left > 0) {
        out.push({
          id: "budget-pace",
          level: "warn",
          area: "budget",
          title: "Spending faster than the budget allows",
          detail: `${money(rate)} a day so far. ${money(assessment.combined.remaining)} left over ${left} day${left === 1 ? "" : "s"} is ${money(perDay)} a day.`,
          weight: 70,
        });
      }
    }
  }

  // ── Wallets running low ──────────────────────────────────────────────────
  if (lowBalanceThreshold > 0) {
    for (const account of accounts) {
      if (account.archived || account.kind !== "spending") continue;
      const balance = walletBalance(transactions, account.name);
      if (balance >= lowBalanceThreshold) continue;

      out.push({
        id: `low-${account.id}`,
        level: balance <= 0 ? "over" : "warn",
        area: "wallet",
        title: balance <= 0 ? `${account.name} is empty` : `${account.name} is running low`,
        detail: `${money(balance)}, under the ${money(lowBalanceThreshold)} you asked to be warned at.`,
        weight: balance <= 0 ? 90 : 60,
      });
    }
  }

  // ── Bills ────────────────────────────────────────────────────────────────
  const late = overdue(bills);
  if (late.length > 0) {
    out.push({
      id: "bills-overdue",
      level: "over",
      area: "bills",
      title: `${late.length} bill${late.length === 1 ? "" : "s"} past due`,
      detail: `${late.map((b) => b.item).join(", ")}. Predicted due before today and not yet paid.`,
      weight: 85,
    });
  }

  /**
   * Due today and due tomorrow, split out and weighted above everything.
   *
   * This is the VBA's own priority order, and it was right: `msgDueToday`
   * and `msgDueTomorrow` outranked the budget line, the balance line and
   * the shortfall warning, because they are the only ones with a deadline
   * you can still act on. Folding them into one "due within a week" line
   * at the bottom of the list buried the one thing that was actually due.
   *
   * The amount comes too. The VBA listed names only, which meant reaching
   * for the phone to find out what it would cost.
   */
  const dated = (b: BillStatus): number => b.daysToDue ?? Number.POSITIVE_INFINITY;

  const dueToday = bills.filter((b) => !b.paidThisMonth && dated(b) === 0);
  if (dueToday.length > 0) {
    out.push({
      id: "bills-today",
      level: "warn",
      area: "bills",
      title: `Due today: ${dueToday.map((b) => b.item).join(", ")}`,
      detail: `${money(sumOf(dueToday))} expected, going by what each cost last time.`,
      weight: 88,
    });
  }

  const dueTomorrow = bills.filter((b) => !b.paidThisMonth && dated(b) === 1);
  if (dueTomorrow.length > 0) {
    out.push({
      id: "bills-tomorrow",
      level: "info",
      area: "bills",
      title: `Due tomorrow: ${dueTomorrow.map((b) => b.item).join(", ")}`,
      detail: `${money(sumOf(dueTomorrow))} expected, going by what each cost last time.`,
      weight: 75,
    });
  }

  // The rest of the week, which is information rather than a deadline.
  const soon = upcoming(bills, 7).filter((b) => dated(b) > 1);
  if (soon.length > 0) {
    out.push({
      id: "bills-soon",
      level: "info",
      area: "bills",
      title: `${soon.length} more bill${soon.length === 1 ? "" : "s"} due this week`,
      detail: `${soon.map((b) => b.item).join(", ")}. ${money(sumOf(soon))} in total.`,
      weight: 40,
    });
  }

  /**
   * Patterns, which is the part a total cannot say.
   *
   * Everything above this point reports a number that is already on screen
   * somewhere. These report how the numbers got there, which is the only
   * kind of finding that can change the next decision rather than describe
   * the last one. See `domain/patterns.ts`.
   */
  for (const finding of patternFindings({
    transactions,
    asOf,
    wallets: accounts.filter((a) => a.kind === "spending" && !a.archived).map((a) => a.name),
  })) {
    out.push({
      id: finding.id,
      level: finding.weight >= 80 ? "warn" : "info",
      area: "pattern",
      title: PATTERN_TITLE[finding.kind],
      detail: finding.detail,
      weight: finding.weight,
    });
  }

  // ── Debt ─────────────────────────────────────────────────────────────────
  const positions = positionsOf(debts, transactions, asOf);
  for (const d of debtAlerts(positions, asOf)) {
    out.push({
      id: `debt-${d.position.debt.id}`,
      level: d.severity,
      area: "debt",
      title: d.position.debt.name,
      detail: d.message,
      weight: d.severity === "over" ? 95 : 65,
    });
  }

  // ── Goals past their deadline ────────────────────────────────────────────
  const goals = accounts.filter((a) => a.kind === "goal");
  for (const { goal, balance } of overdueGoals(goals, transactions, asOf)) {
    out.push({
      id: `goal-${goal.id}`,
      level: "warn",
      area: "goals",
      title: `${goal.name} is past its deadline`,
      detail: `${money(balance)} still set aside. Close it to move the money back, or extend the deadline.`,
      weight: 50,
    });
  }

  // ── Rows the ledger cannot make sense of ─────────────────────────────────
  const issues = actionableIssues(checkIntegrity(transactions));
  if (issues.length > 0) {
    const rows = new Set(issues.flatMap((i) => i.recordNumbers));
    out.push({
      id: "needs-review",
      level: "warn",
      area: "review",
      title: `${rows.size} row${rows.size === 1 ? "" : "s"} need review`,
      detail: issues[0]?.message ?? "Money that left a wallet without counting as spending.",
      weight: 55,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** The worst level present, or null when there is nothing to say. */
export function worstLevel(alerts: readonly Alert[]): AlertLevel | null {
  if (alerts.some((a) => a.level === "over")) return "over";
  if (alerts.some((a) => a.level === "warn")) return "warn";
  if (alerts.length > 0) return "info";
  return null;
}

/** What a set of predicted bills is expected to cost, using each one's last. */
const sumOf = (bills: readonly BillStatus[]): Centavos =>
  bills.reduce((total, b) => total + (b.lastAmount || b.averageAmount), 0);

const money = (c: Centavos): string =>
  `₱${(Math.abs(c) / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** 0 to 20, so a bigger overrun sorts above a smaller one. */
const fraction = (part: Centavos, whole: Centavos): number =>
  whole <= 0 ? 0 : Math.min(20, Math.round((part / whole) * 20));
