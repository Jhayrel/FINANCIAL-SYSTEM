/**
 * Smart daily allocation: spec rule 5.7, ported from VBA Module10.
 *
 *   dailyBudget = walletBalance / daysLeftInMonth
 *   score(cat)  = avgAmount × recurrenceMultiplier
 *
 * Multiplier: ×2 due or overdue · ×1.5 due within 2 days · ×1.1 if used twice
 * or more in the last 7 days · otherwise ×1. Then a proportional split, capped
 * at 25% per category, floored at ₱50, rounded to ₱10, rescaled to 90% if the
 * total overshoots, and only the top 3 are shown.
 *
 * NEW beyond the Excel: debt due inside the window is a hard first claim,
 * deducted before anything is allocated, never scored against.
 */

import { daysBetween, daysLeftInMonth, today } from "./dates";
import type { Centavos } from "./money";
import type { DebtPosition } from "./debt";
import type { IsoDate, Transaction } from "./types";

/** What the ledger knows about how one category behaves. */
export interface CategoryPattern {
  readonly name: string;
  readonly averageAmount: Centavos;
  readonly transactionCount: number;
  readonly lastDate: IsoDate;
  readonly daysSinceLast: number;
  readonly averageGapDays: number;
  readonly lastWeekCount: number;
  readonly isRecurring: boolean;
  readonly isOverdue: boolean;
}

/**
 * Learn each spending category's rhythm from the whole ledger.
 *
 * Bills and subscriptions are excluded: they have their own due dates, and
 * folding them in here would double-count them against the daily budget.
 */
export function learnPatterns(
  transactions: readonly Transaction[],
  asOf: IsoDate = today(),
): CategoryPattern[] {
  const byItem = new Map<string, { dates: IsoDate[]; total: Centavos }>();

  for (const t of transactions) {
    if (t.type !== "Spending" || t.category !== "Spending") continue;
    if (!t.item) continue;

    const entry = byItem.get(t.item) ?? { dates: [], total: 0 };
    entry.dates.push(t.date);
    entry.total += t.total;
    byItem.set(t.item, entry);
  }

  const out: CategoryPattern[] = [];

  for (const [name, { dates, total }] of byItem) {
    dates.sort();
    const count = dates.length;
    const last = dates[count - 1]!;
    const daysSinceLast = daysBetween(last, asOf);

    let averageGapDays = 30;
    if (count > 1) {
      let gaps = 0;
      for (let i = 1; i < count; i++) gaps += daysBetween(dates[i - 1]!, dates[i]!);
      averageGapDays = gaps / (count - 1);
    }

    const lastWeekCount = dates.filter((d) => daysBetween(d, asOf) <= 7).length;

    // Recurring: 3+ transactions, a gap under a month, and still active.
    const isRecurring = count >= 3 && averageGapDays <= 30 && daysSinceLast <= 45;

    // Overdue is a tighter test: only for genuinely frequent categories.
    const isOverdue =
      count >= 6 &&
      averageGapDays >= 2 &&
      averageGapDays <= 14 &&
      daysSinceLast > averageGapDays * 0.8;

    out.push({
      name,
      averageAmount: Math.round(total / count),
      transactionCount: count,
      lastDate: last,
      daysSinceLast,
      averageGapDays,
      lastWeekCount,
      isRecurring,
      isOverdue,
    });
  }

  return out;
}

export interface Allocation {
  readonly name: string;
  readonly amount: Centavos;
  readonly reason: "overdue" | "due-soon" | "frequent" | "usual";
}

export interface DailyPlan {
  readonly daysLeft: number;
  /** Balance minus any debt claimed first. */
  readonly available: Centavos;
  /** Debt deducted before allocating: a hard first claim. */
  readonly debtClaim: Centavos;
  readonly dailyBudget: Centavos;
  readonly allocations: readonly Allocation[];
  readonly suggestedTotal: Centavos;
}

