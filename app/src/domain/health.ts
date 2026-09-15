/**
 * The handful of figures that say how the money is doing, not what it did.
 *
 * ── Why these five ─────────────────────────────────────────────────────────
 *
 * Every screen so far answers "what happened": balances, totals, a month
 * against its budget. None answered "how is this going", which is the
 * question a person actually has. These are the standard personal-finance
 * ratios for it, and all five come out of figures the app already has.
 *
 *   Savings rate     what is kept of what is genuinely earned
 *   Runway           how long the wallets last at the recent rate of spending
 *   Debt to income   what is owed against a year of earning
 *   Discretionary    how much of the spending was not essential
 *   Straight out     how much of each payment left within two days of arriving
 *
 * Borrowed money is never counted as income in any of them: `incomeQuality`
 * already separates that, and counting it would flatter every ratio here.
 *
 * A figure with nothing behind it is null, never zero. Zero is an answer;
 * "there is not enough here to say" is a different answer, and the words say
 * which one it is.
 */

import type { Account } from "./accounts";
import { walletBalance } from "./balances";
import { addDays, daysBetween } from "./dates";
import type { Debt, DebtPosition } from "./debt";
import { incomeQuality, totalPayables } from "./debt";
import { formatMoney, type Centavos } from "./money";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

/** Months of spending behind the runway and the savings rate. */
const WINDOW_MONTHS = 3;
/** How long after money arrives counts as "straight out again". */
const STRAIGHT_OUT_DAYS = 2;

export interface Ratio {
  /** 0 to 1, or more where a ratio can pass 1. Null when there is nothing to divide. */
  readonly value: number | null;
  /** The two figures behind it, so the ratio can be checked rather than believed. */
  readonly of: Centavos;
  readonly from: Centavos;
}

export interface MoneyHealth {
  /** What was kept of what was earned, over the window. */
  readonly savingsRate: Ratio;
  /** Money moved into reserve and savings accounts, less what came back out. */
  readonly putAside: Centavos;
  /** Months the spending wallets would last at the window's rate. Null with no spending. */
  readonly runwayMonths: number | null;
  /** What is owed against a year of true income. */
  readonly debtToIncome: Ratio;
  /** Spending on kinds marked discretionary, against spending on kinds that carry a mark. */
  readonly discretionary: Ratio;
  /** Kinds of spending with no mark yet, so the share above can be read honestly. */
  readonly untagged: number;
  /** The share of each payment that left within two days, averaged over payments. */
  readonly straightOut: number | null;
  /** The days the window covers, for the words. */
  readonly windowDays: number;
}

const ratio = (of: Centavos, from: Centavos): Ratio => ({
  value: from > 0 ? of / from : null,
  of,
  from,
});

/** Which accounts hold money that can be spent today. */
const spendable = (accounts: readonly Account[]): Account[] =>
  accounts.filter((a) => !a.archived && a.kind === "spending");

/** Reserve and savings: set aside rather than available. */
const setAside = (accounts: readonly Account[]): Account[] =>
  accounts.filter((a) => !a.archived && (a.kind === "reserve" || a.kind === "savings" || a.kind === "goal"));

