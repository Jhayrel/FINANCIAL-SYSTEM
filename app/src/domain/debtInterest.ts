/**
 * What a debt costs to leave unpaid.
 *
 * ── The gap this closes ────────────────────────────────────────────────────
 *
 * `Debt` has carried `interestType` and `interestRate` since the debt module
 * was written, and nothing ever read them to produce a figure. Interest only
 * appeared once it had already been charged and typed in by hand, so the app
 * could say what a debt had cost and never what it was about to cost. A flat
 * fee and a monthly percentage also behaved identically, although one is
 * charged once and the other compounds every cycle it is left.
 *
 * So this is the arithmetic, and only the arithmetic: what interest is
 * expected between two dates, what one more cycle adds, and what interest has
 * cost so far against everything ever borrowed.
 *
 * Every figure stays in whole centavos, rounded once per cycle, which is how
 * a lender charges it: a rounding per cycle, not a rounding at the end.
 */

import { addMonths } from "./dates";
import type { Centavos } from "./money";
import type { Debt, DebtPosition } from "./debt";
import type { IsoDate } from "./types";

/** Basis points to a fraction: 755 is 7.55%. */
const RATE = 10_000;

export interface InterestProjection {
  /** Interest expected across the period, in centavos. */
  readonly amount: Centavos;
  /** Cycles counted. A flat charge is one, however long the period. */
  readonly cycles: number;
  readonly kind: "none" | "flat" | "monthly";
  /** What the debt would owe in all: outstanding plus the interest. */
  readonly owedAfter: Centavos;
}

/**
 * Interest expected on `outstanding` between two dates.
 *
 * `flat` is a fixed charge: it is charged once for the whole period, however
 * long it runs, and it does not compound. `monthly_pct` compounds on every
 * whole cycle that passes, which is what makes leaving a balance expensive:
 * the second month charges interest on the first month's interest.
 *
 * Counted in calendar months from `from`, so a cycle is the same length a
 * lender uses and the 20-day grace `debtDue` allows is not double counted:
 * a payment inside the current cycle owes nothing more.
 */
export function projectedInterest(
  debt: Pick<Debt, "interestType" | "interestRate">,
  outstanding: Centavos,
  from: IsoDate,
  to: IsoDate,
): InterestProjection {
  const owed = Math.max(0, outstanding);
  const none: InterestProjection = { amount: 0, cycles: 0, kind: "none", owedAfter: owed };

  if (owed === 0 || debt.interestType === "none" || debt.interestRate <= 0 || to <= from) return none;

  if (debt.interestType === "flat") {
    const amount = Math.round((owed * debt.interestRate) / RATE);
    return { amount, cycles: 1, kind: "flat", owedAfter: owed + amount };
  }

  let balance = owed;
  let cycles = 0;
  // A cycle is a calendar month from the date it starts, so a 31st stays a 31st.
  while (cycles < 600 && addMonths(from, cycles + 1) <= to) {
    balance += Math.round((balance * debt.interestRate) / RATE);
    cycles += 1;
  }

  return { amount: balance - owed, cycles, kind: "monthly", owedAfter: balance };
}

/**
 * What one more cycle costs: the figure worth seeing before deciding to wait.
 *
 * A flat charge answers the same either way, because it is charged once.
 */
export function costOfWaiting(
  debt: Pick<Debt, "interestType" | "interestRate">,
  outstanding: Centavos,
  from: IsoDate,
): InterestProjection {
  return projectedInterest(debt, outstanding, from, addMonths(from, 1));
}

export interface InterestCost {
  /** Interest paid on this debt so far. */
  readonly paid: Centavos;
  /** Everything ever borrowed on it. */
  readonly borrowed: Centavos;
  /** Interest as a share of what was borrowed, 0 to 1. Null when nothing was borrowed. */
  readonly share: number | null;
}

/**
 * What interest has cost, against what was borrowed.
 *
 * "You have paid ₱938.79 in interest" is easy to shrug off. "18% of
 * everything you borrowed went back in interest" is the same fact and much
 * harder to ignore, and both figures are already on every position.
 */
export function interestCost(position: Pick<DebtPosition, "interestPaid" | "drawn">): InterestCost {
  const borrowed = Math.max(0, position.drawn);
  return {
    paid: position.interestPaid,
    borrowed,
    share: borrowed > 0 ? position.interestPaid / borrowed : null,
  };
}

/** "18%", or "" when nothing has been borrowed yet. Display only. */
export function interestShareWords(cost: InterestCost): string {
  if (cost.share === null || cost.paid === 0) return "";
  const pct = cost.share * 100;
  return pct < 1 ? "under 1%" : `${Math.round(pct)}%`;
}
