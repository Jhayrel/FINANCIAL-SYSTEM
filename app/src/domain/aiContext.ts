/**
 * What the AI is allowed to see.
 *
 * ── The boundary ──────────────────────────────────────────────────────────
 *
 * This module is the entire surface between the ledger and any model. Nothing
 * else in the app talks to a provider, so whatever this function returns is
 * exactly, and only, what can leave the device. Reading this file tells you
 * what a provider receives, with no need to trust a prompt written elsewhere.
 *
 * Three rules it enforces:
 *
 *   1. FIGURES, NOT ROWS. The model gets totals, balances, rankings and
 *      counts. It does not get 441 raw transactions. A summary is enough to
 *      write a sentence about, and it is a fraction of the exposure.
 *
 *   2. NO FREE TEXT BY DEFAULT. Descriptions and notes are where a person
 *      writes "paid Tita back for the hospital bill". That is the most
 *      sensitive text in the ledger and the least useful to a model summing
 *      numbers, so it is excluded unless explicitly asked for.
 *
 *   3. NOTHING FROM OUTSIDE. No URLs, no fetched content, no user-supplied
 *      instructions. The model is given computed facts and a fixed question.
 *      There is nothing here for injected text to ride in on, because none of
 *      this comes from anywhere but the owner's own arithmetic.
 *
 * ── Why it is a snapshot rather than a query interface ────────────────────
 *
 * The obvious design is to let the model ask for what it wants. That is also
 * the design where a model can ask for everything, and where a bug in the
 * question turns into an unbounded read. A fixed snapshot cannot do that: the
 * size and shape are known before the call, and they do not depend on what the
 * model decides to say.
 */

import { ownerLines, type OwnerDetails } from "./owner";
import { byWhen, viewOf } from "./planner";
import { totalSavingsBalance, totalWalletBalance, walletBalance } from "./balances";
import { assessMonthFor } from "./budget";
import { billStatuses, overdue, STOPPED_AFTER_DAYS, upcoming } from "./bills";
import { debtDue, incomeQuality, netWorth, positionsOf, unpaidCharges, type Debt } from "./debt";
import { creditRoom, limitSteps } from "./creditLimit";
import { addDays, dayInWords, daysBetween, daysInMonth, getMonth, getYear, localDay, monthName } from "./dates";
import { financeAlerts, burnRate, daysLeft, dailyAllowance, PACE_FROM_DAY } from "./alerts";
import { costOf, incomeOf, spendingRanking, monthTotals } from "./totals";
import { formatMoney, toCentavos, toPesos } from "./money";
import { carryWords, ifNothingMoreToday, isOpenBill, monthBrief, nextMonthStart, weekAhead, yesterdayOf } from "./monthPlan";
import { borrowedMoney, lenderNames } from "./borrowed";
import type { Account } from "./accounts";
import type { BudgetRevision, Budgets, IsoDate, ReferenceLists, Transaction } from "./types";

/** Money as a plain number of pesos. A model reads 8791.37 better than 879137. */
const pesos = (centavos: number): number => Number(toPesos(centavos).toFixed(2));

