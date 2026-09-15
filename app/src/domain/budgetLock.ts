/**
 * When a month's budget can change, and what a change leaves behind.
 *
 * ── Why a month closes ────────────────────────────────────────────────────
 *
 * A budget is a promise made before the money is spent. If a month's budget
 * can still be raised after the month is over, "within budget" means nothing:
 * any overspend can be made to disappear by moving the line to meet it. So a
 * month that is over stops taking changes, and its verdict stays the verdict.
 *
 * ── The real cases, and what each does ────────────────────────────────────
 *
 *   B1  A running or future month changes freely. The last day of the month
 *       is still the month: it closes the day after, on this device's date.
 *   B2  Every change is kept: what the budget was, what it became, and when.
 *       Setting it today and raising it next week shows both.
 *   B3  The last change of a month that is not closed can be undone.
 *   B4  For five days after a month ends it still takes changes, marked as
 *       made after the month ended: the budget you forgot to set, or the late
 *       bill you want to allow for.
 *   B5  After that the month is closed. It can still be corrected, when the
 *       budget was simply wrong, but only on its own and only with a reason,
 *       and the correction is shown as one.
 *   B6  Saving a budget to "the rest of the year" or "all of it" writes only
 *       months still running or ahead. Months that are over are listed as
 *       left alone, never silently rewritten.
 *   B7  Limits for kinds of spending follow the same rules.
 *   B8  A change that changes nothing is not a change and is not recorded.
 *
 * Entries are never locked. A receipt found in October for August still goes
 * in, and counts against August's budget as it stood.
 */

import type { PlanScope } from "./budgetView";
import { addDays, daysBetween, lastOfMonth, MONTH_NAMES } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { BudgetRevision, BudgetYear, IsoDate } from "./types";

type Amounts = BudgetYear["spending"];

/** Days after a month ends that it still takes changes (B4). */
export const GRACE_DAYS = 5;

/** Changes kept per month. The oldest go first past this. */
export const MAX_REVISIONS = 30;

/** The shortest reason accepted for correcting a closed month. */
export const MIN_REASON = 3;

export type LockState = BudgetRevision["when"];

export interface MonthLock {
  readonly state: LockState;
  /** The last day the month takes changes without a reason. Absent while it runs. */
  readonly editableUntil?: IsoDate | undefined;
  /** Days of grace left, today included. Grace only. */
  readonly daysLeft?: number | undefined;
}

const NOTHING: Amounts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const monthName = (m: number): string => MONTH_NAMES[m - 1] ?? "";

export function monthLock(year: number, month: number, asOf: IsoDate): MonthLock {
  const end = lastOfMonth(year, month);
  if (asOf <= end) return { state: "open" };
  const until = addDays(end, GRACE_DAYS);
  if (asOf <= until) return { state: "grace", editableUntil: until, daysLeft: daysBetween(asOf, until) + 1 };
  return { state: "closed", editableUntil: until };
}

export interface SaveOutcome {
  readonly plan: BudgetYear;
  /** Months written, in order. */
  readonly written: readonly number[];
  /** Months the scope reached but left alone because they are over (B6). */
  readonly skipped: readonly number[];
  /** The changes recorded, one per month written. */
  readonly revisions: readonly BudgetRevision[];
  /** Why nothing was written, when that was refused rather than a no-op. */
  readonly refused?: string | undefined;
}

const refuse = (plan: BudgetYear, why: string): SaveOutcome => ({
  plan,
  written: [],
  skipped: [],
  revisions: [],
  refused: why,
});

function monthsIn(month: number, scope: PlanScope): number[] {
  if (scope === "month") return [month];
  const from = scope === "rest" ? month : 1;
  return Array.from({ length: 13 - from }, (_, i) => from + i);
}

function withRevision(
  history: Readonly<Record<string, readonly BudgetRevision[]>>,
  month: number,
  revision: BudgetRevision,
): Record<string, readonly BudgetRevision[]> {
  const key = String(month);
  return { ...history, [key]: [...(history[key] ?? []), revision].slice(-MAX_REVISIONS) };
}

