/**
 * What kind of arrangement a debt actually is.
 *
 * `kind` alone (payable or receivable) says which way the money is owed and
 * nothing else, so a revolving credit line, a bank loan with a fixed schedule,
 * and PHP 500 lent to a friend all looked identical. They are not: they carry
 * different numbers, answer different questions, and go wrong in different
 * ways.
 *
 * Two independent axes, and the combination is what matters:
 *
 *   DIRECTION   owed-by-me      a liability, subtracted from net worth
 *               owed-to-me      an asset, added to it
 *
 *   FORM        credit-line     revolving. A limit you can draw against
 *                               repeatedly. What matters is how much is left
 *                               and whether interest is accruing.
 *               term-loan       a fixed principal, repaid on a schedule. What
 *                               matters is the next payment and how many
 *                               remain.
 *               informal        a person, a handshake, no schedule. What
 *                               matters is how long it has been outstanding.
 *
 * Six real combinations, all of which happen:
 *
 *   owed-by-me  credit-line   Maya Credit, a credit card
 *   owed-by-me  term-loan     a bank or lending-app loan with amortisation
 *   owed-by-me  informal      money borrowed from family
 *   owed-to-me  term-loan     money lent with an agreed payback schedule
 *   owed-to-me  informal      PHP 500 lent to a classmate
 *   owed-to-me  credit-line   a running tab someone keeps with you
 *
 * `kind` is kept as the direction, so every existing calculation in `debt.ts`
 * keeps working unchanged. `form` is added beside it.
 */

import { addMonths, daysBetween } from "./dates";
import type { Centavos } from "./money";
import type { Debt, DebtPosition } from "./debt";
import type { IsoDate } from "./types";

export type DebtForm = "credit-line" | "term-loan" | "informal";

/** Who is on the other side. An institution charges interest; a friend rarely does. */
export type CounterpartyKind = "institution" | "person";

export const DEBT_FORM_LABEL: Record<DebtForm, string> = {
  "credit-line": "Credit line",
  "term-loan": "Loan",
  informal: "Informal",
};

/** What each combination is called in the interface. */
export function debtLabel(kind: Debt["kind"], form: DebtForm): string {
  if (kind === "payable") {
    if (form === "credit-line") return "Credit line I use";
    if (form === "term-loan") return "Loan I am repaying";
    return "Money I borrowed";
  }
  if (form === "credit-line") return "Credit I extend";
  if (form === "term-loan") return "Loan I am collecting";
  return "Money I lent";
}

/** One line explaining what the combination means. */
export function debtExplanation(kind: Debt["kind"], form: DebtForm): string {
  if (kind === "payable") {
    if (form === "credit-line") {
      return "A limit you can draw against again and again. Drawing is borrowing, not income.";
    }
    if (form === "term-loan") {
      return "A fixed amount you received, repaid on a schedule. Interest is spending; principal is not.";
    }
    return "Money someone gave you that you owe back. No schedule, no interest.";
  }
  if (form === "credit-line") {
    return "A running tab someone keeps with you. It goes up as they take, down as they pay.";
  }
  if (form === "term-loan") {
    return "Money you handed over with an agreed payback schedule. It is an asset, not spending.";
  }
  return "Money you lent. It is still yours, it is just not in your pocket.";
}

/** Defaults that match the form, so a new entry starts sensible. */
export function defaultsFor(form: DebtForm): {
  interestType: Debt["interestType"];
  counterpartyType: CounterpartyKind;
} {
  if (form === "informal") return { interestType: "none", counterpartyType: "person" };
  return { interestType: "monthly_pct", counterpartyType: "institution" };
}

// ── Credit lines ───────────────────────────────────────────────────────────

export interface CreditLineState {
  readonly limit: Centavos;
  readonly used: Centavos;
  readonly available: Centavos;
  /** 0 to 1, or undefined when no limit is set. */
  readonly utilisation?: number | undefined;
  /** True once drawing more would exceed the limit. */
  readonly maxedOut: boolean;
}

export function creditLineState(position: DebtPosition): CreditLineState | null {
  const limit = position.debt.creditLimit;
  if (limit === undefined || limit <= 0) return null;

  const used = Math.max(0, position.outstanding);
  const available = Math.max(0, limit - used);

  return {
    limit,
    used,
    available,
    utilisation: used / limit,
    maxedOut: available === 0,
  };
}

// ── Term loans ─────────────────────────────────────────────────────────────

export interface LoanSchedule {
  /** What was borrowed in the first place. */
  readonly principal: Centavos;
  readonly monthlyPayment: Centavos;
  readonly termMonths: number;
  /** Payments already made, from the ledger rather than from a counter. */
  readonly paid: number;
  readonly remaining: number;
  readonly nextDue?: IsoDate | undefined;
  /** Negative when the next payment is already late. */
  readonly daysToNext?: number | undefined;
  readonly finished: boolean;
}

/**
 * Where a term loan stands.
 *
 * Payments made are counted from the ledger, not stored, so the schedule can
 * never disagree with the transactions behind it. A partial payment still
 * counts as one payment: the schedule is a plan, and the outstanding balance
 * is the truth.
 */
export function loanSchedule(
  position: DebtPosition,
  today: IsoDate,
): LoanSchedule | null {
  const { debt } = position;
  const principal = debt.creditLimit;
  const term = debt.termMonths;
  if (principal === undefined || term === undefined || term <= 0) return null;

  const monthlyPayment = Math.round(principal / term);
  // One repayment row is one instalment. Counting from the ledger means a
  // missed month shows as a missed month rather than quietly re-basing.
  const paid = Math.min(term, position.repaymentCount ?? 0);
  const remaining = Math.max(0, term - paid);
  const finished = remaining === 0 || position.outstanding <= 0;

  if (finished) {
    return { principal, monthlyPayment, termMonths: term, paid, remaining: 0, finished: true };
  }

  const nextDue = addMonths(debt.openedDate, paid + 1);
  return {
    principal,
    monthlyPayment,
    termMonths: term,
    paid,
    remaining,
    nextDue,
    daysToNext: daysBetween(today, nextDue),
    finished: false,
  };
}

/**
 * What to show for this debt, in one line, whatever form it takes.
 *
 * The Debt screen asks this rather than branching on the form itself, so a new
 * form only has to be handled here.
 */
export function headline(
  position: DebtPosition,
  today: IsoDate,
  money: (c: Centavos) => string,
): string {
  const form = position.debt.form ?? "credit-line";

  if (form === "credit-line") {
    const state = creditLineState(position);
    if (!state) return `${money(position.outstanding)} outstanding`;
    return `${money(state.used)} used of ${money(state.limit)}, ${money(state.available)} left to draw`;
  }

  if (form === "term-loan") {
    const schedule = loanSchedule(position, today);
    if (!schedule) return `${money(position.outstanding)} outstanding`;
    if (schedule.finished) return "Fully repaid";
    return `${money(schedule.monthlyPayment)} a month, ${schedule.remaining} of ${schedule.termMonths} left`;
  }

  return `${money(position.outstanding)} outstanding`;
}
