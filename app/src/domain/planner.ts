/**
 * The Planner: money the owner means to spend later, and what became of it.
 *
 * The owner, 26 October 2026: "add a feature for plan spending ... I am
 * planning to pay my tuition next month ... can direct pay like I can click
 * already paid ... overthink all like more what ifs". The rules are
 * `docs/16-PLANNER.md` (P1 to P6); this file is them, as code.
 *
 * A plan stores only what the owner decided: what, how much, by when, from
 * where, its kind, and whether it is open, done, skipped or removed. What is
 * paid, whether it is late, early or overdue, and whether the money is there
 * are worked out every time from the entries and the date, so a payment
 * moved to the bin or edited is reflected at once (P4.8) and nothing stored
 * can go stale.
 */
import { addDays, daysBetween, formatMedium, lastOfMonth, MONTH_NAMES } from "./dates";
import { walletBalance } from "./balances";
import { formatMoney, type Centavos } from "./money";
import type { IsoDate, ReferenceLists, Transaction } from "./types";
import type { Account } from "./accounts";

export type PlanStatus = "open" | "done" | "skipped" | "removed";

export interface PlanMove {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** The day it was moved. */
  readonly on: IsoDate;
}

export interface Plan {
  readonly id: string;
  /** What it is for: "Tuition", "New phone". */
  readonly title: string;
  /** What it is planned to cost. */
  readonly amount: Centavos;
  /** The day it is to be paid by. */
  readonly due: IsoDate;
  /** The kind of spending, from the owner's list (School, Food, a bill), or "". */
  readonly item: string;
  /** The wallet it should come out of, or "" for not said. */
  readonly wallet: string;
  /** Saved for in this goal account (`Account.id`), when it is. */
  readonly goalId?: string | undefined;
  /** A need (true) or a want (false): which gives way first when money is short. */
  readonly need: boolean;
  /** Set aside from safe to spend in its month (P5). */
  readonly setAside: boolean;
  readonly notes: string;
  readonly status: PlanStatus;
  /** The entries that paid it, by id. What is paid is read from them, live. */
  readonly entryIds: readonly string[];
  /** Every time its date was moved, oldest first (P4.12). */
  readonly moves: readonly PlanMove[];
  /** The day it was marked done, skipped or removed. */
  readonly closedOn?: IsoDate | undefined;
  /** Why it was skipped or removed, when said. */
  readonly reason?: string | undefined;
  readonly createdOn: IsoDate;
  readonly createdBy: "owner" | "ai";
}