const MAX_SHARE = 0.25;
const FLOOR = 5000; // ₱50.00
const ROUND_TO = 1000; // ₱10.00
const RESCALE = 0.9;
const TOP_N = 3;

const roundTo10 = (c: Centavos): Centavos => Math.round(c / ROUND_TO) * ROUND_TO;

/**
 * Today's plan.
 *
 * Deliberately conservative: it never proposes more than 90% of the daily
 * budget, and it shows only three lines: a list of fifteen tiny allocations
 * is not a plan anyone follows.
 */
export function planDay(
  walletBalance: Centavos,
  patterns: readonly CategoryPattern[],
  positions: readonly DebtPosition[] = [],
  asOf: IsoDate = today(),
): DailyPlan {
  const daysLeft = Math.max(1, daysLeftInMonth(asOf));

  /**
   * Debt due inside the window is not discretionary. Take it off the top so
   * the daily budget reflects money that is genuinely free to spend.
   */
  const debtClaim = positions
    .filter((p) => p.status === "open" && p.daysToDue !== undefined && p.daysToDue <= daysLeft)
    .reduce((a, p) => a + Math.max(0, p.outstanding), 0);

  const available = Math.max(0, walletBalance - debtClaim);
  const dailyBudget = Math.round(available / daysLeft);

  if (dailyBudget <= 0 || patterns.length === 0) {
    return { daysLeft, available, debtClaim, dailyBudget, allocations: [], suggestedTotal: 0 };
  }

  // ── Score ────────────────────────────────────────────────────────────────
  const scored = patterns.map((p) => {
    let multiplier = 1;
    let reason: Allocation["reason"] = "usual";

    if (p.isRecurring) {
      const daysUntil = Math.round(p.averageGapDays) - p.daysSinceLast;
      if (daysUntil <= 0) {
        multiplier = 2;
        reason = "overdue";
      } else if (daysUntil <= 2) {
        multiplier = 1.5;
        reason = "due-soon";
      }
    } else if (p.lastWeekCount >= 2) {
      multiplier = 1.1;
      reason = "frequent";
    }

    if (p.isOverdue) {
      multiplier = Math.max(multiplier, 2);
      reason = "overdue";
    }

    return { pattern: p, score: p.averageAmount * multiplier, reason };
  });

  const totalScore = scored.reduce((a, s) => a + s.score, 0);
  if (totalScore <= 0) {
    return { daysLeft, available, debtClaim, dailyBudget, allocations: [], suggestedTotal: 0 };
  }

  const cap = Math.round(dailyBudget * MAX_SHARE);

  // ── Split, cap, floor, round ─────────────────────────────────────────────
  let allocations = scored.map((s) => {
    let amount = Math.round(dailyBudget * (s.score / totalScore));

    if (amount > cap) amount = cap;

    if (amount > 0 && amount < FLOOR) {
      // Fall back to what this category actually costs, within reason.
      const fromHistory = Math.round(s.pattern.averageAmount * 0.5);
      amount = Math.min(15000, Math.max(FLOOR, fromHistory));
    }

    return { name: s.pattern.name, amount: roundTo10(amount), reason: s.reason };
  });

  // ── Rescale if the rounding pushed us over ───────────────────────────────
  let total = allocations.reduce((a, x) => a + x.amount, 0);
  if (total > dailyBudget) {
    const factor = (dailyBudget * RESCALE) / total;
    allocations = allocations.map((a) => ({ ...a, amount: roundTo10(Math.round(a.amount * factor)) }));
  }

  const top = allocations
    .filter((a) => a.amount >= FLOOR)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, TOP_N);

  total = top.reduce((a, x) => a + x.amount, 0);

  return { daysLeft, available, debtClaim, dailyBudget, allocations: top, suggestedTotal: total };
}

export const REASON_LABEL: Record<Allocation["reason"], string> = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  frequent: "Frequent lately",
  usual: "Usual",
};