export function moneyHealth(input: {
  readonly transactions: readonly Transaction[];
  readonly accounts: readonly Account[];
  readonly debts: readonly Debt[];
  readonly positions: readonly DebtPosition[];
  /** How a kind of spending is marked, by name. Anything unmarked is left out of the share. */
  readonly necessity: Readonly<Record<string, "essential" | "discretionary" | "emergency">>;
  readonly asOf: IsoDate;
}): MoneyHealth {
  const { transactions, accounts, debts, positions, necessity, asOf } = input;

  const windowStart = addDays(asOf, -(WINDOW_MONTHS * 30) + 1);
  const yearStart = addDays(asOf, -364);
  const inWindow = transactions.filter((t) => t.date >= windowStart && t.date <= asOf);
  const inYear = transactions.filter((t) => t.date >= yearStart && t.date <= asOf);

  const windowIncome = incomeQuality(inWindow, debts, { start: windowStart, end: asOf }).trueIncome;
  const yearIncome = incomeQuality(inYear, debts, { start: yearStart, end: asOf }).trueIncome;
  const windowSpend = inWindow.reduce((sum, t) => sum + Math.max(0, costOf(t)), 0);

  // ── Kept, and what of it actually went somewhere set aside ───────────────
  const kept = windowIncome - windowSpend;
  const savingsRate = ratio(Math.max(0, kept), windowIncome);

  const aside = new Set(setAside(accounts).map((a) => a.name.trim()));
  let putAside = 0;
  for (const t of inWindow) {
    if (t.type !== "Transfer") continue;
    const into = aside.has(t.toWallet.trim());
    const outOf = aside.has(t.fromWallet.trim());
    if (into && !outOf) putAside += t.amount;
    else if (outOf && !into) putAside -= t.amount;
  }

  // ── How long the spendable wallets last at that rate ─────────────────────
  const wallets = spendable(accounts).reduce((sum, a) => sum + walletBalance(transactions, a.name), 0);
  const perMonth = windowSpend > 0 ? windowSpend / WINDOW_MONTHS : 0;
  const runwayMonths = perMonth > 0 ? Math.max(0, wallets) / perMonth : null;

  // ── What is owed, against a year of earning ──────────────────────────────
  const debtToIncome = ratio(totalPayables(positions), yearIncome);

  // ── How much of the spending was not essential ───────────────────────────
  let marked = 0;
  let discretionary = 0;
  for (const t of inWindow) {
    const cost = Math.max(0, costOf(t));
    if (cost === 0 || t.type !== "Spending" || t.category !== "Spending") continue;
    const mark = necessity[t.item.trim()];
    if (!mark) continue;
    marked += cost;
    if (mark === "discretionary") discretionary += cost;
  }
  const kinds = new Set(
    inWindow
      .filter((t) => t.type === "Spending" && t.category === "Spending" && t.item.trim())
      .map((t) => t.item.trim()),
  );
  const untagged = [...kinds].filter((name) => !necessity[name]).length;

  // ── How much of each payment left again within two days ──────────────────
  const arrivals = inWindow.filter((t) => t.type === "Revenue" && t.category !== "Opening" && t.total > 0);
  const shares: number[] = [];
  for (const arrival of arrivals) {
    const until = addDays(arrival.date, STRAIGHT_OUT_DAYS);
    const out = transactions
      .filter((t) => t.date >= arrival.date && t.date <= until)
      .filter((t) => !arrival.toWallet || t.fromWallet === arrival.toWallet)
      .reduce((sum, t) => sum + Math.max(0, costOf(t)), 0);
    shares.push(Math.min(1, out / arrival.total));
  }
  const straightOut = shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : null;

  return {
    savingsRate,
    putAside,
    runwayMonths,
    debtToIncome,
    discretionary: ratio(discretionary, marked),
    untagged,
    straightOut,
    windowDays: daysBetween(windowStart, asOf) + 1,
  };
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * The same five figures as sentences, each naming what it is measured against.
 *
 * Nothing here says whether a figure is good. A savings rate of 12% means
 * something different for someone paying tuition than for someone who is not,
 * and the app does not know which.
 */
export function healthWords(health: MoneyHealth, months = WINDOW_MONTHS): string[] {
  const out: string[] = [];

  if (health.savingsRate.value !== null) {
    out.push(
      `You kept ${pct(health.savingsRate.value)} of what you earned over the last ${months} months.`,
    );
  } else {
    out.push(`No income in the last ${months} months, so there is no savings rate to give.`);
  }

  if (health.putAside !== 0) {
    out.push(
      health.putAside > 0
        ? `${formatMoney(health.putAside)} went into reserve and savings in that time.`
        : `${formatMoney(-health.putAside)} came back out of reserve and savings in that time.`,
    );
  }

  if (health.runwayMonths !== null) {
    out.push(
      health.runwayMonths >= 24
        ? "At the recent rate of spending, the wallets would last over two years."
        : `At the recent rate of spending, the wallets would last about ${health.runwayMonths.toFixed(1)} months.`,
    );
  }

  if (health.debtToIncome.value !== null && health.debtToIncome.of > 0) {
    out.push(`What you owe is ${pct(health.debtToIncome.value)} of a year of income.`);
  }

  if (health.discretionary.value !== null) {
    out.push(
      `${pct(health.discretionary.value)} of the spending you have marked was discretionary${
        health.untagged > 0 ? `, with ${health.untagged} kinds not marked yet` : ""
      }.`,
    );
  }

  if (health.straightOut !== null) {
    out.push(`On average, ${pct(health.straightOut)} of each payment left again within two days.`);
  }

  return out;
}
