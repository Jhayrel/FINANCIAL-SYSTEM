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

import { walletBalance } from "./balances";
import { assessMonthFor } from "./budget";
import { billStatuses, overdue, upcoming } from "./bills";
import { incomeQuality, positionsOf, type Debt } from "./debt";
import { getMonth, getYear, monthName } from "./dates";
import { financeAlerts, burnRate, daysLeft, dailyAllowance } from "./alerts";
import { spendingRanking, monthTotals } from "./totals";
import { toPesos } from "./money";
import type { Account } from "./accounts";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "./types";

/** Money as a plain number of pesos. A model reads 8791.37 better than 879137. */
const pesos = (centavos: number): number => Number(toPesos(centavos).toFixed(2));

export interface AiContext {
  readonly asOf: IsoDate;
  readonly currency: "PHP";
  readonly month: {
    readonly name: string;
    readonly daysLeft: number;
    readonly spent: number;
    readonly revenue: number;
    readonly budget: number | null;
    readonly remaining: number | null;
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
  readonly balances: readonly { readonly account: string; readonly balance: number }[];
  readonly netWorth: number;
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
  };
  readonly debts: readonly {
    readonly name: string;
    readonly kind: string;
    readonly outstanding: number;
    readonly daysToDue: number | null;
  }[];
  readonly goals: readonly {
    readonly name: string;
    readonly saved: number;
    readonly target: number;
    readonly deadline: string | null;
  }[];
  readonly alerts: readonly { readonly level: string; readonly title: string; readonly detail: string }[];
  /** Same month last year and the month before, for "is this normal". */
  readonly comparison: readonly { readonly month: string; readonly spent: number }[];
}

export interface ContextInput {
  readonly transactions: readonly Transaction[];
  readonly accounts: readonly Account[];
  readonly budgets: Budgets;
  readonly credits: readonly Debt[];
  readonly reference: ReferenceLists;
  readonly lowBalanceThreshold: number;
  readonly asOf: IsoDate;
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
  const quality = incomeQuality(transactions, credits, { start: `${year}-01-01`, end: asOf });

  const live = accounts.filter((a) => !a.archived);

