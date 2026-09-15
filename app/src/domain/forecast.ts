/**
 * Forecast: spec rule 5.8, and what it became on 2026-09-16.
 *
 * ── What it was ────────────────────────────────────────────────────────────
 *
 * Ported from VBA Module4: the same month last year, else the mean of the last
 * three months, else the overall mean, each multiplied by a flat 1.03. Bills
 * used the most recent non-zero month and were never forecast below it.
 *
 * ── What was wrong with it ─────────────────────────────────────────────────
 *
 * Four things, all methodology rather than bugs:
 *
 *   1. The 3% was assumed, not measured. Spending that is falling month on
 *      month, which is the whole point of the app, was still forecast to rise.
 *   2. One figure was given for every estimate, with nothing to say whether
 *      the months behind it were PHP 5,800 / 6,100 / 5,900 or PHP 2,000 /
 *      11,000 / 4,500. Both read as "PHP 6,000", which is false precision.
 *   3. The same month last year won outright the moment it existed, so one
 *      unusual January (a fieldtrip, a tuition spike) became next January.
 *   4. Every debt was charged to the month after today, so that month looked
 *      expensive and the month a payment was really due looked free.
 *
 * ── What it does now ───────────────────────────────────────────────────────
 *
 * The growth comes from the ledger: the average month-on-month change over the
 * last six months, held inside a sane band, and flat when there is not enough
 * history to measure a trend. Recent months count more than older ones. Last
 * year's same month is blended with the recent average rather than replacing
 * it. Every estimate carries a range and a word for how much it varies. A
 * debt is charged to the month its payment is actually due.
 *
 * Bills keep the old rule: they are near-fixed and rarely fall, and predicting
 * an increase early is the safer mistake.
 */

import { getMonth, getYear, makeDate } from "./dates";
import type { Centavos } from "./money";
import type { Debt } from "./debt";
import { debtDue, outstandingOf, positionsOf } from "./debt";
import { monthlyTotalsForYear } from "./totals";
import type { IsoDate, Transaction } from "./types";

/** How far a measured trend may move an estimate, either way. */
const TREND_CAP = 0.15;
/** Months of history read for the trend. */
const TREND_WINDOW = 6;
/** Changes needed before a trend is believed at all. */
const TREND_MIN_CHANGES = 3;
/** Months in the recent average, newest weighted heaviest. */
const RECENT_WINDOW = 3;
/** How much of a blended estimate comes from the same month last year. */
const LAST_YEAR_SHARE = 0.4;
/** Coefficient of variation below which a window counts as steady. */
const TIGHT = 0.15;
const MODERATE = 0.35;

export type ForecastBasis =
  | "actual"
  | "blended"
  | "same-month-last-year"
  | "recent-average"
  | "overall-average"
  | "none";

/** How much the months behind an estimate disagree with each other. */
export type Confidence = "tight" | "moderate" | "wide";