/** What the owner fills in. */
export interface PlanInput {
  readonly title: string;
  readonly amount: Centavos | null;
  readonly due: IsoDate;
  readonly item: string;
  readonly wallet: string;
  readonly goalId?: string | undefined;
  readonly need: boolean;
  readonly setAside: boolean;
  readonly notes: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Without the fields left blank. The database refuses a field set to
 * undefined, so a plan whose goal was taken off must lose the key, not hold
 * an empty one.
 */
export function tidy(plan: Plan): Plan {
  return Object.fromEntries(Object.entries(plan).filter(([, v]) => v !== undefined)) as unknown as Plan;
}

let made = 0;
export const newPlanId = (): string => {
  made += 1;
  return `plan-${Date.now().toString(36)}-${made.toString(36)}`;
};

/** A picker's choices with the heading each sits under, for `Select`'s `groups`. */
export interface Choices {
  readonly options: readonly string[];
  readonly groups: Readonly<Record<string, string>>;
}

function grouped(lists: readonly (readonly [string, readonly string[]])[], keep: string, keepHeading: string): Choices {
  const seen = new Set<string>();
  const options: string[] = [];
  const groups: Record<string, string> = {};
  for (const [heading, names] of lists) {
    for (const raw of names) {
      const name = raw.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      options.push(name);
      groups[name] = heading;
    }
  }
  const kept = keep.trim();
  if (kept && !seen.has(kept.toLowerCase())) {
    options.push(kept);
    groups[kept] = keepHeading;
  }
  return { options, groups };
}

/**
 * What a plan can be filed under, as the Add form files spending: the kinds
 * of spending, then the bills, then the subscriptions, each under its own
 * heading. Stopped bills and subscriptions are left out, and so is Unknown,
 * which is a gap in the ledger and nothing anyone plans to buy. A kind the
 * plan already has stays, at the end, so editing never loses it.
 *
 * The owner, 27 October 2026, on the Planner's Kind list: "Fix the kind, why
 * its a mixed". It was one list, the spending kinds running straight into
 * Globe at Home Wifi, Spotify and Netflix (stopped), with nothing to say
 * which was which.
 */
export function planKinds(reference: Pick<ReferenceLists, "spendingTypes" | "bills" | "subscriptions" | "stopped">, keep = ""): Choices {
  const stopped = new Set((reference.stopped ?? []).map((x) => x.name.trim().toLowerCase()));
  const live = (n: string): boolean => !stopped.has(n.trim().toLowerCase());
  return grouped(
    [
      ["Spending", reference.spendingTypes.map((x) => x.name).filter((n) => n.trim().toLowerCase() !== "unknown")],
      ["Bills", reference.bills.filter(live)],
      ["Subscriptions", reference.subscriptions.filter(live)],
    ],
    keep,
    "This plan's",
  );
}

/** Where a plan is paid from: the spending wallets, then savings; the one the plan has stays, under Goal when it is its goal. */
export function planWallets(reference: Pick<ReferenceLists, "wallets" | "savings">, keep = "", keepHeading = "Goal"): Choices {
  return grouped(
    [
      ["Spending wallets", reference.wallets],
      ["Savings", reference.savings],
    ],
    keep,
    keepHeading,
  );
}

/** A bill or subscription is set aside already every month (P4.16). */
export function isRecurringKind(item: string, reference: Pick<ReferenceLists, "bills" | "subscriptions">): boolean {
  const name = item.trim().toLowerCase();
  return name !== "" && [...reference.bills, ...reference.subscriptions].some((b) => b.trim().toLowerCase() === name);
}

export interface PlanCheck {
  /** Stops the save. */
  readonly problems: readonly string[];
  /** Said, and the save goes ahead. */
  readonly notes: readonly string[];
}

/** What is wrong with a plan as filled in, and what is worth saying about it (P4.14 to P4.17). */
export function checkPlan(
  input: PlanInput,
  context: {
    readonly plans: readonly Plan[];
    readonly reference: Pick<ReferenceLists, "bills" | "subscriptions">;
    readonly asOf: IsoDate;
    /** The plan being edited, so it is not its own duplicate. */
    readonly editing?: string | undefined;
  },
): PlanCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  if (!input.title.trim()) problems.push("Say what it is for.");
  if (input.amount === null || !Number.isInteger(input.amount) || input.amount <= 0) problems.push("Put in how much it will cost.");
  if (!ISO.test(input.due)) problems.push("Pick the day it is to be paid by.");
  if (problems.length > 0) return { problems, notes };
  if (input.due < context.asOf) notes.push(`${formatMedium(input.due)} has already passed. If it is already paid, record the payment instead, so the money leaves its wallet.`);
  const same = context.plans.find(
    (p) => p.id !== context.editing && p.status === "open" && p.title.trim().toLowerCase() === input.title.trim().toLowerCase() && p.due.slice(0, 7) === input.due.slice(0, 7),
  );
  if (same) notes.push(`"${same.title}" is already planned for ${MONTH_NAMES[Number(same.due.slice(5, 7)) - 1]}, ${formatMoney(same.amount)}. Saving this makes a second one.`);
  if (input.setAside && isRecurringKind(input.item, context.reference)) {
    notes.push(`${input.item} is a bill or subscription, already set aside every month. Counting this plan in safe to spend too would set the money aside twice.`);
  }
  if (input.setAside && input.goalId) notes.push("Its money is saved in the goal, apart from the spending wallets, so it is not counted in safe to spend.");
  return { problems, notes };
}

/** A new plan from what was filled in. Call `checkPlan` first. */
export function makePlan(input: PlanInput, asOf: IsoDate, by: "owner" | "ai", id: string = newPlanId()): Plan {
  return tidy({
    id,
    title: input.title.trim(),
    amount: input.amount ?? 0,
    due: input.due,
    item: input.item.trim(),
    wallet: input.wallet.trim(),
    ...(input.goalId ? { goalId: input.goalId } : {}),
    need: input.need,
    // A plan saved in a goal never counts: its money is apart already (P4.17).
    setAside: input.setAside && !input.goalId,
    notes: input.notes.trim(),
    status: "open",
    entryIds: [],
    moves: [],
    createdOn: asOf,
    createdBy: by,
  });
}