  return {
    asOf,
    currency: "PHP",

    month: {
      name: `${monthName(month)} ${year}`,
      daysLeft: daysLeft(asOf),
      spent: pesos(totals.total),
      revenue: pesos(totals.revenue),
      budget: hasBudget ? pesos(assessment.combined.budget) : null,
      remaining: hasBudget ? pesos(assessment.combined.remaining) : null,
      burnRatePerDay: pesos(burnRate(transactions, asOf)),
      allowancePerDay: (() => {
        const a = dailyAllowance(transactions, budgets, asOf);
        return a === null ? null : pesos(a);
      })(),
      breakdown: {
        spending: pesos(totals.spending),
        bills: pesos(totals.bills),
        subscriptions: pesos(totals.subscriptions),
        fees: pesos(totals.fees),
        debtInterest: pesos(totals.interest),
      },
    },

    balances: live
      .filter((a) => a.kind !== "goal")
      .map((a) => ({ account: a.name, balance: pesos(walletBalance(transactions, a.name)) })),

    netWorth: pesos(
      live.reduce((sum, a) => sum + walletBalance(transactions, a.name), 0) -
        positions.reduce((sum, p) => sum + Math.max(0, p.outstanding), 0),
    ),

    income: {
      cashIn: pesos(quality.cashIn),
      trueIncome: pesos(quality.trueIncome),
      borrowed: pesos(quality.borrowed),
      openingBalance: pesos(quality.openingBalance),
    },

    topSpending: spendingRanking(transactions, reference.spendingTypes, {
      start: `${year}-01-01`,
      end: asOf,
    })
      .slice(0, 8)
      .map((r) => ({ category: r.name, amount: pesos(r.amount) })),

    bills: {
      overdue: overdue(bills).map((b) => b.item),
      dueSoon: upcoming(bills, 14).map((b) => b.item),
    },

    debts: positions.map((p) => ({
      name: p.debt.name,
      kind: p.debt.kind === "payable" ? "I owe" : "owed to me",
      outstanding: pesos(p.outstanding),
      daysToDue: p.daysToDue ?? null,
    })),

    goals: accounts
      .filter((a) => a.kind === "goal" && !a.archived)
      .map((g) => ({
        name: g.name,
        saved: pesos(walletBalance(transactions, g.name)),
        target: pesos(g.target ?? 0),
        deadline: g.deadline ?? null,
      })),

    alerts: financeAlerts({
      transactions,
      accounts,
      budgets,
      debts: credits,
      bills,
      lowBalanceThreshold: input.lowBalanceThreshold,
      asOf,
    }).map((a) => ({ level: a.level, title: a.title, detail: a.detail })),

    comparison: recentMonths(transactions, asOf, 6),
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
export function contextToText(c: AiContext): string {
  const lines: string[] = [];
  const php = (n: number): string => `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

  lines.push(`Date: ${c.asOf}. Currency: Philippine Peso.`);
  lines.push("");
  lines.push(`## ${c.month.name}`);
  lines.push(`Spent ${php(c.month.spent)}, received ${php(c.month.revenue)}.`);
  if (c.month.budget !== null) {
    lines.push(
      `Budget ${php(c.month.budget)}, ${c.month.remaining! < 0 ? "over by" : "remaining"} ${php(Math.abs(c.month.remaining!))}.`,
    );
  } else {
    lines.push("No budget set for this month.");
  }
  lines.push(
    `Spending so far averages ${php(c.month.burnRatePerDay)} a day, with ${c.month.daysLeft} days left.`,
  );
  if (c.month.allowancePerDay !== null) {
    lines.push(`What is left of the budget works out to ${php(c.month.allowancePerDay)} a day.`);
  }
  lines.push(
    `Split: spending ${php(c.month.breakdown.spending)}, bills ${php(c.month.breakdown.bills)}, subscriptions ${php(c.month.breakdown.subscriptions)}, transfer fees ${php(c.month.breakdown.fees)}, debt interest ${php(c.month.breakdown.debtInterest)}.`,
  );

  lines.push("");
  lines.push("## Accounts");
  for (const b of c.balances) lines.push(`${b.account}: ${php(b.balance)}`);
  lines.push(`Net worth after debt: ${php(c.netWorth)}`);

  lines.push("");
  lines.push("## Income this year");
  lines.push(
    `Cash in ${php(c.income.cashIn)}, of which ${php(c.income.borrowed)} was borrowed and ${php(c.income.openingBalance)} was already held when counting started. True income ${php(c.income.trueIncome)}.`,
  );

  if (c.topSpending.length > 0) {
    lines.push("");
    lines.push("## Biggest spending this year");
    for (const t of c.topSpending) lines.push(`${t.category}: ${php(t.amount)}`);
  }

  if (c.debts.length > 0) {
    lines.push("");
    lines.push("## Debt");
    for (const d of c.debts) {
      const due = d.daysToDue === null ? "" : `, due in ${d.daysToDue} days`;
      lines.push(`${d.name} (${d.kind}): ${php(d.outstanding)}${due}`);
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

  if (c.bills.overdue.length > 0 || c.bills.dueSoon.length > 0) {
    lines.push("");
    lines.push("## Bills");
    if (c.bills.overdue.length > 0) lines.push(`Past due: ${c.bills.overdue.join(", ")}`);
    if (c.bills.dueSoon.length > 0) lines.push(`Due within two weeks: ${c.bills.dueSoon.join(", ")}`);
  }

  if (c.comparison.length > 1) {
    lines.push("");
    lines.push("## Recent months");
    for (const m of c.comparison) lines.push(`${m.month}: ${php(m.spent)}`);
  }

  if (c.alerts.length > 0) {
    lines.push("");
    lines.push("## Already flagged by the app");
    for (const a of c.alerts) lines.push(`[${a.level}] ${a.title}. ${a.detail}`);
  }

  return lines.join("\n");
}

/** Rough size of what would be sent, so the app can show it before sending. */
export function contextSize(c: AiContext): number {
  return new TextEncoder().encode(contextToText(c)).length;
}