export interface MonthForecast {
  readonly month: number;
  readonly spending: Centavos;
  readonly billsSubs: Centavos;
  /** Debt payments due in this month: known, not estimated. */
  readonly debtService: Centavos;
  readonly total: Centavos;
  readonly basis: ForecastBasis;
  /** True once the month has actually happened. */
  readonly isActual: boolean;
  /** The likely range for the spending estimate: one standard deviation either side. */
  readonly low: Centavos;
  readonly high: Centavos;
  readonly confidence: Confidence;
  /** The measured trend this estimate carries. 0.04 is four per cent up. */
  readonly growth: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Newest first in the window, weighted 3, 2, 1: a trivial upgrade on a flat mean. */
function weighted(values: readonly Centavos[]): Centavos {
  const window = values.slice(-RECENT_WINDOW);
  if (window.length === 0) return 0;
  let total = 0;
  let weight = 0;
  window.forEach((value, i) => {
    const w = i + 1;
    total += value * w;
    weight += w;
  });
  return Math.round(total / weight);
}

function deviation(values: readonly Centavos[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/**
 * The trend in the ledger, as a fraction.
 *
 * The average month-on-month change across the window, held to the band, and
 * zero when there are too few changes to read one. Flat is the honest answer
 * when there is no signal; the old code assumed three per cent up instead.
 */
export function trendOf(history: readonly Centavos[]): number {
  const window = history.slice(-TREND_WINDOW);
  const changes: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const before = window[i - 1] ?? 0;
    const now = window[i] ?? 0;
    if (before > 0) changes.push(now / before - 1);
  }
  if (changes.length < TREND_MIN_CHANGES) return 0;
  return Math.max(-TREND_CAP, Math.min(TREND_CAP, mean(changes)));
}

/** How steady a window is, by how far it spreads around its own average. */
export function confidenceOf(window: readonly Centavos[]): Confidence {
  if (window.length < 3) return "wide";
  const m = mean(window);
  if (m <= 0) return "wide";
  const cv = deviation(window) / m;
  return cv < TIGHT ? "tight" : cv < MODERATE ? "moderate" : "wide";
}

/**
 * Twelve months of forecast for a year.
 *
 * Months that have already happened report their actual figures; the rest are
 * estimated. `asOfMonth` is injected rather than read from the clock so the
 * output is deterministic in tests, and `asOf` is the day the debts are read
 * against.
 */
export function forecastYear(
  transactions: readonly Transaction[],
  year: number,
  asOfMonth: number,
  debts: readonly Debt[] = [],
  asOf?: IsoDate,
): MonthForecast[] {
  const thisYear = monthlyTotalsForYear(transactions, year);
  const lastYear = monthlyTotalsForYear(transactions, year - 1);
  const on = asOf ?? makeDate(year, Math.min(12, Math.max(1, asOfMonth)), 15);

  // Only months with real activity inform an estimate.
  const spendHistory = thisYear
    .slice(0, asOfMonth)
    .map((m) => m.spending + m.fees + m.interest)
    .filter((v) => v > 0);

  const billsHistory = thisYear
    .slice(0, asOfMonth)
    .map((m) => m.bills + m.subscriptions)
    .filter((v) => v > 0);

  const lastNonZeroBills = [...billsHistory].pop() ?? 0;
  const growth = trendOf(spendHistory);
  const recentWindow = spendHistory.slice(-RECENT_WINDOW);

  /**
   * What each month owes on its debts.
   *
   * Each debt is charged to the month its next payment falls due, which
   * `debtDue` already works out from the schedule, the due day or the last
   * payment. A debt with no date at all is charged to the month after today,
   * which is where the old code put every one of them.
   */
  const dueByMonth = new Map<number, Centavos>();
  const addDue = (month: number, amount: Centavos): void => {
    if (amount <= 0 || month < 1 || month > 12) return;
    dueByMonth.set(month, (dueByMonth.get(month) ?? 0) + amount);
  };
  for (const position of positionsOf(debts.filter((d) => !d.archived), transactions, on)) {
    if (position.debt.kind !== "payable") continue;
    const outstanding = Math.max(0, outstandingOf(transactions, position.debt.id));
    if (outstanding === 0) continue;
    const due = debtDue(position, transactions, on);
    if (due.nextDue && getYear(due.nextDue) === year) {
      addDue(getMonth(due.nextDue), due.amountDue > 0 ? due.amountDue : outstanding);
    } else if (!due.nextDue) {
      addDue(asOfMonth + 1, outstanding);
    }
  }

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const actual = thisYear[i];

    if (month <= asOfMonth && actual) {
      const spending = actual.spending + actual.fees + actual.interest;
      return {
        month,
        spending,
        billsSubs: actual.bills + actual.subscriptions,
        debtService: 0,
        total: actual.total,
        basis: "actual" as const,
        isActual: true,
        low: spending,
        high: spending,
        confidence: "tight" as const,
        growth: 0,
      };
    }

    // ── Spending ──────────────────────────────────────────────────────────
    const sameMonthLastYear = lastYear[i];
    const lastYearValue = sameMonthLastYear
      ? sameMonthLastYear.spending + sameMonthLastYear.fees + sameMonthLastYear.interest
      : 0;
    const recent = weighted(spendHistory);

    let base = 0;
    let basis: ForecastBasis = "none";
    let window: readonly Centavos[] = [];

    if (lastYearValue > 0 && spendHistory.length >= RECENT_WINDOW) {
      // Blended: one unusual month last year no longer decides the estimate.
      base = Math.round(lastYearValue * LAST_YEAR_SHARE + recent * (1 - LAST_YEAR_SHARE));
      basis = "blended";
      window = [...recentWindow, lastYearValue];
    } else if (lastYearValue > 0) {
      base = lastYearValue;
      basis = "same-month-last-year";
      window = [lastYearValue];
    } else if (spendHistory.length >= RECENT_WINDOW) {
      base = recent;
      basis = "recent-average";
      window = recentWindow;
    } else if (spendHistory.length > 0) {
      base = Math.round(mean(spendHistory));
      basis = "overall-average";
      window = spendHistory;
    }

    const spending = base > 0 ? Math.round(base * (1 + growth)) : 0;
    const spread = Math.round(deviation(window));
    const confidence = confidenceOf(window);

    // ── Bills: the most recent non-zero month, and never below it ─────────
    const billsSubs = Math.max(lastNonZeroBills, Math.round(mean(billsHistory)));
    const debtService = dueByMonth.get(month) ?? 0;

    return {
      month,
      spending,
      billsSubs,
      debtService,
      total: spending + billsSubs + debtService,
      basis,
      isActual: false,
      low: spending > 0 ? Math.max(0, spending - spread) : 0,
      high: spending > 0 ? spending + spread : 0,
      confidence,
      growth: base > 0 ? growth : 0,
    };
  });
}

