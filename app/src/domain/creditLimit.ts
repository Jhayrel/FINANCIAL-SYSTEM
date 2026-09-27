/**
 * A credit line's limit, as the lender sets it over time.
 *
 * The owner, 27 September 2026: "in some banks they have credit limit like
 * mine in maya credit its 4000 ... they are imposing credit limit then it
 * grows over time ... but only in selected banks you cannot impose credit
 * limit if its personal or maybe business". So:
 *
 *   - Only a credit line from a lender takes a limit. A loan between people,
 *     money handled on someone's behalf and a bank loan with a fixed amount
 *     have none (a loan's `creditLimit` is its principal, see `debtForms.ts`).
 *   - The limit is a dated list. Raising it adds a step from the day the
 *     lender raised it, so an old borrowing is judged by the limit it had.
 *   - Lenders count different things against it. Rule D3 counts everything
 *     owed, fees included, and that stays the default. The owner's own
 *     ledger shows Maya counting only what was borrowed: on 20 September it
 *     lent ₱2,000.00 more with ₱2,151.03 already owed on a ₱4,000.00 limit,
 *     which the fees would have made impossible. So each line says which.
 *
 * Nothing here is stored except the steps and that choice. What is used,
 * what is left and whether the limit is reached are worked out from the
 * rows, like every other figure in the ledger.
 */

import { formatMoney, type Centavos } from "./money";
import type { Debt } from "./debt";
import type { IsoDate, Transaction } from "./types";

/** The limit from one day on, until the next step. */
export interface LimitStep {
  readonly from: IsoDate;
  readonly amount: Centavos;
}

/**
 * What the lender counts against the limit.
 *
 * `owed`: everything owed, fees and charges included (rule D3, the default).
 * `borrowed`: only what was borrowed and not yet paid back. Payments clear
 * the fees first, as lenders apply them.
 */
export type LimitCounts = "borrowed" | "owed";

export const LIMIT_COUNTS_LABEL: Record<LimitCounts, string> = {
  owed: "Everything owed, fees too",
  borrowed: "Only what was borrowed",
};

/** A share of the limit used from which it is called close. */
export const NEAR_LIMIT = 0.8;

/** Whether a debt can carry a limit at all: a credit line you owe a lender. */
export function takesLimit(debt: Debt): boolean {
  return (debt.form ?? "credit-line") === "credit-line" && debt.kind === "payable" && debt.counterpartyType !== "person";
}

/** Every limit the lender has set, oldest first. A line set up before the list existed has one step. */
export function limitSteps(debt: Debt): LimitStep[] {
  if (!takesLimit(debt)) return [];
  const listed = (debt.limits ?? []).filter((s) => s.amount > 0 && s.from);
  if (listed.length > 0) return [...listed].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return debt.creditLimit && debt.creditLimit > 0 ? [{ from: debt.openedDate, amount: debt.creditLimit }] : [];
}

/**
 * The limit on a day, or null when the line has none.
 *
 * Before the first step the first one is used: that is the earliest limit
 * the owner knows of, and saying there was none would call every early
 * borrowing unlimited.
 */
export function limitOn(debt: Debt, date: IsoDate): Centavos | null {
  const steps = limitSteps(debt);
  if (steps.length === 0) return null;
  let found = steps[0]!.amount;
  for (const s of steps) if (s.from <= date) found = s.amount;
  return found;
}

/** What is used against the limit after each of a line's rows, oldest first. */
export function usedAfterEach(debt: Debt, rows: readonly Transaction[]): Map<string, Centavos> {
  const counts = debt.limitCounts ?? "owed";
  let borrowed = 0;
  let fees = 0;
  const out = new Map<string, Centavos>();
  const mine = rows
    .filter((t) => t.debtId === debt.id)
    .sort((a, b) => (a.date === b.date ? a.recordNumber - b.recordNumber : a.date < b.date ? -1 : 1));
  for (const t of mine) {
    switch (t.debtEffect) {
      case "draw":
        borrowed += t.amount;
        break;
      case "charge":
        fees += t.amount;
        break;
      case "repay":
      case "writeoff": {
        // Fees first, then what was borrowed: the order lenders apply a payment in.
        const toFees = Math.min(fees, t.amount);
        fees -= toFees;
        borrowed = Math.max(0, borrowed - (t.amount - toFees));
        break;
      }
      default:
        // Interest paid from a wallet never touches what is owed, nor the limit.
        break;
    }
    out.set(t.id, counts === "borrowed" ? borrowed : borrowed + fees);
  }
  return out;
}

/** What is used against the limit on a day. */
export function usedOn(debt: Debt, rows: readonly Transaction[], date: IsoDate): Centavos {
  const upTo = rows.filter((t) => t.debtId === debt.id && t.date <= date);
  const each = usedAfterEach(debt, upTo);
  let last = 0;
  for (const v of each.values()) last = v;
  return last;
}