/** The plan with what was changed, its history kept. A new date is a move (P4.12). */
export function editPlan(plan: Plan, input: PlanInput, asOf: IsoDate): Plan {
  const moved = input.due !== plan.due ? [...plan.moves, { from: plan.due, to: input.due, on: asOf }] : plan.moves;
  return tidy({
    ...plan,
    title: input.title.trim(),
    amount: input.amount ?? plan.amount,
    due: input.due,
    item: input.item.trim(),
    wallet: input.wallet.trim(),
    goalId: input.goalId || undefined,
    need: input.need,
    setAside: input.setAside && !input.goalId,
    notes: input.notes.trim(),
    moves: moved,
  });
}

export const movePlan = (plan: Plan, to: IsoDate, asOf: IsoDate): Plan =>
  to === plan.due ? plan : { ...plan, due: to, moves: [...plan.moves, { from: plan.due, to, on: asOf }] };

/** Payments linked. Done when they cover it, or when the owner says the last one settled it (P4.5). */
export function linkPayments(plan: Plan, ids: readonly string[], transactions: readonly Transaction[], asOf: IsoDate, settles = false): Plan {
  const entryIds = [...new Set([...plan.entryIds, ...ids])];
  const next = { ...plan, entryIds };
  const paid = paidSoFar(next, transactions);
  return tidy(paid.amount >= plan.amount || settles ? { ...next, status: "done", closedOn: paid.lastOn ?? asOf } : { ...next, status: "open", closedOn: undefined });
}

export const unlinkPayment = (plan: Plan, id: string, transactions: readonly Transaction[]): Plan => {
  const next = { ...plan, entryIds: plan.entryIds.filter((x) => x !== id) };
  return tidy(paidSoFar(next, transactions).amount >= plan.amount ? next : { ...next, status: next.status === "done" ? "open" : next.status, closedOn: next.status === "done" ? undefined : next.closedOn });
};

export const skipPlan = (plan: Plan, asOf: IsoDate, reason = ""): Plan => tidy({ ...plan, status: "skipped", closedOn: asOf, reason: reason.trim() || undefined });
export const removePlan = (plan: Plan, asOf: IsoDate, reason = ""): Plan => tidy({ ...plan, status: "removed", closedOn: asOf, reason: reason.trim() || undefined });
/** Back on the list as it was, its payments kept (P4.10, P4.11). */
export const reopenPlan = (plan: Plan): Plan => tidy({ ...plan, status: "open", closedOn: undefined, reason: undefined });
/** "Plan it again": a copy for a new day, nothing paid (P4.11). */
export const planAgain = (plan: Plan, due: IsoDate, asOf: IsoDate, by: "owner" | "ai"): Plan => tidy({
  ...plan,
  id: newPlanId(),
  due,
  status: "open",
  entryIds: [],
  moves: [],
  closedOn: undefined,
  reason: undefined,
  createdOn: asOf,
  createdBy: by,
});

/** What the linked entries still in the ledger paid, and when the last was. */
export function paidSoFar(plan: Plan, transactions: readonly Transaction[]): { readonly amount: Centavos; readonly lastOn: IsoDate | null; readonly gone: readonly string[] } {
  const byId = new Map(transactions.map((t) => [t.id, t] as const));
  let amount = 0;
  let lastOn: IsoDate | null = null;
  const gone: string[] = [];
  for (const id of plan.entryIds) {
    const t = byId.get(id);
    if (!t) {
      gone.push(id);
      continue;
    }
    amount += t.total;
    if (lastOn === null || t.date > lastOn) lastOn = t.date;
  }
  return { amount, lastOn, gone };
}

export type PlanState = "later" | "soon" | "today" | "overdue" | "partly" | "paid" | "skipped" | "removed";

export interface PlanView {
  readonly plan: Plan;
  readonly state: PlanState;
  readonly paid: Centavos;
  /** What is still to pay. 0 once done. */
  readonly left: Centavos;
  /** Days from today to the due day; negative when it has passed. */
  readonly daysTo: number;
  /** One line: "Due in 5 days", "3 days late", "Paid early, Oct 20". */
  readonly words: string;
  /** Payments that were linked and are no longer in the ledger (P4.8). */
  readonly goneNote: string;
  /** The goal it is saved in, what it holds, and what it takes a month to get there (P4.17). */
  readonly goal: { readonly name: string; readonly holds: Centavos; readonly perMonth: Centavos; readonly missing: boolean } | null;
  /** A plan ahead and not in a goal: what it takes a month, from now, to have it (P4.20). */
  readonly perMonth: Centavos;
  /** Whether it counts in safe to spend now: open, set aside, not in a goal, due this month or before. */
  readonly counts: boolean;
}

