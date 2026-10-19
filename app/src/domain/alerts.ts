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

import { allWalletBalances, walletBalance, walletDelta } from "./balances";
import { assessMonthFor } from "./budget";
import { overdue, STOPPED_AFTER_DAYS, upcoming, type BillStatus } from "./bills";
import { basisWords, billWords, debtDue, debtNamedBy, paymentsFiledAsSpending, positionsOf, type Debt } from "./debt";
import { creditRoom, roomWords } from "./creditLimit";
import { addDays, daysBetween, daysLeftInMonth, firstOfMonth, formatMedium, getMonth, getYear, lastOfMonth, monthName } from "./dates";
import { categoryLimits } from "./budgetView";
import { limitKindOf, spendingTrackByKind } from "./kinds";
import { borrowedMoney, lenderNames } from "./borrowed";
import { isNeedRow } from "./spendNote";
import { unusualRows } from "./unusual";
import { wholeRows } from "./covers";
import { incomeSinceSet } from "./incomeBudget";
import { actionableIssues, checkIntegrity } from "./integrity";
import { monthTotals } from "./totals";
import { overdueGoals } from "./goalClose";
import { patternFindings, type Finding } from "./patterns";
import type { Account } from "./accounts";
import type { Centavos } from "./money";
import type { Budgets, IsoDate, SpendingType, Transaction } from "./types";

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
  | "review"
  /** Accounts and lists, fixed in Settings. */
  | "settings";

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
  /** The kinds of spending, with the owner's needs and wants marked. */
  readonly spendingTypes?: readonly Pick<SpendingType, "name" | "necessity">[] | undefined;
  /** This month's safe to spend and what is left of the spending budget (`monthBrief`), for the budget against the money. */
  readonly safe?: { readonly safe: Centavos; readonly budgetLeft: Centavos | null; readonly wallets: Centavos } | null | undefined;
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
  /*
   * So far means up to today, and a day's figure is rounded down as every
   * other one is: an entry dated later in the month counted here, and the
   * rate rounded up, so the prompt carried PHP 1,759.51 beside Insights'
   * PHP 1,759.50 (6 October 2026 audit).
   */
  const sofar = transactions.filter((t) => t.date <= asOf);
  return Math.floor(monthTotals(sofar, year, month).total / dayOfMonth);
}

/** Days left in the month, including today. The one count, from `dates.ts`. */
export const daysLeft = daysLeftInMonth;

/**
 * Before this many days a month's average a day is a handful of entries,
 * and one repair or trip decides it. The pace alert waits, and the model is
 * told the average is too early to read (6 October 2026: "No, that budget
 * will not work at your current pace" on the fifth, after a PHP 1,534.00
 * repair).
 */