export interface AiContext {
  readonly asOf: IsoDate;
  readonly currency: "PHP";
  /**
   * Who they are, in their own words from Settings, Data (`domain/owner.ts`):
   * name, what to call them, about them, and contact details only when they
   * allowed it. Said ahead of the figures, so no trimming for length drops it.
   */
  readonly owner?: readonly string[];
  readonly month: {
    readonly name: string;
    readonly daysLeft: number;
    readonly spent: number;
    readonly revenue: number;
    readonly budget: number | null;
    readonly remaining: number | null;
    /**
     * What is left of the spending track alone, when it has a budget. The
     * day's figure is this over the days left, as the Dashboard and the
     * Budget screen have it (3 October 2026).
     */
    readonly spendingLeft?: number | null;
    /**
     * The spending budget's pace, as the pace alert measures it: what a
     * steady pace allows by today, what the spending track has spent, and
     * that over the days so far. "How is this month going?" was called on
     * track beside the alert saying the opposite (backup of 7 October 2026).
     */
    readonly pace?: {
      readonly allowed: number;
      readonly spent: number;
      readonly perDay: number;
      /** What is left of the spending budget a day, for the days left. */
      readonly perDayLeft: number;
      /** The pace alert's own test: spending a day so far above what is left a day. */
      readonly fast: boolean;
      readonly day: number;
      readonly days: number;
    } | null;
    readonly burnRatePerDay: number;
    readonly allowancePerDay: number | null;
    readonly breakdown: {
      readonly spending: number;
      readonly bills: number;
      readonly subscriptions: number;
      readonly fees: number;
      readonly debtInterest: number;
    };
  };
  /**
   * Today, yesterday and the last seven days.
   *
   * "How much did I spend today" is the most ordinary question there is, and
   * the context had no figure for it: the month, the year and the entries,
   * but nothing about a day. The model is told never to add anything up
   * itself, correctly, so it answered with the month instead and the owner
   * got a paragraph about being over budget. Three figures fix it.
   */
  readonly recent: {
    readonly today: { readonly spent: number; readonly received: number; readonly entries: number };
    readonly yesterday: { readonly spent: number };
    readonly lastSevenDays: { readonly spent: number };
  };
  /**
   * Every account with what it is for. "so whats my balance actual usable"
   * was answered with savings added in (28 September 2026): the list had no
   * way to say which account was which.
   */
  readonly balances: readonly { readonly account: string; readonly balance: number; readonly kind?: "spending" | "reserve" | "savings" | undefined }[];
  readonly netWorth: number;
  /**
   * What the owner owes and what they hold for others, by the definition
   * every screen reads (`owedTotals`). The offline answer summed every
   * debt, either way, so money a friend owed read as money owed (6 October
   * 2026 audit).
   */
  readonly youOwe?: number;
  readonly heldForOthers?: number;
  /**
   * Borrowed money still in the accounts, followed through every transfer
   * (`borrowed.ts`), and the owner's own money beside it. Null when none is
   * borrowed or held.
   */
  readonly ownMoney?: { readonly own: number; readonly borrowed: number; readonly held: number; readonly from: string; readonly heldFor?: string } | null;
  readonly income: {
    readonly cashIn: number;
    /** Cash in, less borrowing. The figure that is actually income. */
    readonly trueIncome: number;
    readonly borrowed: number;
    /** Money already held when counting started. Not earnings. */
    readonly openingBalance: number;
  };
  readonly topSpending: readonly { readonly category: string; readonly amount: number }[];
  readonly bills: {
    readonly overdue: readonly string[];
    readonly dueSoon: readonly string[];
    /** Stopped by the owner: not expected, and not to be called due. */
    readonly stopped?: readonly string[];
  };
  readonly debts: readonly {
    readonly name: string;
    readonly kind: string;
    readonly outstanding: number;
    readonly daysToDue: number | null;
    /** The next payment the Debt screen shows, and how much. */
    readonly nextDue?: string | null;
    readonly amountDue?: number | null;
    /** A credit line's limit and what is left under it, when its lender sets one. */
    readonly limit?: number | null;
    readonly used?: number | null;
    readonly leftToBorrow?: number | null;
    readonly limitState?: string | null;
    readonly limitCounts?: string | null;
    readonly limitHistory?: readonly { readonly from: string; readonly limit: number }[];
    /** Of what is owed, the fees the lender already added: a payment clears them, never as new interest. */
    readonly feesInBalance?: number | null;
    /** Of what is owed, what was borrowed: the rest of it. */
    readonly borrowedInBalance?: number | null;
    /** The day of the month the lender bills, and the due day, as the owner set them. */
    readonly billingDay?: number | null;
    readonly dueDay?: number | null;
    /** The last bill and what is left of it, and when the next one closes. */
    readonly bill?: { readonly last: string | null; readonly billed: number; readonly next: string } | null;
  }[];
  readonly goals: readonly {
    readonly name: string;
    readonly saved: number;
    readonly target: number;
    readonly deadline: string | null;
  }[];
  /** The Planner: what the owner means to pay later and what became of it (docs/16-PLANNER.md). */
  readonly plans?: readonly {
    readonly title: string;
    readonly amount: number;
    readonly left: number;
    readonly due: string;
    /** "by November 15, 2026", "sometime in November 2026", "with no date yet". */
    readonly when?: string | undefined;
    readonly state: string;
    readonly words: string;
    readonly kind: string;
    readonly from: string;
    readonly counted: boolean;
    readonly goal: string;
  }[];
  readonly alerts: readonly { readonly level: string; readonly title: string; readonly detail: string }[];
  /** Same month last year and the month before, for "is this normal". */
  readonly comparison: readonly { readonly month: string; readonly spent: number }[];
  /**
   * Safe to spend, the Dashboard's own figures (`monthBrief`). 6 October
   * 2026: asked how much was safe today, the model answered from the budget,
   * PHP 297.95 a day, while the Dashboard said PHP 201.13 from the wallets;
   * "Thats wrong check my balance again".
   */
  /**
   * The newest change to a month's budget, from the last month. 5 October
   * 2026: "is the new budget reasonable?" was answered about a November card
   * from the conversation, while the budget just changed was October's, on
   * the Budget screen, the night before.
   */
  readonly lastBudgetChange?: {
    readonly on: string;
    readonly month: string;
    readonly spending: number;
    readonly billsSubs: number;
    readonly wasSpending: number;
    readonly wasBillsSubs: number;
  } | null;
  readonly safe?: {
    readonly wallets: number;
    readonly billsDue: number;
    readonly due: readonly { readonly name: string; readonly amount: number; readonly on: string | null }[];
    readonly debtDue: number;
    /** The Planner's plans counted this month, and each (docs/16-PLANNER.md, P5). */
    readonly plansDue?: number;
    readonly plans?: readonly { readonly name: string; readonly left: number; readonly on: string }[];
    readonly safe: number;
    readonly today: number;
    readonly todayShare: number;
    readonly spentToday: number;
    readonly overToday: number;
    readonly perDayAfter: number;
    readonly daysLeft: number;
    readonly budgetLeft: number | null;
    readonly budgetPerDay: number | null;
    /** What yesterday's unspent share did, in sentences (`carryWords`). */
    readonly carry: readonly string[];
    /** What it starts at on the 1st of next month, from the money there now (`nextMonthStart`). */
    readonly next?: { readonly month: string; readonly days: number; readonly carried: number; readonly bills: number; readonly debt: number; readonly plans?: number; readonly safe: number; readonly perDay: number } | undefined;
  } | null;
}

export interface ContextInput {
  readonly transactions: readonly Transaction[];
  readonly accounts: readonly Account[];
  readonly budgets: Budgets;
  readonly credits: readonly Debt[];
  readonly reference: ReferenceLists;
  readonly lowBalanceThreshold: number;
  readonly asOf: IsoDate;
  /** The owner's details from Settings, Data. */
  readonly owner?: OwnerDetails | undefined;
}