const shortDay = (d: IsoDate): string => `${MONTH_NAMES[Number(d.slice(5, 7)) - 1]?.slice(0, 3) ?? ""} ${Number(d.slice(8, 10))}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Whole months from today to a day, at least one. */
function monthsTo(asOf: IsoDate, due: IsoDate): number {
  const m = (Number(due.slice(0, 4)) - Number(asOf.slice(0, 4))) * 12 + (Number(due.slice(5, 7)) - Number(asOf.slice(5, 7)));
  return Math.max(1, m);
}

export function viewOf(
  plan: Plan,
  context: { readonly transactions: readonly Transaction[]; readonly accounts: readonly Account[]; readonly asOf: IsoDate },
): PlanView {
  const { transactions, accounts, asOf } = context;
  const paid = paidSoFar(plan, transactions);
  const daysTo = daysBetween(asOf, plan.due);
  /*
   * Done, but every payment it was marked done with is gone: open again, and
   * said (P4.8). A done plan with no payments at all was settled for nothing
   * on purpose, and stays done.
   */
  const lostPayments = plan.status === "done" && plan.entryIds.length > 0 && paid.amount === 0;
  const status: PlanStatus = lostPayments ? "open" : plan.status;
  const left = status === "done" ? 0 : Math.max(0, plan.amount - paid.amount);
  const goneNote =
    paid.gone.length > 0 ? `${plural(paid.gone.length, "payment")} linked to it ${paid.gone.length === 1 ? "is" : "are"} no longer in the ledger (moved to the bin), so ${paid.gone.length === 1 ? "it does" : "they do"} not count.` : "";

  let state: PlanState;
  let words: string;
  if (status === "removed") {
    state = "removed";
    words = `Removed${plan.closedOn ? ` ${shortDay(plan.closedOn)}` : ""}${plan.reason ? `: ${plan.reason}` : ""}`;
  } else if (status === "skipped") {
    state = "skipped";
    words = `Skipped${plan.closedOn ? ` ${shortDay(plan.closedOn)}` : ""}${plan.reason ? `: ${plan.reason}` : ""}`;
  } else if (status === "done") {
    state = "paid";
    const on = paid.lastOn ?? plan.closedOn ?? asOf;
    const late = daysBetween(plan.due, on);
    const when = late > 0 ? `${plural(late, "day")} late` : late < 0 ? "early" : "on the day";
    const diff = paid.amount - plan.amount;
    words = `Paid ${when}, ${shortDay(on)}${paid.amount > 0 && diff > 0 ? `, ${formatMoney(diff)} more than planned` : paid.amount > 0 && diff < 0 ? `, ${formatMoney(-diff)} less than planned` : ""}`;
  } else if (daysTo < 0) {
    state = "overdue";
    words = `${plural(-daysTo, "day")} late${paid.amount > 0 ? `, ${formatMoney(paid.amount)} of ${formatMoney(plan.amount)} paid` : ""}`;
  } else if (paid.amount > 0) {
    state = "partly";
    words = `Paid ${formatMoney(paid.amount)} of ${formatMoney(plan.amount)}, ${daysTo === 0 ? "rest due today" : `rest due in ${plural(daysTo, "day")}`}`;
  } else if (daysTo === 0) {
    state = "today";
    words = "Due today";
  } else if (daysTo <= 7) {
    state = "soon";
    words = daysTo === 1 ? "Due tomorrow" : `Due in ${plural(daysTo, "day")}`;
  } else {
    state = "later";
    words = daysTo <= 60 ? `Due in ${plural(daysTo, "day")}` : `Due ${MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1]} ${plan.due.slice(0, 4)}`;
  }

  const goalAccount = plan.goalId ? accounts.find((a) => a.id === plan.goalId) : undefined;
  const goal = plan.goalId
    ? goalAccount
      ? (() => {
          const holds = walletBalance(transactions, goalAccount.name);
          const still = Math.max(0, left - holds);
          return { name: goalAccount.name, holds, perMonth: still > 0 && daysTo > 0 ? Math.ceil(still / monthsTo(asOf, plan.due)) : 0, missing: false };
        })()
      : { name: "", holds: 0, perMonth: 0, missing: true }
    : null;
  const open = state !== "paid" && state !== "skipped" && state !== "removed";
  const monthEnd = lastOfMonth(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)));
  return {
    plan,
    state,
    paid: paid.amount,
    left,
    daysTo,
    words,
    goneNote,
    goal,
    perMonth: open && !plan.goalId && daysTo > 31 ? Math.ceil(left / monthsTo(asOf, plan.due)) : 0,
    counts: open && plan.setAside && !plan.goalId && plan.due <= monthEnd && left > 0,
  };
}

export interface PlanGroup {
  readonly key: string;
  /** "Overdue", "This month", "November 2026", "Later". */
  readonly title: string;
  readonly views: readonly PlanView[];
  /** What is left to pay across the group. */
  readonly left: Centavos;
}

/** The open plans, overdue first, then month by month for a year, then later; due order inside each (P4.19). */
export function groupOpen(views: readonly PlanView[], asOf: IsoDate): PlanGroup[] {
  const open = views.filter((v) => v.state !== "paid" && v.state !== "skipped" && v.state !== "removed").sort((a, b) => a.plan.due.localeCompare(b.plan.due) || a.plan.title.localeCompare(b.plan.title));
  const groups = new Map<string, { title: string; views: PlanView[] }>();
  const thisMonth = asOf.slice(0, 7);
  const yearOut = addDays(asOf, 365).slice(0, 7);
  for (const v of open) {
    const month = v.plan.due.slice(0, 7);
    const key = v.state === "overdue" ? "0-overdue" : month === thisMonth ? `1-${month}` : month <= yearOut ? `2-${month}` : "3-later";
    const title =
      key === "0-overdue" ? "Overdue" : key.startsWith("1-") ? "This month" : key === "3-later" ? "Later" : `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
    const g = groups.get(key) ?? { title, views: [] };
    g.views.push(v);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, g]) => ({ key, title: g.title, views: g.views, left: g.views.reduce((s, v) => s + v.left, 0) }));
}