export const PACE_FROM_DAY = 7;

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
  const r = assessment.combined.remaining;
  // Rounded down, never a centavo more than is left, as the screens do; over, rounded towards zero.
  return r < 0 ? Math.ceil(r / left) : Math.floor(r / left);
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
  /*
   * The ledger as saved, for every check about entries themselves: one record
   * number, one entry; a date typed wrong; the same bill twice. The rows given
   * here may be spread over the days a date range covers, and three days of
   * one trip are not three entries (owner's backup, 12 October 2026: the bell
   * called #3933 a duplicate saved by two devices and offered to bin it).
   */
  const ledger = wholeRows(transactions);

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
      /*
       * The spending budget against spending, when the month has one. On 3
       * October 2026 this said "₱4,964.95 left over 29 days is ₱171.21 a
       * day" beside the Dashboard's "₱3,264.95 left of the spending budget,
       * ₱112.58 a day": the first counted the ₱1,700.00 for bills, which is
       * not money to spend on anything else. Without a spending budget it is
       * the whole budget, as before.
       */
      const ownTrack = assessment.spending.budget > 0;
      const remaining = ownTrack ? assessment.spending.remaining : assessment.combined.remaining;
      /*
       * The spending budget can be over while the whole budget is not, when
       * bills came in under theirs. The bell said "PHP 416.05 left" beside the
       * Dashboard's "PHP 416.05 over" (12 October 2026 audit).
       */
      if (ownTrack && remaining < 0) {
        out.push({
          id: "spending-over",
          level: "over",
          area: "budget",
          title: "Spending is over its budget",
          detail: `${money(assessment.spending.spent)} spent of the ${money(assessment.spending.budget)} spending budget, over by ${money(-remaining)}, with ${left} day${left === 1 ? "" : "s"} left. Bills and subscriptions still have room, which is why the whole budget is not over.`,
          weight: 90 + fraction(-remaining, assessment.spending.budget),
        });
      }
      const perDay = ownTrack ? (left > 0 ? Math.floor(Math.max(0, remaining) / left) : 0) : dailyAllowance(transactions, budgets, asOf);
      const dayOfMonth = Number(asOf.slice(8, 10));
      const rate = ownTrack ? (dayOfMonth > 0 ? Math.floor(assessment.spending.spent / dayOfMonth) : 0) : burnRate(transactions, asOf);
      // Only worth saying when the current pace would actually break it, and once there is a pace to read.
      if (remaining >= 0 && perDay !== null && rate > perDay && left > 0 && dayOfMonth >= PACE_FROM_DAY) {
        out.push({
          id: "budget-pace",
          level: "warn",
          area: "budget",
          title: "Spending faster than the budget allows",
          detail: `${money(rate)} a day so far. ${money(remaining)} ${ownTrack ? "of the spending budget " : ""}left over ${left} day${left === 1 ? "" : "s"} is ${money(perDay)} a day.`,
          weight: 70,
        });
      }
    }
  }

  // ── The budget against the money ─────────────────────────────────────────
  {
    const sf = input.safe;
    if (sf && sf.wallets >= 0 && sf.budgetLeft !== null && sf.budgetLeft > 0 && sf.budgetLeft > Math.max(0, sf.safe)) {
      const beyond = sf.budgetLeft - Math.max(0, sf.safe);
      out.push({
        id: "budget-beyond-money",
        level: "warn",
        area: "budget",
        title: `The spending budget promises ${money(beyond)} more than your money`,
        detail: `${money(sf.budgetLeft)} is left of it, but only ${money(Math.max(0, sf.safe))} is safe to spend. Lower it on the Budget screen, under Budget and your money.`,
        weight: 72,
      });
    }
  }

  // ── Money that came in after the budget was set ─────────────────────────
  /*
   * "Nov 1 budget is 5000, then I earn 10k, then I can adjust" (owner, 12
   * October 2026). Said once it has come in, so the budget can follow it:
   * the Budget screen splits it into spending, bills or savings, checked
   * against the money (`incomeBudget.ts`). Never changed without the owner.
   */
  {
    const since = incomeSinceSet(transactions, budgets[String(year)], year, month);
    if (since.setOn && since.amount >= 10000) {
      out.push({
        id: `income-since-budget-${year}-${month}-${since.amount}`,
        level: "info",
        area: "budget",
        title: `${money(since.amount)} came in since you set the ${monthName(month)} budget`,
        detail: `On the Budget screen, Budget and your money puts it into spending, bills or savings, and checks that the budget never promises more than your money. Or say "add the money that came in to my budget" in the chat.`,
        weight: 36,
      });
    }
  }

  // ── A kind of spending past or near its limit ───────────────────────────
  /*
   * Nothing outside the Budget screen ever said a kind was past its limit:
   * not the bell, not the Dashboard, not the AI, which reads these. Food at
   * PHP 4,691.00 of a PHP 3,000.00 limit went unmentioned everywhere (7
   * October 2026 limits audit). Same figures as the Budget screen
   * (`kinds.ts`, `spendingTrackByKind`). A need is said as calmly as a want.
   */
  {
    const limits = categoryLimits(budgets[String(year)], month);
    if (limits.size > 0) {
      const spent = spendingTrackByKind(transactions, { start: firstOfMonth(year, month), end: lastOfMonth(year, month) }, debts);
      for (const [kind, limit] of limits) {
        const used = spent.get(kind) ?? 0;
        if (used > limit) {
          out.push({
            id: `limit-over-${kind.toLowerCase()}`,
            level: "warn",
            area: "budget",
            title: `${kind} is past its limit`,
            detail: `${money(used)} of the ${money(limit)} limit for ${monthName(month)}: ${money(used - limit)} over${left > 0 ? `, with ${left} day${left === 1 ? "" : "s"} left` : ""}.`,
            weight: 68,
            query: kind,
          });
        } else if (used * 10 >= limit * 9 && left > 0) {
          const room = limit - used;
          out.push({
            id: `limit-near-${kind.toLowerCase()}`,
            level: "info",
            area: "budget",
            title: `${kind} is near its limit`,
            detail: `${money(used)} of the ${money(limit)} limit: ${money(room)} left for ${left} day${left === 1 ? "" : "s"}, ${money(Math.floor(room / left))} a day.`,
            weight: 42,
            query: kind,
          });
        }
      }
    }
  }

  // ── Borrowed money, and money held for someone ───────────────────────────
  /*
   * The owner, 7 October 2026: "knows how much money I have that is not
   * from loan or credit, then it warns me, like you're using that money from
   * credit and you spend it to treat". Followed through every transfer and
   * withdrawal (`borrowed.ts`): what is borrowed in the accounts now, and
   * what of this month's spending it paid for, wants named first.
   */
  if (debts.length > 0) {
    /*
     * The accounts the Dashboard counts (open ones, goals and reserves
     * included) and every row, as the balances count them, so the bell and
     * the Dashboard give one figure (7 October 2026 engine review).
     */
    const names = accounts.filter((a) => !a.archived).map((a) => a.name);
    const b = borrowedMoney(transactions, debts, names);
    const start = firstOfMonth(year, month);
    const used = new Map<string, Centavos>();
    let wantTotal = 0;
    let needTotal = 0;
    // The accounts the wants were paid from: own money can run out in one and not another.
    const paidFrom = new Set<string>();
    const lenders = new Map<string, Centavos>();
    for (const t of transactions) {
      if (t.date < start || t.date > asOf) continue;
      const use = b.spent.get(t.id);
      if (!use) continue;
      const kind = limitKindOf(t) ?? (t.item.trim() || "Other");
      if (isNeedRow(t, limitKindOf(t), input.spendingTypes)) needTotal += use.amount;
      else {
        wantTotal += use.amount;
        used.set(kind, (used.get(kind) ?? 0) + use.amount);
        if (t.fromWallet.trim()) paidFrom.add(t.fromWallet.trim());
      }
      for (const [id, v] of use.from) lenders.set(id, (lenders.get(id) ?? 0) + v);
    }
    /*
     * Money held for someone spent on a want is theirs spent on the owner's
     * want: the save note said so, the bell did not (12 October 2026 audit, B5).
     */
    let heldWants = 0;
    const heldFor = new Map<string, Centavos>();
    const heldKinds = new Map<string, Centavos>();
    for (const t of transactions) {
      if (t.date < start || t.date > asOf) continue;
      const use = b.spentHeld.get(t.id);
      if (!use || isNeedRow(t, limitKindOf(t), input.spendingTypes)) continue;
      heldWants += use.amount;
      const kind = limitKindOf(t) ?? (t.item.trim() || "Other");
      heldKinds.set(kind, (heldKinds.get(kind) ?? 0) + use.amount);
      for (const [id, v] of use.from) heldFor.set(id, (heldFor.get(id) ?? 0) + v);
    }
    if (heldWants > 0) {
      const people = [...heldFor.keys()].map((id) => debts.find((d) => d.id === id)).map((d) => d?.counterparty.trim() || d?.name || "someone");
      out.push({
        id: `held-wants-${year}-${month}`,
        level: "warn",
        area: "debt",
        title: `${money(heldWants)} held for ${[...new Set(people)].join(" and ")} went to wants this month`,
        detail: `${[...heldKinds].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${money(v)}`).join(", ")}. That money is theirs; your own had run out when it was spent.`,
        weight: 67,
      });
    }
    if (wantTotal > 0) {
      const list = [...used].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${money(v)}`);
      out.push({
        id: `borrowed-wants-${year}-${month}`,
        level: "warn",
        area: "debt",
        title: `${money(wantTotal)} of borrowed money went to wants this month`,
        detail: `${list.join(", ")}, from ${lenderNames(lenders, debts)}: your own money in ${[...paidFrom].join(" and ") || "those accounts"} had run out.${needTotal > 0 ? ` ${money(needTotal)} more went to needs.` : ""}${b.inHand > 0 ? ` ${money(b.inHand)} borrowed is still in your accounts.` : ""}`,
        weight: 66,
      });
    } else if (needTotal > 0) {
      out.push({
        id: `borrowed-needs-${year}-${month}`,
        level: "info",
        area: "debt",
        title: `${money(needTotal)} of borrowed money paid for needs this month`,
        detail: `From ${lenderNames(lenders, debts)}, once your own money had run out.`,
        weight: 34,
      });
    }
    if (b.inHand > 0) {
      const whose = new Map([...b.byLender].filter(([id]) => debts.find((d) => d.id === id)?.form !== "pass-through"));
      out.push({
        id: "borrowed-in-hand",
        level: "info",
        area: "debt",
        title: `${money(b.inHand)} of your money is borrowed`,
        detail: `From ${lenderNames(whose, debts)}, in ${[...b.byAccount].map(([a, v]) => `${a} ${money(v)}`).join(", ")}. Your own money is ${money(b.own)}; spending past it spends what you borrowed.`,
        weight: 32,
      });
    }
    if (b.heldForOthers > 0) {
      const whose = new Map([...b.byLender].filter(([id]) => debts.find((d) => d.id === id)?.form === "pass-through"));
      out.push({
        id: "held-in-hand",
        level: "info",
        area: "debt",
        // Named by the person, as the save note names them, not by the line ("Tita Joan", not "Tita Joan's money").
        title: `${money(b.heldForOthers)} in your accounts is held for ${[...new Set([...whose.keys()].map((id) => debts.find((d) => d.id === id)).map((d) => d?.counterparty.trim() || d?.name || "someone"))].join(" and ") || lenderNames(whose, debts)}`,
        detail: `It is not yours to spend. Your own money is ${money(b.own)}.`,
        weight: 33,
      });
    }
  }

  // ── Wallets running low ──────────────────────────────────────────────────
  /*
   * By how the wallet is used, not by its balance alone. "Gcash is empty"
   * led the bell every time, though the owner keeps Gcash empty on purpose
   * as a backup (13 October 2026): "remind me once in a while, not every
   * single time". Now:
   *   below zero        always, red: something saved from it is missing
   *                     what came in first, or an amount is off;
   *   just ran low      once, for three days from the day it went under;
   *   low and in use    while money still leaves it (in the last 7 days);
   *   resting           nothing at all: low or empty, and nothing has left
   *                     it since it went under.
   */
  if (lowBalanceThreshold > 0) {
    const DAY = 86_400_000;
    const ago = (iso: IsoDate): number => Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / DAY);
    for (const account of accounts) {
      if (account.archived || account.kind !== "spending") continue;
      const balance = walletBalance(transactions, account.name);
      if (balance >= lowBalanceThreshold) continue;

      // Walk its rows in order: the day it last went under the warning, and the last day money left it.
      const isIt = (w: string): boolean => w === account.name;
      const rows = transactions
        .filter((t) => t.date <= asOf && (t.fromWallet === account.name || t.toWallet === account.name))
        .sort((x, y) => x.date.localeCompare(y.date) || x.recordNumber - y.recordNumber);
      let running = 0;
      let wentUnder: IsoDate | null = null;
      let lastOut: IsoDate | null = null;
      for (const t of rows) {
        const before = running;
        const delta = walletDelta(t, isIt);
        running += delta;
        if (before >= lowBalanceThreshold && running < lowBalanceThreshold) wentUnder = t.date;
        if (delta < 0) lastOut = t.date;
      }
      const usedSince = lastOut !== null && wentUnder !== null && lastOut >= wentUnder && ago(lastOut) <= 7;
      const justNow = wentUnder !== null && ago(wentUnder) <= 3;

      if (balance < 0) {
        out.push({
          id: `low-${account.id}`,
          level: "over",
          area: "wallet",
          title: `${account.name} is below zero`,
          detail: `−${money(-balance)}. A wallet cannot hold less than nothing: something saved from it is missing the money that came in first, or an amount is off.`,
          weight: 90,
          query: account.name,
        });
        continue;
      }
      if (!usedSince && !justNow) continue;
      out.push({
        id: `low-${account.id}`,
        level: usedSince ? "warn" : "info",
        area: "wallet",
        title: balance === 0 ? `${account.name} is empty` : `${account.name} is running low`,
        detail: usedSince
          ? `${money(balance)} left, under the ${money(lowBalanceThreshold)} you want kept, and money still left it on ${formatMedium(lastOut!)}. Top it up before the next payment from it.`
          : `${money(balance)} left since ${formatMedium(wentUnder!)}. If you keep it low on purpose, this goes quiet by itself.`,
        weight: usedSince ? 55 : 25,
        query: account.name,
      });
    }
  }

  // ── Bills ────────────────────────────────────────────────────────────────
  /*
   * Past due, told apart from long gone. Netflix, last paid in January 2025,
   * was "past due" in September 2026 beside a Google Drive payment a month
   * late: one needs paying and the other was cancelled long ago. A bill
   * unpaid for three months is asked about rather than called late.
   */
  const lapsed = (b: BillStatus): boolean => b.lastPaid !== undefined && daysBetween(b.lastPaid, asOf) > STOPPED_AFTER_DAYS;
  const late = overdue(bills).filter((b) => !lapsed(b));
  if (late.length > 0) {
    out.push({
      id: "bills-overdue",
      level: "over",
      area: "bills",
      title: `${late.length} bill${late.length === 1 ? "" : "s"} past due`,
      detail: `${late.map((b) => b.item).join(", ")}. Predicted due before today and not yet paid. Stopped paying one? Press Stop beside it in Settings, under Categories, and it is no longer expected.`,
      weight: 85,
    });
  }
  const gone = overdue(bills).filter(lapsed);
  if (gone.length > 0) {
    out.push({
      id: "bills-lapsed",
      level: "warn",
      area: "bills",
      title: `${gone.length === 1 ? `${gone[0]!.item} looks` : `${gone.length} bills look`} stopped`,
      detail: `${gone.map((b) => `${b.item}, last paid ${formatMedium(b.lastPaid!)}`).join("; ")}. If you no longer pay ${gone.length === 1 ? "it" : "them"}, press Stop in Settings, under Categories, and ${gone.length === 1 ? "it is" : "they are"} no longer expected.`,
      weight: 50,
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
    /*
     * The bell is for now: money that left quickly a month ago led "What
     * needs attention?" on 13 October 2026, above what was due that week.
     * Insights keeps the history.
     */
    const on = /^velocity-(\d{4}-\d{2}-\d{2})$/.exec(finding.id)?.[1];
    if (on && daysBetween(on, asOf) > 14) continue;
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
      detail: `Due ${formatMedium(due.nextDue)}${worked}${billWords(due)}. ${money(due.amountDue)} ${owed ? "to pay" : "to collect"}${
        due.amountDue < p.outstanding ? `, of ${money(p.outstanding)} outstanding` : ""
      }.`,
      weight: late ? 95 : 65,
    });
  }

  /**
   * A bill about to close, on a line with a billing day and a separate day
   * the payment is due: what is owed now goes on it, and anything borrowed
   * after it waits for the next one. Only a nudge; nothing is late yet.
   * Without a separate payment day, closing is the due date, and the alert
   * above already says so.
   */
  for (const p of positionsOf(live, transactions, asOf)) {
    if (p.debt.kind !== "payable" || p.outstanding <= 0 || !p.debt.dueDay) continue;
    const due = debtDue(p, transactions, asOf);
    if (!due.bill) continue;
    const days = daysBetween(asOf, due.bill.next);
    if (days < 0 || days > 3) continue;
    const onIt = p.outstanding - due.bill.billed;
    if (onIt <= 0) continue;
    out.push({
      id: `bill-${p.debt.id}-${due.bill.next}`,
      level: "info",
      area: "debt",
      title:
        days === 0
          ? `${p.debt.name}'s bill closes today`
          : `${p.debt.name}'s bill closes in ${days} day${days === 1 ? "" : "s"}`,
      detail: `${money(onIt)} borrowed since the last bill goes on the bill of ${formatMedium(due.bill.next)}. Anything borrowed after it goes on the next one.`,
      weight: 30,
    });
  }

  /**
   * A credit line at or near its limit, with the payment that frees it.
   *
   * The owner, 27 September 2026: the assistant and the notifications should
   * say "you reach your credit limit and the deadline is nearing". Only lines
   * whose lender sets a limit (`creditLimit.ts`); the due date comes from the
   * same `debtDue` the card uses, so the two never disagree.
   */
  for (const p of positionsOf(live, transactions, asOf)) {
    const room = creditRoom(p.debt, transactions, asOf);
    if (!room || room.state === "ok") continue;
    const due = debtDue(p, transactions, asOf);
    const when =
      due.nextDue && due.daysToDue !== undefined && p.outstanding > 0
        ? ` ${money(due.amountDue || p.outstanding)} is due ${formatMedium(due.nextDue)}, ${
            due.daysToDue < 0
              ? `${Math.abs(due.daysToDue)} day${due.daysToDue === -1 ? "" : "s"} late`
              : due.daysToDue === 0
                ? "today"
                : `in ${due.daysToDue} day${due.daysToDue === 1 ? "" : "s"}`
          }.`
        : "";
    const soon = due.daysToDue !== undefined && due.daysToDue <= 7;
    out.push({
      id: `limit-${p.debt.id}`,
      level: room.state === "over" ? "over" : room.state === "reached" || soon ? "warn" : "info",
      area: "debt",
      title:
        room.state === "over"
          ? `${p.debt.name} is past its limit${soon ? " and a payment is due" : ""}`
          : room.state === "reached"
            ? `${p.debt.name} has reached its limit${soon ? " and a payment is due" : ""}`
            : `${p.debt.name} is close to its limit`,
      detail: `${roomWords(room)}.${when}`,
      weight: room.state === "over" ? 90 : room.state === "reached" ? (soon ? 85 : 70) : 45,
    });
  }

  /**
   * A line that came back more than it went out: collected more than was
   * lent, or paid more than was borrowed. Every total counts it as nothing
   * owed, so it showed as -PHP 1.00 in two places and PHP 0.00 in two
   * others, and nothing said why (6 October 2026 audit, Father's line).
   * Reported, never put right: the row that is off is the owner's to find.
   */
  for (const p of positionsOf(debts, transactions, asOf)) {
    if (p.outstanding >= 0) continue;
    const back = p.debt.kind === "receivable" ? "collected than was lent" : "paid than was owed";
    /*
     * Money paid or held for someone, past zero (PHP 600.00 back on a PHP
     * 599.00 bill): said as the extra, with the one step that clears it,
     * which moves no money (settleLine.ts). A loan keeps its own words.
     */
    const who = p.debt.counterparty.trim() || p.debt.name;
    const behalf = p.debt.form === "pass-through";
    out.push({
      id: `debt-below-zero-${p.debt.id}`,
      level: "info",
      area: "debt",
      title: behalf
        ? p.debt.kind === "receivable"
          ? `${who} gave you ${money(-p.outstanding)} extra`
          : `You gave ${who} ${money(-p.outstanding)} extra`
        : `${p.debt.name} is ${money(-p.outstanding)} below nothing`,
      detail: behalf
        ? `It is already ${p.debt.kind === "receivable" ? "in" : "out of"} your wallet. If that is right, press "Clear the ${money(-p.outstanding)} extra" beside ${who} on Home, or say "clear ${who}" in the chat: it moves no money. If an amount is off, edit that entry instead.`
        : `${money(-p.outstanding)} more was ${back}, so every total counts this line as settled. Open its rows: an amount may be off, or a row may belong to another line.`,
      weight: 35,
      query: p.debt.name,
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

  // ── Two accounts under one name ──────────────────────────────────────────
  /**
   * Settings listed "Cash" twice on 2026-09-15. Balances are kept by name, so
   * two accounts with one name share one balance and every list shows it
   * twice; two that differ only in spelling or capitals split one account's
   * rows between them, so neither balance is the whole account.
   */
  const byName = new Map<string, Account[]>();
  for (const account of accounts) {
    if (account.archived) continue;
    const key = account.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), account]);
  }
  for (const same of byName.values()) {
    const first = same[0];
    if (same.length < 2 || !first) continue;
    const exact = same.every((a) => a.name.trim() === first.name.trim());
    out.push({
      id: `same-name-${first.id}`,
      level: "warn",
      area: "settings",
      title: exact
        ? `${same.length} accounts are called ${first.name.trim()}`
        : `${same.map((a) => `"${a.name.trim()}"`).join(" and ")} look like one account`,
      detail: exact
        ? `Balances are kept by name, so they share one balance of ${money(walletBalance(transactions, first.name))} and lists show it twice. Deactivate the extra one in Settings.`
        : "Rows are split between them by spelling, so neither balance is the whole account. Rename one to match the other in Settings and its rows move with it.",
      weight: 57,
    });
  }

  // ── Money under a name that is not an account ────────────────────────────
  /**
   * A row that names a wallet no active account has puts its money in no
   * balance, total or net worth: a typo in a wallet name, or an account
   * deactivated while it still held money.
   */
  if (accounts.length > 0) {
    const active = new Set(accounts.filter((a) => !a.archived).map((a) => a.name.trim()));
    for (const [name, balance] of allWalletBalances(transactions)) {
      if (balance === 0 || active.has(name.trim())) continue;
      const sign = balance < 0 ? "−" : "";
      const deactivated = accounts.some((a) => a.archived && a.name.trim() === name.trim());
      out.push({
        id: `stray-${name}`,
        level: "warn",
        area: deactivated ? "settings" : "review",
        title: deactivated
          ? `${name} is deactivated but holds ${sign}${money(balance)}`
          : `${sign}${money(balance)} sits under "${name}", which is not one of your accounts`,
        detail: deactivated
          ? "While it is deactivated that money is left out of your wallets and net worth. Move it to an active account, or reactivate it in Settings."
          : "A row names a wallet no account has, so this money is in no balance and no total. Open the rows and pick the right account.",
        weight: 70,
        ...(deactivated ? {} : { query: name }),
      });
    }
  }

  // ── Dated far ahead ──────────────────────────────────────────────────────
  /**
   * An entry dated more than a month after today: usually a year typed wrong.
   * It sits in a month that has not happened, so every figure for now leaves
   * it out, and nothing on the screens for now shows it.
   */
  const farAhead = ledger
    .filter((t) => daysBetween(asOf, t.date) > 31)
    .sort((a, b) => b.date.localeCompare(a.date));
  const furthest = farAhead[0];
  if (furthest) {
    const number = `#${String(furthest.recordNumber).padStart(4, "0")}`;
    out.push({
      id: "far-ahead",
      level: "warn",
      area: "review",
      title: `${farAhead.length} ${farAhead.length === 1 ? "entry is" : "entries are"} dated more than a month ahead`,
      detail: `The furthest is ${formatMedium(furthest.date)}, record ${number}. A year typed wrong files money into a month that has not happened, and every figure for now leaves it out.`,
      weight: 64,
      query: number,
    });
  }

  // ── Extra zeros ──────────────────────────────────────────────────────────
  for (const found of unusualRows(ledger, asOf)) {
    /*
     * Money held or paid for someone else is theirs, not a figure of the
     * owner's own to measure against: an aunt's PHP 25,000.00 for a funeral
     * read as ten times the owner's largest borrowing (27 September 2026).
     */
    if (found.row.debtId && debts.find((d) => d.id === found.row.debtId)?.form === "pass-through") continue;
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
  for (const t of ledger) {
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
    // Small income repeats too: centavo interest and cashback credits arrive in identical amounts (backup of 7 October 2026).
    if ((t.type === "Spending" || t.type === "Revenue") && t.total < REPEAT_FLOOR) continue;
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

  // ── Two entries with one record number ───────────────────────────────────
  /**
   * The phone and the laptop each give a new entry the next number after the
   * highest they have seen. Saved on both in the moment before either hears
   * of the other, or while one is offline, two entries take the same number,
   * and "#0519" stops naming one entry. Reported with both, never renumbered:
   * which one keeps the number is the owner's call. A split repayment's
   * interest row shares its payment's number by design and is left out.
   */
  const byNumber = new Map<number, Transaction[]>();
  for (const t of ledger) {
    /*
     * A movement's part shares its number by design: a payment's interest,
     * and a borrowing's fees. The fees were left in, and every Maya Credit
     * borrowing with fees read as two devices saving at once (27 September
     * 2026, records #3821 and #3822).
     */
    if (t.partOf || t.id.endsWith("-interest") || t.id.endsWith("-charge")) continue;
    byNumber.set(t.recordNumber, [...(byNumber.get(t.recordNumber) ?? []), t]);
  }
  for (const [number, rows] of byNumber) {
    if (rows.length < 2) continue;
    const label = `#${String(number).padStart(4, "0")}`;
    out.push({
      id: `shared-number-${number}`,
      level: "warn",
      area: "review",
      title: `${rows.length} entries share record ${label}`,
      detail: `${rows
        .map((r) => `${formatMedium(r.date)}, ${r.item.trim() || r.type}, ${money(r.total)}`)
        .join("; ")}. Usually two devices saved at the same moment. If one is the same entry saved again, move it to the bin; if both are real, they can keep the number.`,
      weight: 60,
      query: label,
    });
  }

  // ── Rows the ledger cannot make sense of ─────────────────────────────────
  const issues = actionableIssues(checkIntegrity(ledger, { wallets: accounts.filter((a) => !a.archived).map((a) => a.name), asOf }));
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
export function worstLevel(alerts: readonly Pick<Alert, "level">[]): AlertLevel | null {
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