/**
 * Build the snapshot.
 *
 * Pure. Given the same ledger it returns the same object, which is what makes
 * it reviewable: you can print it, read it, and know precisely what a provider
 * would receive.
 */
export function buildContext(input: ContextInput): AiContext {
  const { transactions, accounts, budgets, credits, reference, asOf } = input;
  const year = getYear(asOf);
  const month = getMonth(asOf);

  const totals = monthTotals(transactions, year, month);
  const assessment = assessMonthFor(transactions, budgets, year, month);
  const hasBudget = assessment.combined.budget > 0;
  const bills = billStatuses(transactions, reference, asOf);
  const positions = positionsOf(credits, transactions, asOf);
  // Held money is left out, and money kept as yours counted, by `incomeQuality` itself (19 October 2026 audit).
  const quality = incomeQuality(transactions, credits, { start: `${year}-01-01`, end: asOf });

  const live = accounts.filter((a) => !a.archived);

  return {
    asOf,
    currency: "PHP",
    owner: ownerLines(input.owner),

    month: {
      name: `${monthName(month)} ${year}`,
      daysLeft: daysLeft(asOf),
      spent: pesos(totals.total),
      revenue: pesos(totals.revenue),
      budget: hasBudget ? pesos(assessment.combined.budget) : null,
      remaining: hasBudget ? pesos(assessment.combined.remaining) : null,
      spendingLeft: assessment.spending.budget > 0 ? pesos(assessment.spending.remaining) : null,
      pace: (() => {
        if (assessment.spending.budget <= 0) return null;
        const day = Number(asOf.slice(8, 10));
        const days = daysInMonth(year, month);
        const left = daysLeft(asOf);
        const rate = day > 0 ? Math.floor(assessment.spending.spent / day) : 0;
        const perDayLeft = left > 0 ? Math.floor(Math.max(0, assessment.spending.remaining) / left) : 0;
        return {
          allowed: pesos(Math.floor((assessment.spending.budget * day) / days)),
          spent: pesos(assessment.spending.spent),
          perDay: pesos(rate),
          perDayLeft: pesos(perDayLeft),
          // As the alert decides it (`alerts.ts`, budget-pace), so the two never disagree.
          fast: left > 0 && rate > perDayLeft,
          day,
          days,
        };
      })(),
      burnRatePerDay: pesos(burnRate(transactions, asOf)),
      /*
       * A day's share of the spending track, the screens' "a day" figure.
       * The whole plan's remainder over the days counted the bills track's
       * unspent part as spendable: PHP 1,837.00 a day here beside the
       * Dashboard's PHP 1,719.66 (3 October 2026). Negative when over.
       */
      allowancePerDay: (() => {
        if (assessment.spending.budget <= 0) {
          const a = dailyAllowance(transactions, budgets, asOf);
          return a === null ? null : pesos(a);
        }
        const left = daysLeft(asOf);
        if (left === 0) return 0;
        const r = assessment.spending.remaining;
        return pesos(r < 0 ? Math.ceil(r / left) : Math.floor(r / left));
      })(),
      breakdown: {
        spending: pesos(totals.spending),
        bills: pesos(totals.bills),
        subscriptions: pesos(totals.subscriptions),
        fees: pesos(totals.fees),
        debtInterest: pesos(totals.interest),
      },
    },

    recent: {
      today: {
        spent: pesos(spentBetween(transactions, asOf, asOf)),
        received: pesos(receivedBetween(transactions, asOf, asOf)),
        entries: transactions.filter((t) => t.date === asOf).length,
      },
      yesterday: { spent: pesos(spentBetween(transactions, addDays(asOf, -1), addDays(asOf, -1))) },
      lastSevenDays: { spent: pesos(spentBetween(transactions, addDays(asOf, -6), asOf)) },
    },

    balances: live
      .filter((a) => a.kind !== "goal")
      .map((a) => ({
        account: a.name,
        balance: pesos(walletBalance(transactions, a.name)),
        kind: a.kind === "goal" ? undefined : a.kind,
      })),

    /*
     * The Dashboard's figure, by the Dashboard's function (rule 5.6.3):
     * what is owed to the owner is added, not taken away. This subtracted
     * every debt whichever way it pointed, so the day a father owed the owner
     * for his phone plan, the assistant would have quoted a net worth lower
     * than the Dashboard by twice what he owed.
     */
    /*
     * From the same lists as the Dashboard (`reference`, names trimmed and
     * each once), never from the raw account list: two accounts saved under
     * one name were counted twice here and once on every screen (6 October
     * 2026 audit).
     */
    ...(() => {
      const worth = netWorth(totalWalletBalance(transactions, reference.wallets), totalSavingsBalance(transactions, reference.savings), positions);
      return { netWorth: pesos(worth.total), youOwe: pesos(worth.youOwe), heldForOthers: pesos(worth.heldForOthers) };
    })(),

    ownMoney: (() => {
      // Every row, as the balances count them, so own, borrowed and held add up to what the accounts hold.
      const b = borrowedMoney(transactions, credits, [...reference.wallets, ...reference.savings]);
      if (b.inHand <= 0 && b.heldForOthers <= 0) return null;
      // Lenders and the people money is held for, apart: a person money is held for is not a lender (7 October 2026 engine review).
      const isHeld = (id: string): boolean => credits.find((d) => d.id === id)?.form === "pass-through";
      const lent = new Map([...b.byLender].filter(([id]) => !isHeld(id)));
      const heldFor = [...new Set([...b.byLender].filter(([id, v]) => isHeld(id) && v > 0).map(([id]) => credits.find((d) => d.id === id)?.counterparty?.trim() || credits.find((d) => d.id === id)?.name || "someone"))];
      return { own: pesos(b.own), borrowed: pesos(b.inHand), held: pesos(b.heldForOthers), from: b.inHand > 0 ? lenderNames(lent, credits) : "", heldFor: heldFor.join(" and ") };
    })(),

    income: {
      cashIn: pesos(quality.cashIn),
      trueIncome: pesos(quality.trueIncome),
      borrowed: pesos(quality.borrowed),
      openingBalance: pesos(quality.openingBalance),
    },

    // Kinds the lists no longer declare (Money Send, Transaction Fee) still hold real money (backup of 7 October 2026).
    topSpending: spendingRanking(transactions, reference.spendingTypes, {
      start: `${year}-01-01`,
      end: asOf,
    }, { includeUnlisted: true })
      .slice(0, 8)
      .map((r) => ({ category: r.name, amount: pesos(r.amount) })),

    bills: {
      // Past due, not long gone: a bill unpaid for three months is more likely cancelled than late.
      overdue: overdue(bills)
        .filter((b) => !b.lastPaid || daysBetween(b.lastPaid, asOf) <= STOPPED_AFTER_DAYS)
        .map((b) => b.item),
      // Not a bill that looks stopped: one last paid in May 2024 was "due within two weeks" (backup of 7 October 2026).
      dueSoon: upcoming(bills, 14)
        .filter((b) => !b.stopped && (!b.lastPaid || daysBetween(b.lastPaid, asOf) <= STOPPED_AFTER_DAYS))
        .map((b) => b.item),
      stopped: bills.filter((b) => b.stopped).map((b) => b.item),
    },

    debts: positions.map((p) => {
      const due = debtDue(p, transactions, asOf);
      const room = creditRoom(p.debt, transactions, asOf);
      const fees = p.outstanding > 0 && p.debt.kind === "payable" ? unpaidCharges(transactions, p.debt.id, asOf) : 0;
      return {
        name: p.debt.name,
        // On behalf said as what it is, and a line past zero as the extra (13 October 2026 audit).
        kind:
          p.debt.form === "pass-through"
            ? p.outstanding < 0
              ? `on behalf, paid past zero by ${formatMoney(Math.abs(p.outstanding)).replace("₱", "PHP ")}; "clear ${p.debt.counterparty.trim() || p.debt.name}" zeroes it, no money moves`
              : p.debt.kind === "payable"
                ? "on behalf, I hold their money"
                : "on behalf, they owe me"
            : p.debt.kind === "payable"
              ? "I owe"
              : "owed to me",
        outstanding: pesos(p.outstanding),
        daysToDue: p.outstanding > 0 ? (due.daysToDue ?? null) : null,
        nextDue: p.outstanding > 0 ? (due.nextDue ?? null) : null,
        amountDue: p.outstanding > 0 && due.nextDue ? pesos(due.amountDue || p.outstanding) : null,
        limit: room ? pesos(room.limit) : null,
        used: room ? pesos(room.used) : null,
        leftToBorrow: room ? pesos(room.available) : null,
        limitState: room ? { ok: "room left", near: "close to the limit", reached: "limit reached", over: "past the limit" }[room.state] : null,
        limitCounts: room ? (room.counts === "borrowed" ? "only what was borrowed counts" : "everything owed counts, fees too") : null,
        limitHistory: limitSteps(p.debt).map((st) => ({ from: st.from, limit: pesos(st.amount) })),
        feesInBalance: fees > 0 ? pesos(fees) : null,
        borrowedInBalance: fees > 0 ? pesos(p.outstanding - fees) : null,
        billingDay: p.debt.billingDay ?? null,
        dueDay: p.debt.dueDay ?? null,
        bill: due.bill ? { last: due.bill.last ?? null, billed: pesos(due.bill.billed), next: due.bill.next } : null,
      };
    }),

    goals: accounts
      .filter((a) => a.kind === "goal" && !a.archived)
      .map((g) => ({
        name: g.name,
        saved: pesos(walletBalance(transactions, g.name)),
        target: pesos(g.target ?? 0),
        deadline: g.deadline ?? null,
      })),

    // Open plans and the last few closed ones, the same views the Planner shows.
    plans: (reference.plans ?? [])
      .map((p) => viewOf(p, { transactions, accounts, asOf }))
      .filter((v) => v.state !== "removed")
      .sort((a, b) => a.plan.due.localeCompare(b.plan.due))
      .slice(0, 40)
      .map((v) => ({
        title: v.plan.title,
        amount: pesos(v.plan.amount),
        left: pesos(v.left),
        due: v.plan.due,
        when: byWhen(v.plan),
        state: v.state,
        words: v.words,
        kind: v.plan.item,
        from: v.plan.wallet,
        counted: v.counts,
        goal: v.goal && !v.goal.missing ? `${v.goal.name} holds ${formatMoney(v.goal.holds)}` : "",
      })),

    alerts: financeAlerts({
      transactions,
      accounts,
      budgets,
      debts: credits,
      bills,
      lowBalanceThreshold: input.lowBalanceThreshold,
      asOf,
      spendingTypes: reference.spendingTypes,
      safe: monthBrief({ transactions, reference, budgets, debts: credits, year: Number(asOf.slice(0, 4)), month: Number(asOf.slice(5, 7)), asOf }).safe,
    }).map((a) => ({ level: a.level, title: a.title, detail: a.detail })),

    comparison: recentMonths(transactions, asOf, 6),

    lastBudgetChange: (() => {
      let newest: { at: string; year: string; month: number; r: BudgetRevision } | null = null;
      for (const [year, plan] of Object.entries(budgets)) {
        for (const [month, list] of Object.entries(plan.revisions ?? {})) {
          for (const r of list) {
            if (r.what !== "tracks") continue;
            if (!newest || r.at > newest.at) newest = { at: r.at, year, month: Number(month), r };
          }
        }
      }
      // Only one made by the day the figures are for, and in the month before it.
      if (!newest || localDay(newest.at) > asOf || daysBetween(localDay(newest.at), asOf) > 31) return null;
      const { r } = newest;
      return {
        on: localDay(newest.at),
        month: `${monthName(newest.month)} ${newest.year}`,
        spending: pesos(r.spending ?? 0),
        billsSubs: pesos(r.billsSubs ?? 0),
        wasSpending: pesos(r.wasSpending ?? 0),
        wasBillsSubs: pesos(r.wasBillsSubs ?? 0),
      };
    })(),

    safe: (() => {
      const brief = monthBrief({ transactions, reference, budgets, debts: credits, year, month, asOf });
      const safe = brief.safe;
      if (!safe) return null;
      return {
        wallets: pesos(safe.wallets),
        billsDue: pesos(safe.reservedBills),
        due: brief.bills.bills.filter(isOpenBill).map((b) => ({ name: b.item, amount: pesos(b.amount), on: b.dueOn ?? null })),
        debtDue: pesos(safe.reservedDebt),
        plansDue: pesos(safe.reservedPlans),
        plans: safe.plansDue.map((p) => ({ name: p.title, left: pesos(p.left), on: p.due })),
        safe: pesos(safe.safe),
        today: pesos(safe.perDay),
        todayShare: pesos(safe.todayShare),
        spentToday: pesos(safe.spentToday),
        overToday: pesos(safe.overToday),
        perDayAfter: pesos(safe.perDayAfter),
        daysLeft: safe.daysLeft,
        budgetLeft: safe.budgetLeft === null ? null : pesos(safe.budgetLeft),
        budgetPerDay: safe.budgetPerDay === null ? null : pesos(safe.budgetPerDay),
        carry: carryWords(safe, yesterdayOf({ transactions, reference, budgets, debts: credits, year, month, asOf }), (c) => formatMoney(c).replace("₱", "PHP ")),
        next: (() => {
          const n = nextMonthStart({ transactions, reference, budgets, debts: credits, asOf }, safe);
          return { month: `${monthName(n.month)} ${n.year}`, days: n.days, carried: pesos(n.carried), bills: pesos(n.reservedBills), debt: pesos(n.reservedDebt), plans: pesos(n.reservedPlans), safe: pesos(n.safe), perDay: pesos(n.perDay) };
        })(),
      };
    })(),
  };
}