/** Done, skipped and removed, newest first. */
export function closedViews(views: readonly PlanView[]): { readonly done: readonly PlanView[]; readonly removed: readonly PlanView[] } {
  const by = (a: PlanView, b: PlanView): number => (b.plan.closedOn ?? b.plan.due).localeCompare(a.plan.closedOn ?? a.plan.due);
  return {
    done: views.filter((v) => v.state === "paid" || v.state === "skipped").sort(by),
    removed: views.filter((v) => v.state === "removed").sort(by),
  };
}

/** What safe to spend sets aside for plans: what is left of each that counts now (P5). */
export function plansSetAside(views: readonly PlanView[]): { readonly total: Centavos; readonly views: readonly PlanView[] } {
  const counted = views.filter((v) => v.counts).sort((a, b) => a.plan.due.localeCompare(b.plan.due));
  return { total: counted.reduce((s, v) => s + v.left, 0), views: counted };
}

/** The plans open in a month ahead, for what that month needs (P5, `budgetAdvice` `planned`). */
export function plannedIn(views: readonly PlanView[], year: number, month: number): { readonly name: string; readonly amount: Centavos }[] {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return views
    .filter((v) => v.plan.due.slice(0, 7) === key && v.left > 0 && v.state !== "paid" && v.state !== "skipped" && v.state !== "removed" && !v.plan.goalId)
    .map((v) => ({ name: v.plan.title, amount: v.left }));
}

/**
 * Whether the money covers each open plan this month and the overdue ones, in
 * due order, after the bills and debt payments and the plans before it (P4.4).
 * `free` is the wallets less the bills and debt payments still due.
 */
export function coverage(views: readonly PlanView[], free: Centavos): Map<string, Centavos> {
  const short = new Map<string, Centavos>();
  let left = free;
  for (const v of plansSetAside(views).views) {
    left -= v.left;
    if (left < 0) short.set(v.plan.id, Math.min(v.left, -left));
  }
  return short;
}

/**
 * Entries that may be a plan's payment, best first: not linked to any plan,
 * spending, dated from a week before it was planned to two months after it
 * was due (P4.7, P4.9). One that only shares the plan's kind must be close
 * to what is left of it (within a fifth) and dated after the plan was made;
 * one that names the plan (a word of its title) may be a part of it, a
 * quarter or more. A PHP 300.00 club fee
 * filed as School was offered as the PHP 9,000.00 tuition (owner's screen,
 * 27 October 2026).
 */