/** Where a forecast came from, and what trend it carries. */
export function explainBasis(basis: ForecastBasis, growth = 0): string {
  const move =
    growth === 0
      ? ""
      : `, ${Math.abs(Math.round(growth * 100))}% ${growth > 0 ? "up" : "down"} on the trend`;

  switch (basis) {
    case "actual":
      return "Actual: this month has happened";
    case "blended":
      return `The last 3 months, weighted to the newest, with the same month last year${move}`;
    case "same-month-last-year":
      return `The same month last year${move}`;
    case "recent-average":
      return `The last 3 months, weighted to the newest${move}`;
    case "overall-average":
      return `Every month so far${move}`;
    default:
      return "Not enough history to forecast";
  }
}

/** How much the months behind an estimate disagree, in words. */
export function confidenceWords(confidence: Confidence): string {
  switch (confidence) {
    case "tight":
      return "Steady month to month";
    case "moderate":
      return "Varies a little";
    default:
      return "Varies a lot, so treat this loosely";
  }
}

// ── Net cash flow, the BUDGETING sheet's bottom table ─────────────────────

export interface CashFlowRow {
  readonly month: number;
  readonly revenue: Centavos;
  readonly expense: Centavos;
  readonly transfer: Centavos;
  /** revenue − expense */
  readonly net: Centavos;
}

export function cashFlow(
  transactions: readonly Transaction[],
  year: number,
): CashFlowRow[] {
  const totals = monthlyTotalsForYear(transactions, year);

  const transfers = new Array<Centavos>(12).fill(0);
  for (const t of transactions) {
    if (t.type !== "Transfer" || getYear(t.date) !== year) continue;
    const i = getMonth(t.date) - 1;
    transfers[i] = (transfers[i] ?? 0) + t.amount;
  }

  return totals.map((m, i) => ({
    month: i + 1,
    revenue: m.revenue,
    expense: m.total,
    transfer: transfers[i] ?? 0,
    net: m.revenue - m.total,
  }));
}