/** The last few months of spend, so "high" can mean something. */
function recentMonths(
  transactions: readonly Transaction[],
  asOf: IsoDate,
  count: number,
): { month: string; spent: number }[] {
  const out: { month: string; spent: number }[] = [];
  let year = getYear(asOf);
  let month = getMonth(asOf);

  for (let i = 0; i < count; i += 1) {
    out.push({
      month: `${monthName(month)} ${year}`,
      spent: pesos(monthTotals(transactions, year, month).total),
    });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out.reverse();
}

/**
 * The context as the text a model actually receives.
 *
 * Separate from `buildContext` so the object can be shown to the owner in the
 * app and the exact string can be shown too. Nothing is hidden between the two.
 */
/**
 * Render one of this module's peso figures.
 *
 * Exported so `aiOffline.ts` renders identically. The figures in `AiContext`
 * are pesos, not centavos, so the app's `formatMoney` is the wrong tool here
 * and silently rejects them; having one spelling in one place is what stops
 * the offline answer and the model's prompt disagreeing about the same number.
 */
export const phpFigure = (n: number): string =>
  `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What those days cost, by the one definition of cost this app has. */
const spentBetween = (rows: readonly Transaction[], from: IsoDate, to: IsoDate): number =>
  rows.filter((t) => t.date >= from && t.date <= to).reduce((sum, t) => sum + costOf(t), 0);

/** And what came in over them, starting balances left out. */
const receivedBetween = (rows: readonly Transaction[], from: IsoDate, to: IsoDate): number =>
  rows.filter((t) => t.date >= from && t.date <= to).reduce((sum, t) => sum + incomeOf(t), 0);

export function contextToText(c: AiContext): string {
  const lines: string[] = [];
  const php = phpFigure;

  /*
   * The day in words, and the days either side. 6 October 2026, the owner:
   * "Make sure the ai knows the date like today etc, yesterday etc tomorrow
   * etc like 'today you can spend ...' 'yesterday you spent ...'". The date
   * is the phone's own (`today()`), so Philippine time.
   */
  lines.push(
    `Today is ${dayInWords(c.asOf)}, ${getYear(c.asOf)} (${c.asOf}). Yesterday was ${dayInWords(addDays(c.asOf, -1))}; tomorrow is ${dayInWords(addDays(c.asOf, 1))}. Currency: Philippine Peso.`,
  );
  // Who they are, before any heading, so the server's trimming for length never drops it.
  for (const line of c.owner ?? []) lines.push(line);
  lines.push("");
  lines.push(`## ${c.month.name}`);
  lines.push(`Spent ${php(c.month.spent)}, received ${php(c.month.revenue)}.`);
  if (c.month.budget !== null) {
    lines.push(
      // The plan, said as the plan: "left" read as money to spend beside the safe figure (13 October 2026 audit).
      `Budget ${php(c.month.budget)} (spending and bills together), ${c.month.remaining! < 0 ? "over by" : "left of the plan"} ${php(Math.abs(c.month.remaining!))}; the plan, never money to spend.`,
    );
  } else {
    lines.push("No budget set for this month.");
  }
  /*
   * The month's average a day so far, every cost counted, bills included.
   * Before a week it is a few entries, and one repair decides it: on 5
   * October the model said a budget "will not work at your current pace"
   * from five days with a PHP 1,534.00 repair in them. So it is said for
   * what it is, and judging a budget by it is ruled out in the instructions.
   */
  const dayOfMonth = Number(c.asOf.slice(8, 10));
  lines.push(
    `All costs so far: ${php(c.month.burnRatePerDay)} a day over ${dayOfMonth} ${dayOfMonth === 1 ? "day" : "days"}, ${c.month.daysLeft} days left.${
      dayOfMonth < PACE_FROM_DAY ? " Too early to read as a pace." : c.month.pace ? " Bills in; the pace is the next line." : ""
    }`,
  );
  /*
   * Never a negative figure a day. Over budget, this said "What is left of
   * the budget works out to PHP -10,218.71 a day", and the model passed it on
   * as "a daily shortfall of PHP -10,218.71 for the remaining day" (30
   * September 2026). Nothing is left to spend a day; the overspend is said once.
   */
  const pace = c.month.pace;
  if (pace && pace.day >= PACE_FROM_DAY) {
    lines.push(
      `Spending budget pace: ${php(pace.spent)} spent by day ${pace.day} of ${pace.days}, where a steady pace would be ${php(pace.allowed)}; ${php(pace.perDayLeft)} a day is left of the spending budget (an average of ${php(pace.perDay)} a day so far, one-off items included, so not a daily rate to repeat): ${pace.fast ? "not on track" : "on track"}.`,
    );
  }
  const spendingLeft = c.month.spendingLeft ?? null;
  // The safe section says what the spending budget leaves a day; saying it here too gave the prompt the figure twice.
  const saidBelow = spendingLeft !== null && c.safe != null && c.safe.budgetLeft !== null;
  if (c.month.allowancePerDay !== null && c.month.allowancePerDay >= 0) {
    if (!saidBelow) {
      lines.push(
        spendingLeft !== null
          ? `What is left of the spending budget, ${php(spendingLeft)}, leaves ${php(c.month.allowancePerDay)} a day. That is the plan; what is safe to spend is the money, below.`
          : `What is left of the budget leaves ${php(c.month.allowancePerDay)} a day, bills and subscriptions included.`,
      );
    }
  } else if (c.month.allowancePerDay !== null) {
    lines.push(
      spendingLeft !== null
        ? `Nothing is left of the spending budget to spend a day: spending is already ${php(Math.abs(spendingLeft))} over it.`
        : "Nothing is left of the budget to spend a day: the month is already over it, by the figure above.",
    );
  }
  const changed = c.lastBudgetChange;
  if (changed) {
    lines.push(
      `Newest budget change, ${changed.on}: ${changed.month} spending ${php(changed.spending)} (was ${php(changed.wasSpending)}), bills and subscriptions ${php(changed.billsSubs)} (was ${php(changed.wasBillsSubs)}). "The new budget" means this one.`,
    );
  }
  lines.push(
    `Split: spending ${php(c.month.breakdown.spending)}, bills ${php(c.month.breakdown.bills)}, subscriptions ${php(c.month.breakdown.subscriptions)}, transfer fees ${php(c.month.breakdown.fees)}, debt interest ${php(c.month.breakdown.debtInterest)}.`,
  );

  /*
   * The Dashboard's safe to spend, figures only: how to use them is in the
   * server's instruction, so the summary stays a summary (`contextSize`).
   */
  const safe = c.safe;
  if (safe) {
    const until = c.month.name.split(" ")[0] ?? "the month";
    const due = safe.due.length > 0 ? ` (${safe.due.map((d) => `${d.name} ${php(d.amount)}`).join(", ")})` : "";
    lines.push("");
    lines.push("## Safe to spend, the Dashboard's figure");
    lines.push(
      `Spending wallets ${php(safe.wallets)}, less bills and subscriptions still to pay ${php(safe.billsDue)}${due}${safe.debtDue > 0 ? `, debt payments due ${php(safe.debtDue)}` : ""}${(safe.plansDue ?? 0) > 0 ? ` and planned spending set aside ${php(safe.plansDue ?? 0)} (${(safe.plans ?? []).map((p) => `${p.name} ${php(p.left)} by ${p.on}`).join(", ")}, from the Planner)` : ""}: ${php(safe.safe)} is safe to spend until ${until} ends.`,
    );
    lines.push(
      /*
       * The division said, so the day figure is never explained as the
       * wallets less the bills, which is the month's figure (backup of 7
       * October 2026, twice). In centavos, then back to pesos.
       */
      `Safe to spend today: ${php(safe.today)}: today's share ${php(safe.todayShare)} (${php(pesos(Math.max(0, toCentavos(safe.safe)) + toCentavos(safe.spentToday)))}, safe to ${until}'s end plus spent today, over ${safe.daysLeft} days) less ${php(safe.spentToday)} spent today${safe.overToday > 0 ? `, ${php(safe.overToday)} past it` : ""}.${safe.daysLeft > 1 ? ` From tomorrow, ${dayInWords(addDays(c.asOf, 1))}: ${php(safe.perDayAfter)} a day for ${safe.daysLeft - 1} days (${php(pesos(ifNothingMoreToday({ safe: toCentavos(safe.safe), daysLeft: safe.daysLeft })))} if nothing more is spent today: unspent money carries over).` : ""}`,
      ...(safe.carry ?? []),
    );
    {
      const week = weekAhead({ perDay: toCentavos(safe.today), perDayAfter: toCentavos(safe.perDayAfter), daysLeft: safe.daysLeft });
      if (week.days > 1) lines.push(`Next ${week.days} days, including today: ${php(pesos(week.amount))}${week.days < 7 ? `, to ${until}'s end` : ""}.`);

    }
    if (safe.next) {
      const n = safe.next;
      lines.push(
        `When ${n.month} starts nothing resets: what is not spent is still in the wallets. On its 1st, if nothing more is spent and nothing comes in: ${php(n.carried)} carries over (the wallets less what is still due in ${until}), less ${n.month.split(" ")[0]}'s bills and subscriptions ${php(n.bills)}${n.debt > 0 ? `, debt payments ${php(n.debt)}` : ""}${(n.plans ?? 0) > 0 ? ` and planned spending ${php(n.plans ?? 0)}` : ""}, leaves ${php(n.safe)}: ${php(n.perDay)} a day over ${n.days} days. Money that comes in before then raises it.`,
      );
    }
    if (safe.budgetLeft !== null) {
      lines.push(
        safe.budgetLeft <= 0
          ? "The spending budget is used up: the plan, not the money."
          : `Spending budget left ${php(safe.budgetLeft)}, ${php(safe.budgetPerDay ?? 0)} a day: the plan, not the money.${safe.budgetLeft - Math.max(0, safe.safe) > safe.todayShare ? ` It promises ${php(Math.round((safe.budgetLeft - Math.max(0, safe.safe)) * 100) / 100)} more than is safe to spend: say so, and that lowering it is on the Budget screen.` : ""}`,
      );
    }
  }

  lines.push("");
  lines.push("## Today and the days before it");
  lines.push(
    `Today so far: spent ${php(c.recent.today.spent)}, received ${php(c.recent.today.received)}, across ${c.recent.today.entries} ${c.recent.today.entries === 1 ? "entry" : "entries"}.`,
  );
  lines.push(`Yesterday: spent ${php(c.recent.yesterday.spent)}.`);
  lines.push(`The last seven days, including today: spent ${php(c.recent.lastSevenDays.spent)}.`);

  lines.push("");
  lines.push("## Accounts, by what each is for");
  const groups: readonly [string, readonly string[], string][] = [
    ["spending", ["spending"], "Usable now, the spending wallets"],
    ["reserve", ["reserve"], "Set aside, reserve accounts"],
    ["savings", ["savings"], "Savings"],
  ];
  const kindOf = (b: AiContext["balances"][number]): string => b.kind ?? "spending";
  for (const [, kinds, title] of groups) {
    const these = c.balances.filter((b) => kinds.includes(kindOf(b)));
    if (these.length === 0) continue;
    const sum = Math.round(these.reduce((total, b) => total + b.balance * 100, 0)) / 100;
    // Empty accounts are counted, not listed: the summary has a size limit.
    const held = these.filter((b) => b.balance !== 0 || kinds.includes("spending"));
    lines.push(`${title}: ${php(sum)} in all${held.length < these.length ? ` (${these.length - held.length} empty)` : ""}`);
    for (const b of held) lines.push(`- ${b.account}: ${php(b.balance)}`);
  }
  const owes = [(c.youOwe ?? 0) > 0 ? `you owe ${php(c.youOwe ?? 0)}` : "", (c.heldForOthers ?? 0) > 0 ? `held for others ${php(c.heldForOthers ?? 0)}` : ""].filter(Boolean);
  lines.push(`Net worth after debt: ${php(c.netWorth)}${owes.length > 0 ? ` (${owes.join("; ")})` : ""}`);
  if (c.ownMoney) {
    const m = c.ownMoney;
    lines.push(
      `Their own money: ${php(m.own)}.${m.borrowed > 0 ? ` Borrowed and still in the accounts: ${php(m.borrowed)}, from ${m.from}.` : ""}${m.held > 0 ? ` Held for others${m.heldFor ? ` (${m.heldFor})` : ""}: ${php(m.held)}.` : ""} Spending past their own money spends that.`,
    );
  }
  lines.push(
    "What they can use or spend is the usable figure. Reserve and savings are theirs but set aside: name them apart and never add them into what is usable unless they ask to count them. Net worth is everything, less what is owed, and is never what they can spend.",
  );

  lines.push("");
  lines.push("## Income this year");
  lines.push(
    // Draws are Debt rows, outside cash in: "of which" said they were inside it (backup of 7 October 2026).
    `Cash in ${php(c.income.cashIn)}, ${php(c.income.openingBalance)} of it already held when counting started. True income ${php(c.income.trueIncome)}. Borrowed besides, never income: ${php(c.income.borrowed)}.`,
  );

  if (c.topSpending.length > 0) {
    lines.push("");
    lines.push("## Biggest spending this year");
    for (const t of c.topSpending.slice(0, 6)) lines.push(`${t.category}: ${php(t.amount)}`);
  }

  if (c.debts.length > 0) {
    lines.push("");
    lines.push("## Debt");
    // A line at nothing is named once, not given a line: settled is all there is to say.
    const settled = c.debts.filter((d) => d.outstanding === 0 && d.nextDue == null && d.limit == null);
    // Two lines under one name (paid for Dad, and holding Dad's money) are told apart.
    const named = (d: (typeof settled)[number]): string => (settled.filter((x) => x.name === d.name).length > 1 ? `${d.name} (${d.kind})` : d.name);
    if (settled.length > 0) lines.push(`Settled, nothing owed either way: ${settled.map(named).join(", ")}.`);
    for (const d of c.debts.filter((x) => !settled.includes(x))) {
      const due =
        d.nextDue == null || d.daysToDue === null
          ? ""
          : `, next payment ${d.amountDue == null ? "" : `${php(d.amountDue)} `}due ${d.nextDue} (${
              d.daysToDue < 0 ? `${Math.abs(d.daysToDue)} days late` : d.daysToDue === 0 ? "today" : `in ${d.daysToDue} days`
            })`;
      const limit =
        d.limit == null
          ? ""
          : `. Credit limit ${php(d.limit)} (${d.limitCounts}): ${php(d.used ?? 0)} used, ${php(d.leftToBorrow ?? 0)} left to borrow, ${d.limitState}${
              (d.limitHistory ?? []).length > 1 ? `. Limit over time: ${(d.limitHistory ?? []).map((h) => `${php(h.limit)} from ${h.from}`).join(", ")}` : ""
            }`;
      const fees = d.feesInBalance
        ? ` (${php(d.borrowedInBalance ?? 0)} borrowed and ${php(d.feesInBalance)} of interest and fees the lender already added; paying ${php(d.outstanding)} clears both, and the interest and fees are already counted, so none of it is new interest)`
        : "";
      const billing = d.billingDay
        ? `. Billed on day ${d.billingDay} of each month${d.dueDay ? `, due on day ${d.dueDay}` : ", due by the next billing day"}${
            d.bill ? `: the bill of ${d.bill.last ?? "last month"} has ${php(d.bill.billed)} left to pay, and the next bill closes ${d.bill.next}` : ""
          }`
        : d.dueDay
          ? `. Due on day ${d.dueDay} of each month`
          : "";
      lines.push(`${d.name} (${d.kind}): ${php(d.outstanding)}${fees}${due}${billing}${limit}`);
    }
  }

  if (c.goals.length > 0) {
    lines.push("");
    lines.push("## Goals");
    for (const g of c.goals) {
      lines.push(
        `${g.name}: ${php(g.saved)} of ${php(g.target)}${g.deadline ? `, by ${g.deadline}` : ""}`,
      );
    }
  }

  if ((c.plans ?? []).length > 0) {
    lines.push("");
    lines.push("## The Planner: what they mean to pay later");
    lines.push("A plan is not an entry: nothing has moved until it is paid. Plans counted in safe to spend are already in its figure above; do not take them off again.");
    for (const p of c.plans ?? []) {
      lines.push(
        `- ${p.title}: ${php(p.amount)} ${p.when ?? `by ${p.due}`}${p.kind ? `, ${p.kind}` : ""}${p.from ? `, from ${p.from}` : ""}. ${p.words}${p.left > 0 && p.left !== p.amount ? `, ${php(p.left)} left` : ""}${p.counted ? ", set aside in safe to spend" : ""}${p.goal ? `. ${p.goal}` : ""}.`,
      );
    }
  }

  if (c.bills.overdue.length > 0 || c.bills.dueSoon.length > 0 || (c.bills.stopped ?? []).length > 0) {
    lines.push("");
    lines.push("## Bills");
    if (c.bills.overdue.length > 0) lines.push(`Past due: ${c.bills.overdue.join(", ")}`);
    if (c.bills.dueSoon.length > 0) lines.push(`Due within two weeks: ${c.bills.dueSoon.join(", ")}`);
    if ((c.bills.stopped ?? []).length > 0) lines.push(`Stopped paying, no longer expected: ${(c.bills.stopped ?? []).join(", ")}`);
  }

  if (c.comparison.length > 1) {
    lines.push("");
    lines.push("## Recent months");
    for (const m of c.comparison) lines.push(`${m.month}: ${php(m.spent)}`);
  }

  if (c.alerts.length > 0) {
    lines.push("");
    lines.push("## Already flagged by the app");
    /*
     * The five that matter most, each cut at 110 characters: the summary has to
     * stay a summary (4,630 bytes on the owner's 13 October data, against a
     * 4,000 limit). The rest are counted, so the model knows they exist.
     */
    const order = { over: 0, warn: 1, info: 2 } as Record<string, number>;
    const shown = [...c.alerts].sort((x, y) => (order[x.level] ?? 3) - (order[y.level] ?? 3)).slice(0, 5);
    // At a sentence's end, or a word's, never inside one: "PHP 1,2..." read as a different figure (13 October 2026 audit).
    const cut = (d: string): string => {
      if (d.length <= 110) return d;
      const head = d.slice(0, 110);
      const stop = head.lastIndexOf(". ");
      return stop > 40 ? head.slice(0, stop + 1) : `${head.slice(0, head.lastIndexOf(" ")).trimEnd()}...`;
    };
    for (const a of shown) lines.push(`[${a.level}] ${a.title}. ${cut(a.detail)}`);
    if (c.alerts.length > shown.length) lines.push(`And ${c.alerts.length - shown.length} more in the bell.`);
  }

  return lines.join("\n");
}

/** Rough size of what would be sent, so the app can show it before sending. */
export function contextSize(c: AiContext): number {
  return new TextEncoder().encode(contextToText(c)).length;
}