export function likelyPayments(plan: Plan, transactions: readonly Transaction[], allPlans: readonly Plan[]): Transaction[] {
  const linked = new Set(allPlans.flatMap((p) => p.entryIds));
  const words = plan.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  const from = addDays(plan.createdOn < plan.due ? plan.createdOn : plan.due, -7);
  const to = addDays(plan.due, 60);
  const left = Math.max(0, plan.amount - paidSoFar(plan, transactions).amount) || plan.amount;
  const scored = transactions
    .filter((t) => t.type === "Spending" && !linked.has(t.id) && t.date >= from && t.date <= to)
    .map((t) => {
      const text = `${t.item} ${t.description}`.toLowerCase();
      const sameKind = Boolean(plan.item) && t.item.trim().toLowerCase() === plan.item.trim().toLowerCase();
      const saysIt = words.some((w) => text.includes(w));
      const close = t.total === left ? 3 : Math.abs(t.total - left) <= left * 0.2 ? 2 : t.total < left && t.total * 4 >= left ? 1 : 0;
      // Only the kind in common: it must also come after the plan was made.
      const fits = saysIt ? close >= 1 : sameKind && close >= 2 && t.date >= plan.createdOn;
      return { t, score: (sameKind ? 2 : 0) + (saysIt ? 2 : 0) + close, fits };
    })
    .filter((s) => s.fits)
    .sort((a, b) => b.score - a.score || Math.abs(daysBetween(plan.due, a.t.date)) - Math.abs(daysBetween(plan.due, b.t.date)));
  return scored.slice(0, 6).map((s) => s.t);
}

/** "Moved twice, first planned for Nov 15". */
export function movesWords(plan: Plan): string {
  if (plan.moves.length === 0) return "";
  const first = plan.moves[0]!.from;
  return `Moved ${plan.moves.length === 1 ? "once" : plan.moves.length === 2 ? "twice" : `${plan.moves.length} times`}, first planned for ${formatMedium(first)}`;
}

/** One line for the activity trail and the chat. */
export function planLine(plan: Plan): string {
  return `${plan.title}, ${formatMoney(plan.amount)}, by ${formatMedium(plan.due)}${plan.item ? `, ${plan.item}` : ""}${plan.wallet ? `, from ${plan.wallet}` : ""}`;
}

/**
 * The kind of spending a plan's name usually is, from the owner's own
 * entries: "Tuition" is School when the entries that mention tuition are
 * School. Null when the entries say nothing about it.
 */
export function kindFromHistory(title: string, transactions: readonly Transaction[], kinds: readonly string[]): string | null {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  const exact = kinds.find((k) => k.trim().toLowerCase() === title.trim().toLowerCase());
  if (exact) return exact;
  if (words.length === 0) return null;
  const count = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "Spending" || !t.item.trim()) continue;
    const text = `${t.item} ${t.description}`.toLowerCase();
    if (words.some((w) => text.includes(w))) count.set(t.item, (count.get(t.item) ?? 0) + 1);
  }
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 1 && kinds.includes(best[0]) ? best[0] : null;
}

/**
 * The wallet to pay from when the plan names none: the one this kind
 * usually comes out of, else the spending wallet that holds enough, else the
 * one that holds the most. Said on the form, so it is a suggestion, not a
 * choice made behind the owner's back.
 */
export function walletToPayFrom(plan: Pick<Plan, "wallet" | "item">, amount: Centavos, transactions: readonly Transaction[], wallets: readonly string[]): string {
  if (plan.wallet) return plan.wallet;
  const used = new Map<string, number>();
  for (const t of transactions) {
    if (t.type === "Spending" && plan.item && t.item === plan.item && wallets.includes(t.fromWallet)) used.set(t.fromWallet, (used.get(t.fromWallet) ?? 0) + 1);
  }
  const usual = [...used].sort((a, b) => b[1] - a[1])[0]?.[0];
  const held = wallets.map((w) => ({ w, b: walletBalance(transactions, w) })).sort((a, b) => b.b - a.b);
  if (usual && walletBalance(transactions, usual) >= amount) return usual;
  return held.find((x) => x.b >= amount)?.w ?? usual ?? held[0]?.w ?? "";
}