export type RoomState = "ok" | "near" | "reached" | "over";

/** Where a line stands against its limit. */
export interface CreditRoom {
  readonly limit: Centavos;
  readonly used: Centavos;
  /** Never below zero. */
  readonly available: Centavos;
  /** How far past the limit, or zero. */
  readonly over: Centavos;
  /** Used over the limit, 0 and up. */
  readonly share: number;
  readonly state: RoomState;
  readonly counts: LimitCounts;
  /** The latest time the lender changed the limit, when it has. */
  readonly lastChange?: { readonly from: IsoDate; readonly amount: Centavos; readonly before: Centavos } | undefined;
}

export function roomStateOf(used: Centavos, limit: Centavos): RoomState {
  if (used > limit) return "over";
  if (used === limit) return "reached";
  return used / limit >= NEAR_LIMIT ? "near" : "ok";
}

/** A line's room on a day, or null when it has no limit. */
export function creditRoom(debt: Debt, rows: readonly Transaction[], asOf: IsoDate): CreditRoom | null {
  const limit = limitOn(debt, asOf);
  if (limit === null || limit <= 0) return null;
  const used = usedOn(debt, rows, asOf);
  const steps = limitSteps(debt).filter((s) => s.from <= asOf);
  const last = steps.length >= 2 ? steps[steps.length - 1] : undefined;
  const before = steps.length >= 2 ? steps[steps.length - 2] : undefined;
  return {
    limit,
    used,
    available: Math.max(0, limit - used),
    over: Math.max(0, used - limit),
    share: used / limit,
    state: roomStateOf(used, limit),
    counts: debt.limitCounts ?? "owed",
    lastChange: last && before ? { from: last.from, amount: last.amount, before: before.amount } : undefined,
  };
}

/** The room in one line: "₱600.00 of ₱4,000.00 left to borrow", "Limit reached", "₱302.06 over the limit". */
export function roomWords(room: CreditRoom): string {
  if (room.state === "over") return `${formatMoney(room.over)} over the ${formatMoney(room.limit)} limit`;
  if (room.state === "reached") return `Limit reached: all ${formatMoney(room.limit)} used`;
  return `${formatMoney(room.available)} of ${formatMoney(room.limit)} left to borrow`;
}

/**
 * The limit set to an amount from a day, as the Details form saves it.
 *
 * A line with only the old single figure keeps it as its first step, from
 * the day the line opened, so raising 4,000 to 5,000 keeps the 4,000 for
 * the months it applied to. A step on the same day is replaced. `null`
 * takes the limit off altogether: the lender sets none.
 */
export function withLimit(debt: Debt, amount: Centavos | null, from: IsoDate): Debt {
  if (amount === null || amount <= 0) {
    const { limits: _limits, creditLimit: _limit, limitCounts: _counts, ...rest } = debt;
    return rest as Debt;
  }
  const steps = limitSteps(debt).filter((s) => s.from !== from);
  const next = [...steps, { from, amount }].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { ...debt, limits: next, creditLimit: next[next.length - 1]!.amount };
}

/** One step taken out, for a limit entered by mistake. */
export function withoutStep(debt: Debt, from: IsoDate): Debt {
  const steps = limitSteps(debt).filter((s) => s.from !== from);
  if (steps.length === 0) return withLimit(debt, null, from);
  return { ...debt, limits: steps, creditLimit: steps[steps.length - 1]!.amount };
}

/**
 * What would be used after one more movement, for a form that has not saved it.
 *
 * The Add form shows it beside what is owed, so a borrowing that would pass
 * the limit, and a payment that frees it, say so before they are saved.
 */
export function usedAfterOne(
  debt: Debt,
  rows: readonly Transaction[],
  move: { readonly date: IsoDate; readonly effect: "draw" | "repay" | "charge" | "writeoff"; readonly amount: Centavos; readonly charges?: Centavos | null | undefined },
): Centavos {
  const last = rows.reduce((n, t) => Math.max(n, t.recordNumber), 0);
  const row = (id: string, effect: Transaction["debtEffect"], amount: Centavos, n: number): Transaction => ({
    id,
    recordNumber: n,
    date: move.date,
    type: "Debt",
    fromWallet: "",
    toWallet: "",
    category: "",
    item: debt.name,
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Paid",
    debtId: debt.id,
    debtEffect: effect,
  });
  // After everything else on that day, as the row would be once saved.
  const extra = [row("__this", move.effect, move.amount, last + 1)];
  if (move.effect === "draw" && (move.charges ?? 0) > 0) extra.push(row("__fees", "charge", move.charges ?? 0, last + 2));
  const upTo = rows.filter((t) => t.debtId === debt.id && t.date <= move.date);
  const each = usedAfterEach(debt, [...upTo, ...extra]);
  return each.get(extra[extra.length - 1]!.id) ?? 0;
}
