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
import { basisWords, debtDue, debtNamedBy, paymentsFiledAsSpending, positionsOf, type Debt } from "./debt";
import { addDays, daysBetween, daysInMonth, formatMedium, getMonth, getYear, monthName } from "./dates";
import { unusualRows } from "./unusual";
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
  /** Words to search the Database for, when the finding is about particular rows. */
  readonly query?: string | undefined;
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
        title:
          balance < 0
            ? `${account.name} is below zero`
            : balance === 0
              ? `${account.name} is empty`
              : `${account.name} is running low`,
        detail: `${balance < 0 ? "−" : ""}${money(balance)}, under the ${money(lowBalanceThreshold)} you asked to be warned at.`,
        weight: balance <= 0 ? 90 : 60,
        query: account.name,
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
  /**
   * A payment late or due within the week, on the date the Debt screen shows.
   *
   * This read only a fixed `dueDate` that nothing in the app could set, so no
   * debt was ever reported due: on 2026-09-15 Maya Credit had gone twelve
   * days past the date its own card printed, and the list said nothing.
   * `debtDue` works the date out the way the card does.
   */
  const live = debts.filter((d) => !d.archived);
  for (const p of positionsOf(live, transactions, asOf)) {
    const due = debtDue(p, transactions, asOf);
    if (due.nextDue === undefined || due.daysToDue === undefined || due.daysToDue > 7) continue;
    const late = due.daysToDue < 0;
    const days = Math.abs(due.daysToDue);
    const owed = p.debt.kind === "payable";
    const worked = due.basis === "last-payment" || due.basis === "borrowed" ? `, ${basisWords(due.basis)}` : "";
    out.push({
      id: `debt-${p.debt.id}`,
      level: late ? "over" : "warn",
      area: "debt",
      title: late
        ? `${p.debt.name} ${owed ? "payment" : "repayment to you"} is ${days} day${days === 1 ? "" : "s"} late`
        : days === 0
          ? `${p.debt.name} is due today`
          : `${p.debt.name} is due in ${days} day${days === 1 ? "" : "s"}`,
      detail: `Due ${formatMedium(due.nextDue)}${worked}. ${money(due.amountDue)} ${owed ? "to pay" : "to collect"}${
        due.amountDue < p.outstanding ? `, of ${money(p.outstanding)} outstanding` : ""
      }.`,
      weight: late ? 95 : 65,
    });
  }

  /**
   * Payments to a debt filed as spending, in the last three months.
   *
   * The money left the wallet and counted as spending, and what is owed
   * never came down, so the debt reads higher than it is and the month's
   * spending higher than it was. See `paymentsFiledAsSpending`.
   */
  const misfiled = new Map<string, { name: string; rows: Transaction[] }>();
  for (const { debt, row } of paymentsFiledAsSpending(live, transactions)) {
    if (row.date > asOf || daysBetween(row.date, asOf) > 90) continue;
    const entry = misfiled.get(debt.id) ?? { name: debt.name, rows: [] };
    entry.rows.push(row);
    misfiled.set(debt.id, entry);
  }
  for (const [id, { name, rows }] of misfiled) {
    out.push({
      id: `misfiled-${id}`,
      level: "warn",
      area: "debt",
      title: `${rows.length} payment${rows.length === 1 ? "" : "s"} to ${name} filed as spending`,
      detail: `${money(rows.reduce((s, r) => s + r.total, 0))} went to ${name} as spending, so what is owed has not come down by it. Open ${rows.length === 1 ? "it" : "them"} and change the type to Debt.`,
      weight: 58,
      query: name,
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

  /**
   * Borrowing saved as income: the mistake that put PHP 5,450.00 of Maya
   * Credit into the income line for eight months. Amounts under PHP 50.00 are
   * left out, because the migration deliberately kept record #411's PHP 0.85
   * reward as revenue under the same name.
   */
  const asIncome = new Map<string, { name: string; rows: Transaction[] }>();
  const owedLines = live.filter((d) => d.kind === "payable");
  for (const row of transactions) {
    if (row.type !== "Revenue" || row.total < BORROWING_FLOOR) continue;
    if (row.date > asOf || daysBetween(row.date, asOf) > 90) continue;
    const debt = debtNamedBy(owedLines, row.item);
    if (!debt) continue;
    const entry = asIncome.get(debt.id) ?? { name: debt.name, rows: [] };
    entry.rows.push(row);
    asIncome.set(debt.id, entry);
  }
  for (const [id, { name, rows }] of asIncome) {
    out.push({
      id: `borrowed-income-${id}`,
      level: "warn",
      area: "debt",
      title: `${rows.length} ${name} ${rows.length === 1 ? "row" : "rows"} saved as income`,
      detail: `${money(rows.reduce((s, r) => s + r.total, 0))} from ${name} counts as income, but borrowed money is not income: it overstates what came in, and what you owe never went up by it. Open ${rows.length === 1 ? "it" : "them"} and change the type to Debt, with Draw.`,
      weight: 60,
      query: name,
    });
  }

  // ── An account below zero ────────────────────────────────────────────────
  /**
   * More has left it than was ever put in, which money cannot do. A row is
   * missing, or was filed against the wrong account. On 2026-09-15 a reserve
   * read −PHP 2,400.00 and nothing said so. A spending wallet is left to the
   * low balance warning when that is switched on, so it is not said twice.
   */
  for (const account of accounts) {
    if (account.archived) continue;
    if (account.kind === "spending" && lowBalanceThreshold > 0) continue;
    const balance = walletBalance(transactions, account.name);
    if (balance >= 0) continue;
    out.push({
      id: `negative-${account.id}`,
      level: "over",
      area: "review",
      title: `${account.name} is below zero`,
      detail: `−${money(balance)}. More has left it than was ever put in, so a row is missing or filed against the wrong account.`,
      weight: 92,
      query: account.name,
    });
  }

  // ── Extra zeros ──────────────────────────────────────────────────────────
  for (const found of unusualRows(transactions, asOf)) {
    const number = `#${String(found.row.recordNumber).padStart(4, "0")}`;
    out.push({
      id: `unusual-${found.row.id}`,
      level: "warn",
      area: "review",
      title: `${money(found.row.total)} is far more than usual`,
      detail: `Record ${number}, ${found.row.type === "Revenue" ? "income" : found.row.type.toLowerCase()} on ${formatMedium(found.row.date)}, is ${found.times} times the largest before it (${money(found.largest)}). If a zero slipped in, it is moving every total.`,
      weight: 80,
      query: number,
    });
  }

  // ── The same bill twice in a month ───────────────────────────────────────
  /**
   * Same item, same amount, same month: usually one payment entered twice.
   * Different amounts are left alone, since prepaid loads and top-ups
   * really do come round more than once.
   */
  const repeats = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.type !== "Spending" || (t.category !== "Bills" && t.category !== "Subscriptions")) continue;
    if (!t.item.trim() || getYear(t.date) !== year || getMonth(t.date) !== month) continue;
    const key = `${t.item.trim().toLowerCase()}|${t.total}`;
    repeats.set(key, [...(repeats.get(key) ?? []), t]);
  }
  for (const rows of repeats.values()) {
    const first = rows[0];
    if (rows.length < 2 || !first) continue;
    out.push({
      id: `twice-${first.id}`,
      level: "warn",
      area: "bills",
      title: `${first.item.trim()} paid ${rows.length === 2 ? "twice" : `${rows.length} times`} in ${monthName(month)}`,
      detail: `${money(first.total)} on ${rows.map((r) => formatMedium(r.date)).join(" and ")}. If one is the same payment entered again, move it to the bin.`,
      weight: 52,
      query: first.item.trim(),
    });
  }

  // ── The same entry saved more than once on one day ───────────────────────
  /**
   * On 2026-09-15 the Maya Credit history showed three PHP 2,000.00 draws on
   * September 5, and nothing anywhere asked about them. Same day, same kind,
   * same amount, same thing: most often one entry saved again. Everyday
   * spending under PHP 500.00 is left out, since two PHP 150.00 meals on one
   * day are ordinary, and bills are the month check's above. Reported, never
   * removed.
   */
  const sameDay = new Map<string, Transaction[]>();
  const since = addDays(asOf, -60);
  for (const t of transactions) {
    if (t.date > asOf || t.date <= since || t.category === "Opening") continue;
    if (t.type === "Spending" && (t.category === "Bills" || t.category === "Subscriptions")) continue;
    if (t.type === "Spending" && t.total < REPEAT_FLOOR) continue;
    const key = [t.date, t.type, t.total, t.item.trim().toLowerCase(), t.debtId ?? "", t.debtEffect ?? ""].join("|");
    sameDay.set(key, [...(sameDay.get(key) ?? []), t]);
  }
  for (const rows of sameDay.values()) {
    const first = rows[0];
    if (rows.length < 2 || !first) continue;
    const what = first.item.trim() || debts.find((d) => d.id === first.debtId)?.name || first.type;
    const numbers = rows.map((r) => `#${String(r.recordNumber).padStart(4, "0")}`);
    out.push({
      id: `repeat-${first.id}`,
      level: "warn",
      area: "review",
      title: `${what}, ${money(first.total)}, saved ${rows.length === 2 ? "twice" : `${rows.length} times`} on ${formatMedium(first.date)}`,
      detail: `Records ${numbers.join(", ")} are the same kind, amount and item on the same day. If one was saved again by mistake, move it to the bin. If each is real, leave them.`,
      weight: 62,
      query: numbers[0],
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

/** PHP 500.00: under this, the same spending twice in a day is an ordinary day. */
const REPEAT_FLOOR: Centavos = 50_000;
/** PHP 50.00: under this, income under a debt's name is a reward, not borrowing. */
const BORROWING_FLOOR: Centavos = 5_000;

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