/**
 * Whether the month the owner is on can take this change, before anything is
 * written. A closed month takes a correction only on its own and with a reason.
 */
function gate(plan: BudgetYear, year: number, month: number, scope: PlanScope, asOf: IsoDate, reason: string) {
  const lock = monthLock(year, month, asOf);
  if (lock.state !== "closed") return { lock, refused: undefined };
  const name = `${monthName(month)} ${year}`;
  if (scope !== "month") {
    return {
      lock,
      refused: `${name} is closed, so it can only be corrected on its own. Pick "only" and give a reason.`,
    };
  }
  if (reason.length < MIN_REASON) {
    return {
      lock,
      refused: `${name} is closed. Say why it needs correcting, and the correction is kept with the reason.`,
    };
  }
  void plan;
  return { lock, refused: undefined };
}

/** The two tracks for a month, or for several (B1 to B6, B8). */
export function saveTracks(
  plan: BudgetYear,
  year: number,
  month: number,
  value: { readonly spending: Centavos; readonly billsSubs: Centavos },
  scope: PlanScope,
  asOf: IsoDate,
  at: string,
  reason = "",
): SaveOutcome {
  const why = reason.trim();
  const { lock, refused } = gate(plan, year, month, scope, asOf, why);
  if (refused) return refuse(plan, refused);

  const spending = [...plan.spending];
  const billsSubs = [...plan.billsSubs];
  let history: Readonly<Record<string, readonly BudgetRevision[]>> = plan.revisions ?? {};
  const written: number[] = [];
  const skipped: number[] = [];
  const revisions: BudgetRevision[] = [];

  for (const m of monthsIn(month, scope)) {
    const state = m === month ? lock.state : monthLock(year, m, asOf).state;
    if (m !== month && state !== "open") {
      skipped.push(m);
      continue;
    }
    const i = m - 1;
    const was = { spending: spending[i] ?? 0, billsSubs: billsSubs[i] ?? 0 };
    if (was.spending === value.spending && was.billsSubs === value.billsSubs) continue;

    spending[i] = Math.max(0, value.spending);
    billsSubs[i] = Math.max(0, value.billsSubs);
    const revision: BudgetRevision = {
      at,
      what: "tracks",
      spending: spending[i],
      billsSubs: billsSubs[i],
      wasSpending: was.spending,
      wasBillsSubs: was.billsSubs,
      when: state,
      ...(why && m === month ? { reason: why.slice(0, 280) } : {}),
    };
    history = withRevision(history, m, revision);
    written.push(m);
    revisions.push(revision);
  }

  return {
    plan: {
      ...plan,
      spending: spending as unknown as Amounts,
      billsSubs: billsSubs as unknown as Amounts,
      ...(Object.keys(history).length > 0 ? { revisions: history } : {}),
    },
    written,
    skipped,
    revisions,
  };
}

/** A limit for one kind of spending, under the same rules as the tracks (B7). */
export function saveLimit(
  plan: BudgetYear,
  year: number,
  month: number,
  name: string,
  value: Centavos,
  scope: PlanScope,
  asOf: IsoDate,
  at: string,
  reason = "",
): SaveOutcome {
  const key = name.trim();
  if (!key) return refuse(plan, "Pick a kind of spending first.");
  const why = reason.trim();
  const { lock, refused } = gate(plan, year, month, scope, asOf, why);
  if (refused) return refuse(plan, refused);

  const amounts = [...(plan.categories?.[key] ?? NOTHING)];
  let history: Readonly<Record<string, readonly BudgetRevision[]>> = plan.revisions ?? {};
  const written: number[] = [];
  const skipped: number[] = [];
  const revisions: BudgetRevision[] = [];

  for (const m of monthsIn(month, scope)) {
    const state = m === month ? lock.state : monthLock(year, m, asOf).state;
    if (m !== month && state !== "open") {
      skipped.push(m);
      continue;
    }
    const i = m - 1;
    const was = amounts[i] ?? 0;
    const next = Math.max(0, value);
    if (was === next) continue;

    amounts[i] = next;
    const revision: BudgetRevision = {
      at,
      what: "limit",
      name: key,
      limit: next,
      wasLimit: was,
      when: state,
      ...(why && m === month ? { reason: why.slice(0, 280) } : {}),
    };
    history = withRevision(history, m, revision);
    written.push(m);
    revisions.push(revision);
  }

  const categories: Record<string, Amounts> = { ...(plan.categories ?? {}) };
  if (amounts.every((v) => v === 0)) delete categories[key];
  else categories[key] = amounts as unknown as Amounts;

  const { categories: _replaced, ...rest } = plan;
  return {
    plan: {
      ...rest,
      ...(Object.keys(categories).length > 0 ? { categories } : {}),
      ...(Object.keys(history).length > 0 ? { revisions: history } : {}),
    },
    written,
    skipped,
    revisions,
  };
}

/** A month's changes, newest first. */
export function monthHistory(plan: BudgetYear | undefined, month: number): BudgetRevision[] {
  return [...(plan?.revisions?.[String(month)] ?? [])].reverse();
}

/** Put back what the month's last change replaced, while the month still takes changes (B3). */
export function undoLast(
  plan: BudgetYear,
  year: number,
  month: number,
  asOf: IsoDate,
  at: string,
): SaveOutcome {
  const last = monthHistory(plan, month)[0];
  if (!last) return refuse(plan, `Nothing has changed in ${monthName(month)} ${year} to undo.`);
  if (monthLock(year, month, asOf).state === "closed") {
    return refuse(plan, `${monthName(month)} ${year} is closed. Correct it with a reason instead.`);
  }
  const reason = "Undid the last change";
  return last.what === "tracks"
    ? saveTracks(
        plan,
        year,
        month,
        { spending: last.wasSpending ?? 0, billsSubs: last.wasBillsSubs ?? 0 },
        "month",
        asOf,
        at,
        reason,
      )
    : saveLimit(plan, year, month, last.name ?? "", last.wasLimit ?? 0, "month", asOf, at, reason);
}

/** Whether a month's budget was set after it ended, or corrected once closed. */
export function monthMarks(plan: BudgetYear | undefined, month: number): { late: boolean; corrected: boolean } {
  const list = plan?.revisions?.[String(month)] ?? [];
  return {
    late: list.some((r) => r.when === "grace"),
    corrected: list.some((r) => r.when === "closed"),
  };
}

/** One change, in a sentence. */
export function describeRevision(r: BudgetRevision): string {
  let core: string;
  if (r.what === "limit") {
    const name = r.name ?? "A kind of spending";
    const from = r.wasLimit ?? 0;
    const to = r.limit ?? 0;
    core =
      to === 0
        ? `${name} limit removed`
        : from === 0
          ? `${name} limited to ${formatMoney(to)}`
          : `${name} limit changed from ${formatMoney(from)} to ${formatMoney(to)}`;
  } else {
    const from = (r.wasSpending ?? 0) + (r.wasBillsSubs ?? 0);
    const to = (r.spending ?? 0) + (r.billsSubs ?? 0);
    core =
      from === 0
        ? `Set to ${formatMoney(to)}`
        : to === 0
          ? `Cleared, was ${formatMoney(from)}`
          : `Changed from ${formatMoney(from)} to ${formatMoney(to)}`;
  }
  const when =
    r.when === "closed" ? "Correction: " : "";
  const after = r.when === "grace" ? ", after the month ended" : "";
  const text = `${when}${when ? core.charAt(0).toLowerCase() + core.slice(1) : core}${after}`;
  return r.reason ? `${text}. ${r.reason}` : text;
}

/** For the Activity trail: the month, and the change in a sentence. */
export function revisionSummary(year: number, month: number, r: BudgetRevision): string {
  return `${monthName(month)} ${year} budget: ${describeRevision(r)}.`.replace(/\.\.$/, ".");
}
