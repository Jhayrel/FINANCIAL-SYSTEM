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
import { wholeRows } from "./covers";
import { formatMoney, type Centavos } from "./money";
import type { IsoDate, ReferenceLists, Transaction } from "./types";
import type { Account } from "./accounts";

export type PlanStatus = "open" | "done" | "skipped" | "removed";

/**
 * How much of the day is known (owner, 27 October 2026: "WHAT IF I DONT HAVE
 * A DAY SPECIFICS YET LIKE NO DATE LIKE NO IDEA WHEN"). A day; a month, with
 * `due` its last day ("sometime in November", counted in November); a year,
 * with `due` its last day; or none, with `due` NO_DATE, counted nowhere until
 * it has one. Absent is a day, as every plan before this was.
 */
export type DueKind = "day" | "month" | "year" | "none";

/** The day a plan with no date holds: after every real day, so it is never due, never counted, and sorts last. */
export const NO_DATE: IsoDate = "9999-12-31";

export const dueKindOf = (p: { readonly dueKind?: DueKind | undefined }): DueKind => p.dueKind ?? "day";

/** The `due` a kind of date stands for: a month's or a year's last day, or NO_DATE. */
export function dueFor(kind: DueKind, due: IsoDate): IsoDate {
  if (kind === "none") return NO_DATE;
  if (!ISO.test(due)) return due;
  if (kind === "month") return lastOfMonth(Number(due.slice(0, 4)), Number(due.slice(5, 7)));
  if (kind === "year") return `${due.slice(0, 4)}-12-31`;
  return due;
}

/** The end of the month after this one: where "next month" lands. */
export function nextMonthEnd(asOf: IsoDate): IsoDate {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  return m === 12 ? lastOfMonth(y + 1, 1) : lastOfMonth(y, m + 1);
}

/** When it is to be paid, in words: "November 15, 2026", "Sometime in November 2026", "Sometime in 2027", "No date yet". */
export function whenOf(plan: { readonly due: IsoDate; readonly dueKind?: DueKind | undefined }): string {
  const kind = dueKindOf(plan);
  if (kind === "none" || plan.due === NO_DATE) return "No date yet";
  if (kind === "month") return `Sometime in ${MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1] ?? ""} ${plan.due.slice(0, 4)}`;
  if (kind === "year") return `Sometime in ${plan.due.slice(0, 4)}`;
  return formatMedium(plan.due);
}

/** "by November 15, 2026", "sometime in November 2026", "with no date yet": a sentence's when. */
export function byWhen(plan: { readonly due: IsoDate; readonly dueKind?: DueKind | undefined }): string {
  const when = whenOf(plan);
  if (when === "No date yet") return "with no date yet";
  return dueKindOf(plan) === "day" ? `by ${when}` : when.charAt(0).toLowerCase() + when.slice(1);
}

/** Where a plan counts, for a card's row: "Counted in November 2026", "Not counted until it has a date". */
export function countedWords(plan: Pick<Plan, "due" | "dueKind" | "setAside" | "goalId"> & { readonly into?: string | undefined; readonly debtId?: string | undefined }): string {
  if (paysDebt(plan) && !plan.setAside) return "Not counted: the loan's own payment is";
  if (isSave(plan)) {
    if (!plan.setAside) return "Not held back";
    if (plan.due === NO_DATE) return "Held back once it has a date";
    return dueKindOf(plan) === "day" ? "Held back in its month" : `Held back in ${MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1] ?? ""} ${plan.due.slice(0, 4)}`;
  }
  if (!plan.setAside || plan.goalId) return "Not counted";
  if (plan.due === NO_DATE) return "Not counted until it has a date";
  return dueKindOf(plan) === "day" ? "Counted in its month" : `Counted in ${MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1] ?? ""} ${plan.due.slice(0, 4)}`;
}

/** The sentence a card says about where a new plan counts. With `asOf`, a day already gone is said first. */
export function countsSentence(plan: Pick<Plan, "due" | "dueKind" | "setAside" | "goalId" | "title"> & { readonly into?: string | undefined; readonly debtId?: string | undefined }, asOf?: IsoDate): string {
  if (paysDebt(plan)) {
    if (asOf && plan.due !== NO_DATE && plan.due < asOf) return `${whenOf(plan)} has already passed: kept as a plan, it shows as overdue until the repayment is recorded. Paid already? Link the repayment on the Planner, so it is not entered twice.`;
    if (plan.due === NO_DATE) return "With no date it is counted nowhere until it has one.";
    return plan.setAside
      ? `Safe to spend holds the money back in ${dueKindOf(plan) === "day" ? "its month" : `${MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1] ?? ""}`}. A repayment is not spending: no budget counts it.`
      : "Not counted in safe to spend: a loan with a due day has its payment held back there already. A repayment is not spending: no budget counts it.";
  }
  if (isSave(plan)) {
    if (asOf && plan.due !== NO_DATE && plan.due < asOf) return `${whenOf(plan)} has already passed: kept as a plan, it shows as overdue until the money is moved. Moved already? Link the transfer on the Planner, so it is not entered twice.`;
    if (plan.due === NO_DATE) return `With no date it is held back nowhere until it has one: say "move the ${plan.title.toLowerCase()} plan to December", or a day, when you know.`;
    return plan.setAside
      ? `Safe to spend holds the money back in ${dueKindOf(plan) === "day" ? "its month" : `${MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1] ?? ""}`}, so it is there to move. It is saving, not spending: no budget counts it.`
      : "Nothing is held back from safe to spend for it, and no budget counts it: it is saving, not spending.";
  }
  if (asOf && plan.due !== NO_DATE && plan.due < asOf)
    return `${whenOf(plan)} has already passed: kept as a plan, it shows as overdue until it is paid. Already paid? Say "I paid the ${plan.title.toLowerCase()} plan", or link the entry on the Planner, so nothing is entered twice.`;
  if (plan.due === NO_DATE) return `With no date it is counted nowhere, not in safe to spend and not in a month's budget, until it has one: say "move the ${plan.title.toLowerCase()} plan to December", or a day, when you know.`;
  if (!plan.setAside || plan.goalId) return "It is not counted in safe to spend.";
  return dueKindOf(plan) === "day"
    ? "It is counted in safe to spend in its month, like a bill still to pay."
    : `It is counted in ${MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1] ?? ""}'s safe to spend; set the day when you know.`;
}

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
  /** The day it is to be paid by: a month's or year's last day for those, NO_DATE for none (`dueKind`). */
  readonly due: IsoDate;
  /** How much of the date is known; absent is a day. */
  readonly dueKind?: DueKind | undefined;
  /** The kind of spending, from the owner's list (School, Food, a bill), or "". */
  readonly item: string;
  /** The wallet it should come out of, or "" for not said. */
  readonly wallet: string;
  /** Saved for in this goal account (`Account.id`), when it is. */
  readonly goalId?: string | undefined;
  /**
   * A plan to save or move money, not to spend it: the account or goal the
   * money goes into, by name, as entries name wallets ("next week I want to
   * deposit 3000 to Maya Bank", owner, 2 November 2026). `wallet` is where it
   * comes from. Paid by a transfer into it, never by spending; it is not in
   * any budget's spending (P11, docs/16-PLANNER.md). Absent for a plan to spend.
   */
  readonly into?: string | undefined;
  /**
   * A plan to pay a loan or credit line (P12; owner, 3 November 2026: "what
   * about if I want to pay a loan"): the debt line, by id. Paid by a
   * repayment on that line, never by spending; not in any budget's spending.
   * Absent for a plan to spend or to save.
   */
  readonly debtId?: string | undefined;
  /** A need (true) or a want (false): which gives way first when money is short. */
  readonly need: boolean;
  /** Set aside from safe to spend in its month (P5). For a plan to save: held back until it is moved. */
  readonly setAside: boolean;
  readonly notes: string;
  readonly status: PlanStatus;
  /** The entries that paid it, by id. What is paid is read from them, live. */
  readonly entryIds: readonly string[];
  /** Every time its date was moved, oldest first (P4.12). */
  readonly moves: readonly PlanMove[];
  /** The day it was marked done, skipped or removed. */
  readonly closedOn?: IsoDate | undefined;
  /**
   * Marked done by the owner for less than planned ("That settles it",
   * P4.5). Without it, a done plan whose linked payment is edited down in
   * the Database opens again with what is left (P4.8, 3 November 2026).
   */
  readonly settled?: true | undefined;
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
  /** Absent is a day. */
  readonly dueKind?: DueKind | undefined;
  readonly item: string;
  readonly wallet: string;
  readonly goalId?: string | undefined;
  /** Where the money goes, for a plan to save or move it (`Plan.into`). */
  readonly into?: string | undefined;
  /** The form's "Save or move money" picked, before an account is: checked as a plan to save. */
  readonly saving?: boolean | undefined;
  /** The debt line a plan to pay a debt pays (`Plan.debtId`). */
  readonly debtId?: string | undefined;
  /** The form's "To pay a debt" picked, before a line is: checked as one. */
  readonly paying?: boolean | undefined;
  readonly need: boolean;
  readonly setAside: boolean;
  readonly notes: string;
}

/**
 * A plan's fields as the form or the chat fills them in, every one of them.
 * Built by hand in three places in the chat, each left out `into`: a plan to
 * save changed by words ("I am planning to save 1500 from my salary this
 * month") or by amount ("make the deposit plan 2000") came back a plan to
 * spend, with Pay instead of Move it (owner's phone, 3 November 2026).
 */
export function inputOf(plan: Plan, over: Partial<PlanInput> = {}): PlanInput {
  return {
    title: plan.title,
    amount: plan.amount,
    due: plan.due,
    dueKind: plan.dueKind,
    item: plan.item,
    wallet: plan.wallet,
    goalId: plan.goalId,
    into: plan.into,
    debtId: plan.debtId,
    need: plan.need,
    setAside: plan.setAside,
    notes: plan.notes,
    ...over,
  };
}

/** A plan to save or move money into an account or goal, not to spend it (P11). */
export const isSave = (p: { readonly into?: string | undefined }): boolean => Boolean(p.into?.trim());

/** A plan to pay a loan or credit line, not to spend or to save (P12). */
export const paysDebt = (p: { readonly debtId?: string | undefined; readonly into?: string | undefined }): boolean => Boolean(p.debtId?.trim()) && !isSave(p);

/**
 * Whether an entry is the kind that pays this plan: money moved into its
 * account for a plan to save, a repayment on its line for a plan to pay a
 * debt, anything else for a plan to spend. A repayment saves its fees as rows
 * of their own; only the payment is linked, and only it counts (P11, P12).
 */
export function paysPlan(plan: Pick<Plan, "into" | "debtId">, t: Pick<Transaction, "type" | "toWallet" | "debtId" | "debtEffect">): boolean {
  if (isSave(plan)) return (t.type === "Transfer" || t.type === "Revenue") && t.toWallet.trim().toLowerCase() === (plan.into ?? "").trim().toLowerCase();
  if (paysDebt(plan)) return t.type === "Debt" && t.debtId === plan.debtId && t.debtEffect === "repay";
  return true;
}

/**
 * Whether saving it takes money out of the spending wallets, so safe to spend
 * should hold it back until it is moved: into savings or a goal, from a
 * spending wallet or from none said. Moving it between spending wallets, or
 * out of savings into one, takes nothing out of them.
 */
export function savesOutOfSpending(plan: { readonly into?: string | undefined; readonly wallet: string }, spendingWallets: readonly string[]): boolean {
  if (!isSave(plan)) return false;
  const lower = (w: string): string => w.trim().toLowerCase();
  const spending = new Set(spendingWallets.map(lower));
  return !spending.has(lower(plan.into ?? "")) && (!plan.wallet.trim() || spending.has(lower(plan.wallet)));
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

/** Where a plan to save can put its money: savings, the open goals, and the spending wallets (P11). */
export function planInto(reference: Pick<ReferenceLists, "wallets" | "savings">, accounts: readonly Pick<Account, "name" | "kind" | "archived">[], keep = ""): Choices {
  return grouped(
    [
      ["Savings", reference.savings],
      ["Goals", accounts.filter((a) => a.kind === "goal" && !a.archived).map((a) => a.name)],
      ["Spending wallets", reference.wallets],
    ],
    keep,
    "This plan's",
  );
}

/**
 * Plans after a rename in Settings: a wallet's name on the plans paid from
 * it, a kind's on the plans filed under it. Entries, debts and limits were
 * renamed and plans were not, so a plan kept the old name and its wallet or
 * kind stopped matching (27 October 2026 sync audit). The same array back
 * when nothing names it.
 */
export function renamePlans(plans: readonly Plan[], field: "wallet" | "item", from: string, to: string): readonly Plan[] {
  const same = (v: string | undefined): boolean => (v ?? "").trim().toLowerCase() === from.trim().toLowerCase();
  // An account renamed is renamed where a plan saves into it too.
  const intoToo = field === "wallet";
  if (!plans.some((p) => same(p[field]) || (intoToo && isSave(p) && same(p.into)))) return plans;
  return plans.map((p) => {
    const next = same(p[field]) ? { ...p, [field]: to } : p;
    return intoToo && isSave(next) && same(next.into) ? { ...next, into: to } : next;
  });
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
    readonly reference: Pick<ReferenceLists, "bills" | "subscriptions"> & { readonly wallets?: readonly string[] | undefined };
    readonly asOf: IsoDate;
    /**
     * The entries linked to the plan being edited, as payments: a plan to
     * spend is paid by spending, one to save by money moved into its account,
     * so a change from one to the other cannot keep the wrong kind.
     */
    readonly linked?: readonly Transaction[] | undefined;
    /** Whether the plan being edited was a plan to save: the linked payments are checked only when that changes. */
    readonly wasSaving?: boolean | undefined;
    /** Accounts closed: a plan cannot save into one. */
    readonly closedAccounts?: readonly string[] | undefined;
    /** The plan being edited, so it is not its own duplicate. */
    readonly editing?: string | undefined;
    /** Editing a plan already paid or skipped. */
    readonly closed?: boolean | undefined;
    /** What is paid on the plan being edited: its amount may not go below it. */
    readonly paid?: Centavos | undefined;
    /** The day the plan being edited had, to tell a move from a plan left where it was. */
    readonly was?: { readonly due: IsoDate; readonly dueKind?: DueKind | undefined } | undefined;
    /**
     * The debt lines a plan can pay (P12): what is owed on each now, and the
     * payment safe to spend already holds back for it, when it has one.
     */
    readonly debtLines?: readonly { readonly id: string; readonly name: string; readonly archived?: boolean | undefined; readonly owed: Centavos; readonly scheduled: { readonly amount: Centavos; readonly on: IsoDate } | null; readonly dueDay?: number | null | undefined }[] | undefined;
    /** Whether the plan being edited paid a debt: its linked payments are checked when that changes. */
    readonly wasPaying?: boolean | undefined;
  },
): PlanCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  const paying = Boolean(input.paying) || paysDebt(input);
  const saving = !paying && (Boolean(input.saving) || isSave(input));
  if (!input.title.trim()) problems.push("Say what it is for.");
  if (input.amount === null || !Number.isInteger(input.amount) || input.amount <= 0) problems.push(saving ? "Put in how much to move." : paying ? "Put in how much you will pay." : "Put in how much it will cost.");
  /*
   * A plan to pay a debt (P12): it needs the line it pays, and payments
   * already linked must be repayments on it.
   */
  const line = paying ? (context.debtLines ?? []).find((d) => d.id === input.debtId) : undefined;
  if (paying && !input.debtId?.trim()) problems.push("Pick the loan or credit line it pays.");
  else if (paying && context.debtLines && !line) problems.push("That debt line is no longer in Settings. Pick another, or make it a plan to spend.");
  if (paying || context.wasPaying) {
    const changed = context.wasPaying !== undefined && context.wasPaying !== paying;
    const wrong = (context.linked ?? []).filter((t) => (paying ? t.type !== "Debt" || t.debtId !== input.debtId || t.debtEffect !== "repay" : changed));
    if (wrong.length > 0 && (changed || paying)) {
      const list = wrong.map((t) => `#${String(t.recordNumber).padStart(4, "0")}`).join(", ");
      problems.push(
        paying
          ? `${list} ${wrong.length === 1 ? "is" : "are"} linked as its payment, and ${wrong.length === 1 ? "it is not a repayment" : "they are not repayments"} on this line. Unlink ${wrong.length === 1 ? "it" : "them"} on the plan's sheet first, or keep the plan as it was.`
          : `${list} ${wrong.length === 1 ? "is a repayment" : "are repayments"} on a debt, linked as its payment. Unlink ${wrong.length === 1 ? "it" : "them"} on the plan's sheet first, or keep it as a plan to pay that debt.`,
      );
    }
  }
  /*
   * A plan to save or move money (P11): it needs somewhere to go, not the
   * account it comes from, and not one closed in Settings. Payments already
   * linked must be of its own kind: spending does not pay a deposit, nor a
   * transfer into savings a purchase.
   */
  if (saving) {
    const into = (input.into ?? "").trim();
    if (!into) problems.push("Pick the account or goal the money goes into.");
    else if (into.toLowerCase() === input.wallet.trim().toLowerCase()) problems.push(`It goes into ${into} and comes from ${into}: pick another account for one of them.`);
    else if ((context.closedAccounts ?? []).some((a) => a.trim().toLowerCase() === into.toLowerCase())) problems.push(`${into} is closed in Settings. Open it again there, or pick another account.`);
  }
  const no = (n: number): string => `#${String(n).padStart(4, "0")}`;
  const switched = !paying && !context.wasPaying && context.wasSaving !== undefined && context.wasSaving !== saving;
  const wrongKind = switched ? (context.linked ?? []).filter((t) => (saving ? t.type === "Spending" || !t.toWallet.trim() : t.type !== "Spending")) : [];
  if (wrongKind.length > 0) {
    const list = wrongKind.map((t) => no(t.recordNumber)).join(", ");
    problems.push(
      saving
        ? `${list} ${wrongKind.length === 1 ? "is" : "are"} linked as its payment, and ${wrongKind.length === 1 ? "it is" : "they are"} spending. A plan to save is paid by moving money into its account: unlink ${wrongKind.length === 1 ? "it" : "them"} on the plan's sheet first, or keep it as a plan to spend.`
        : `${list} ${wrongKind.length === 1 ? "is" : "are"} linked as its payment, and ${wrongKind.length === 1 ? "it is" : "they are"} money moved between your accounts, not spending. Unlink ${wrongKind.length === 1 ? "it" : "them"} on the plan's sheet first, or keep it as a plan to save.`,
    );
  }
  const kind = dueKindOf(input);
  const due = dueFor(kind, input.due);
  if (!ISO.test(due)) problems.push(kind === "month" ? "Pick the month it is to be paid in." : "Pick the day it is to be paid by.");
  /*
   * Less than is paid on it already: "PHP 250.00 paid of PHP 200.00, Part
   * paid" (27 October 2026 scenario run). Paid in full at exactly what is
   * paid is said, and the Planner marks it paid.
   */
  const paid = context.paid ?? 0;
  if (paid > 0 && input.amount !== null && input.amount < paid) problems.push(`${formatMoney(paid)} is paid on it already. Make the amount ${formatMoney(paid)} or more, or unlink a payment first.`);
  if (problems.length > 0) return { problems, notes };
  if (paid > 0 && input.amount === paid && !context.closed) notes.push(`${formatMoney(paid)} is paid on it already, so at this amount it is paid in full and is marked paid.`);
  // Paid or skipped, then made to cost more: saving does not open it again by itself.
  if (paid > 0 && input.amount !== null && input.amount > paid && context.closed)
    notes.push(`${formatMoney(paid)} is paid on it. Saved at ${formatMoney(input.amount)}, it stays closed; if ${formatMoney(input.amount - paid)} more is still to pay, open it again from its sheet.`);
  /*
   * A day already gone (owner, 27 October 2026: "what if I create a plan but
   * in the past? what if I edit a plan that allready in deadline"). A plan
   * already paid or skipped is a record: its day passing is no news.
   */
  const when = whenOf({ due, dueKind: kind });
  const wasDue = context.was ? dueFor(dueKindOf(context.was), context.was.due) : null;
  if (due < context.asOf && kind !== "none" && !context.closed) {
    if (!context.editing || wasDue === null)
      notes.push(`${when} has already passed. When you add it, you are asked whether it is still to pay (it shows as overdue) or paid already (then link or record the payment, so nothing is entered twice).`);
    else if (wasDue === due) {
      const late = daysBetween(due, context.asOf);
      notes.push(`It was due ${when}, ${late === 1 ? "a day" : `${late} days`} ago, and shows as overdue. Change the day to move it; the move is kept in its history. Paid already? Close this and use Record payment, or link the entry.`);
    } else notes.push(`${when} has passed too, so it would stay overdue. Pick today or a later day to move it.`);
  } else if (context.editing && wasDue !== null && wasDue !== NO_DATE && wasDue < context.asOf && !context.closed && kind !== "none") {
    notes.push(`Moved from ${whenOf({ due: wasDue, dueKind: context.was?.dueKind })} to ${when}; the move is kept in its history, and it is no longer overdue.`);
  }
  const same = context.plans.find(
    (p) => p.id !== context.editing && p.status === "open" && p.title.trim().toLowerCase() === input.title.trim().toLowerCase() && p.due.slice(0, 7) === due.slice(0, 7),
  );
  if (same) notes.push(`"${same.title}" is already planned${same.due === NO_DATE ? ", with no date yet" : ` for ${MONTH_NAMES[Number(same.due.slice(5, 7)) - 1]}`}, ${formatMoney(same.amount)}. Saving this makes a second one.`);
  if (paying && line) {
    if (line.owed <= 0) notes.push(`Nothing is owed on ${line.name} now. The plan is kept, for a borrowing still to come.`);
    else if (input.amount !== null && input.amount > line.owed) notes.push(`That is ${formatMoney(input.amount - line.owed)} more than the ${formatMoney(line.owed)} owed on ${line.name} now.`);
    if (line.scheduled)
      notes.push(
        input.setAside
          ? `${line.name}'s payment of ${formatMoney(line.scheduled.amount)}, due ${formatMedium(line.scheduled.on)}, is held back in safe to spend already. Counting this plan too would hold it back twice.`
          : `${line.name}'s payment of ${formatMoney(line.scheduled.amount)}, due ${formatMedium(line.scheduled.on)}, is held back in safe to spend already, so this plan is not counted there. It keeps the date and the amount you mean to pay.`,
      );
    // With a payment day but nothing owed, nothing is due yet: "has no due day" was said of Maya Credit, due on the 6th (3 November 2026).
    else if (input.setAside && kind !== "none") notes.push(line.dueDay ? `Nothing is due on ${line.name} yet, so safe to spend holds this payment back in its month.` : `${line.name} has no due day, so safe to spend holds this payment back in its month.`);
    notes.push("A repayment is not spending: no budget counts it.");
    return { problems, notes };
  }
  if (saving) {
    const wallets = context.reference.wallets ?? [];
    const into = (input.into ?? "").trim();
    const intoSpending = wallets.some((w) => w.toLowerCase() === into.toLowerCase());
    const fromSpending = !input.wallet.trim() || wallets.some((w) => w.toLowerCase() === input.wallet.trim().toLowerCase());
    if (into && intoSpending && fromSpending) notes.push(`${into} is a spending wallet too, so moving money into it changes nothing in safe to spend: nothing is held back.`);
    else if (into && intoSpending) notes.push(`It adds to your spending money once it is moved into ${into}; safe to spend counts it then, not before.`);
    else if (into && input.setAside && kind !== "none") notes.push(`Safe to spend holds the money back in its month, so it is there to move into ${into}. It is saving, not spending: no budget counts it.`);
    if (kind === "none" && input.setAside) notes.push("With no date it is held back nowhere yet. Give it a month or a day when you know.");
    return { problems, notes };
  }
  if (kind === "none" && input.setAside && !input.goalId) notes.push("With no date it is counted nowhere yet: not in safe to spend, not in a month's budget. Give it a month or a day when you know, and it counts there.");
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
    due: dueFor(dueKindOf(input), input.due),
    ...(dueKindOf(input) !== "day" ? { dueKind: dueKindOf(input) } : {}),
    // A plan to save or to pay a debt has no kind of spending and is paid from no goal (P11, P12).
    item: isSave(input) || paysDebt(input) ? "" : input.item.trim(),
    wallet: input.wallet.trim(),
    ...(input.goalId && !isSave(input) && !paysDebt(input) ? { goalId: input.goalId } : {}),
    ...(isSave(input) ? { into: (input.into ?? "").trim() } : {}),
    ...(paysDebt(input) ? { debtId: (input.debtId ?? "").trim() } : {}),
    need: isSave(input) || paysDebt(input) ? true : input.need,
    // A plan saved in a goal never counts: its money is apart already (P4.17).
    setAside: input.setAside && (isSave(input) || !input.goalId),
    notes: input.notes.trim(),
    status: "open",
    entryIds: [],
    moves: [],
    createdOn: asOf,
    createdBy: by,
  });
}

/**
 * The plan with what was changed, its history kept. A new date is a move
 * (P4.12). With the entries given, an open plan whose amount is brought down
 * to what is paid on it is paid in full, as linking its last payment makes it
 * (P4.5); `checkPlan` stops an amount below that.
 */
export function editPlan(plan: Plan, input: PlanInput, asOf: IsoDate, transactions?: readonly Transaction[]): Plan {
  const kind = dueKindOf(input);
  const due = dueFor(kind, input.due);
  const next = tidy({
    ...plan,
    title: input.title.trim(),
    amount: input.amount ?? plan.amount,
    due,
    dueKind: kind === "day" ? undefined : kind,
    item: isSave(input) || paysDebt(input) ? "" : input.item.trim(),
    wallet: input.wallet.trim(),
    goalId: (!isSave(input) && !paysDebt(input) && input.goalId) || undefined,
    // Changed from a plan to spend to one to save, or back (P11): `checkPlan` stops it while payments of the other kind are linked.
    into: isSave(input) ? (input.into ?? "").trim() : undefined,
    debtId: paysDebt(input) ? (input.debtId ?? "").trim() : undefined,
    need: isSave(input) || paysDebt(input) ? true : input.need,
    setAside: input.setAside && (isSave(input) || !input.goalId),
    notes: input.notes.trim(),
    moves: movesAfter(plan, due, asOf),
  });
  if (!transactions || next.status !== "open" || next.entryIds.length === 0) return next;
  const paid = paidSoFar(next, transactions);
  return paid.amount > 0 && paid.amount >= next.amount ? tidy({ ...next, status: "done", closedOn: paid.lastOn ?? asOf }) : next;
}

/**
 * The moves after a new date: one more when a real day changed. Giving a
 * plan with no date its first one, or taking a date away, is not a move
 * (there was no day to move from, or to).
 */
function movesAfter(plan: Plan, to: IsoDate, asOf: IsoDate): readonly PlanMove[] {
  if (to === plan.due || plan.due === NO_DATE || to === NO_DATE) return plan.moves;
  return [...plan.moves, { from: plan.due, to, on: asOf }];
}

/** To a day, a month, a year, or no date (`kind`, a day when not said). */
export const movePlan = (plan: Plan, to: IsoDate, asOf: IsoDate, kind: DueKind = "day"): Plan => {
  const due = dueFor(kind, to);
  if (due === plan.due && kind === dueKindOf(plan)) return plan;
  return tidy({ ...plan, due, dueKind: kind === "day" ? undefined : kind, moves: movesAfter(plan, due, asOf) });
};

/** Payments linked. Done when they cover it, or when the owner says the last one settled it (P4.5). */
export function linkPayments(plan: Plan, ids: readonly string[], transactions: readonly Transaction[], asOf: IsoDate, settles = false): Plan {
  const entryIds = [...new Set([...plan.entryIds, ...ids])];
  const next = { ...plan, entryIds };
  const paid = paidSoFar(next, transactions);
  const covers = paid.amount >= plan.amount;
  return tidy(covers || settles ? { ...next, status: "done", closedOn: paid.lastOn ?? asOf, settled: covers ? undefined : true } : { ...next, status: "open", closedOn: undefined, settled: undefined });
}

export const unlinkPayment = (plan: Plan, id: string, transactions: readonly Transaction[]): Plan => {
  const next = { ...plan, entryIds: plan.entryIds.filter((x) => x !== id) };
  return tidy(paidSoFar(next, transactions).amount >= plan.amount ? next : { ...next, status: next.status === "done" ? "open" : next.status, closedOn: next.status === "done" ? undefined : next.closedOn });
};

export const skipPlan = (plan: Plan, asOf: IsoDate, reason = ""): Plan => tidy({ ...plan, status: "skipped", closedOn: asOf, reason: reason.trim() || undefined });
export const removePlan = (plan: Plan, asOf: IsoDate, reason = ""): Plan => tidy({ ...plan, status: "removed", closedOn: asOf, reason: reason.trim() || undefined });
/** Back on the list as it was, its payments kept (P4.10, P4.11). */
export const reopenPlan = (plan: Plan): Plan => tidy({ ...plan, status: "open", closedOn: undefined, reason: undefined, settled: undefined });
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
export function paidSoFar(plan: Plan, transactions: readonly Transaction[]): { readonly amount: Centavos; readonly lastOn: IsoDate | null; readonly gone: readonly string[]; readonly elsewhere?: readonly Transaction[] } {
  /*
   * Whole rows: an entry covering several days is spread into a row a day
   * (`spreadCovered`, ids "t1@0", "t1@1") for the daily figures, and the
   * Dashboard reads those. Looked up by the spread ids, the paid ₱9,000.00
   * "Trip to Abra" read as unpaid and was set aside a second time
   * (27 October 2026: ₱11,200.00 on the Dashboard, ₱2,200.00 on the Planner).
   */
  const byId = new Map(wholeRows(transactions).map((t) => [t.id, t] as const));
  let amount = 0;
  let lastOn: IsoDate | null = null;
  const gone: string[] = [];
  const elsewhere: Transaction[] = [];
  for (const id of plan.entryIds) {
    const t = byId.get(id);
    if (!t) {
      gone.push(id);
      continue;
    }
    /*
     * A plan to save is paid only by money that still lands in its account:
     * a linked transfer edited in the Database to go somewhere else, or made
     * spending, no longer moves this plan's money (3 November 2026).
     */
    // A plan to pay a debt is paid only by a repayment on its own line (P12).
    if (!paysPlan(plan, t)) {
      elsewhere.push(t);
      continue;
    }
    // A plan to save is paid by what was moved into its account; a fee on the transfer is spending, not saving.
    // A debt by the whole payment: what was repaid and the interest saved as its own row beside it (P12).
    amount += isSave(plan) ? t.amount : paysDebt(plan) ? t.amount + interestWith(t, transactions) : t.total;
    if (lastOn === null || t.date > lastOn) lastOn = t.date;
  }
  return { amount, lastOn, gone, ...(elsewhere.length > 0 ? { elsewhere } : {}) };
}

/** The interest saved as a row of its own with a repayment, as `debt.ts`'s `interestOf` finds it. */
function interestWith(payment: Transaction, transactions: readonly Transaction[]): Centavos {
  const part = transactions.find((t) => t.debtEffect === "interest" && t.id !== payment.id && (t.partOf === payment.id || t.id === `${payment.id}-interest`));
  return part ? part.amount : 0;
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

/**
 * Where a plan stands now, from what is linked to it (P4.8). Done, but every
 * payment it was marked done with is gone (binned), or one of them edited
 * down below it: open again. Done for nothing, or for less, on purpose
 * ("That settles it") stays done. One definition for the Planner and for
 * whatever offers a payment to a plan: the Add form and the chat looked at
 * the stored "done" and passed over a plan the Planner showed open again
 * (owner, 3 November 2026).
 */
export function statusNow(plan: Plan, transactions: readonly Transaction[]): PlanStatus {
  if (plan.status !== "done" || plan.entryIds.length === 0) return plan.status;
  const paid = paidSoFar(plan, transactions).amount;
  return paid === 0 || (!plan.settled && paid < plan.amount) ? "open" : "done";
}

export function viewOf(
  plan: Plan,
  context: { readonly transactions: readonly Transaction[]; readonly accounts: readonly Account[]; readonly asOf: IsoDate },
): PlanView {
  const { transactions, accounts, asOf } = context;
  const paid = paidSoFar(plan, transactions);
  const daysTo = daysBetween(asOf, plan.due);
  const status: PlanStatus = statusNow(plan, transactions);
  // Done, and open again because what paid it was binned (P4.8), or edited down below it.
  const editedShort = plan.status === "done" && status === "open" && paid.amount > 0;
  const left = status === "done" ? 0 : Math.max(0, plan.amount - paid.amount);
  const goneNote =
    paid.gone.length > 0
      ? `${plural(paid.gone.length, "payment")} linked to it ${paid.gone.length === 1 ? "is" : "are"} no longer in the ledger (moved to the bin), so ${paid.gone.length === 1 ? "it does" : "they do"} not count.`
      : paid.elsewhere && paid.elsewhere.length > 0
        ? `${paid.elsewhere.map((t) => `#${String(t.recordNumber).padStart(4, "0")}`).join(", ")} ${paid.elsewhere.length === 1 ? "is" : "are"} linked to it but no longer ${paysDebt(plan) ? `${paid.elsewhere.length === 1 ? "is a repayment" : "are repayments"} on its loan` : `${paid.elsewhere.length === 1 ? "goes" : "go"} into ${plan.into}`} (edited in the Database), so ${paid.elsewhere.length === 1 ? "it does" : "they do"} not count.`
        : editedShort
          ? `It was done, but what is linked to it now comes to ${formatMoney(paid.amount)} of ${formatMoney(plan.amount)} (an entry was edited), so ${formatMoney(plan.amount - paid.amount)} is left again.`
          : "";

  let state: PlanState;
  let words: string;
  // A plan to save is moved, not paid (P11): "Paid PHP 1,000.00 of PHP 1,500.00" read as spending (3 November 2026).
  const Did = isSave(plan) ? "Moved" : "Paid";
  const did = Did.toLowerCase();
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
    // With no date it was neither early nor late; a month's is late only after the month.
    const when = plan.due === NO_DATE ? "" : late > 0 ? `${plural(late, "day")} late` : late < 0 ? (dueKindOf(plan) === "day" ? "early" : "in time") : "on the day";
    const diff = paid.amount - plan.amount;
    words = `${Did}${when ? ` ${when}` : ""}, ${shortDay(on)}${paid.amount > 0 && diff > 0 ? `, ${formatMoney(diff)} more than planned` : paid.amount > 0 && diff < 0 ? `, ${formatMoney(-diff)} less than planned` : ""}`;
  } else if (plan.due === NO_DATE) {
    // No date: never due, never late, counted nowhere (DueKind).
    state = paid.amount > 0 ? "partly" : "later";
    words = paid.amount > 0 ? `${Did} ${formatMoney(paid.amount)} of ${formatMoney(plan.amount)}, no date yet for the rest` : "No date yet";
  } else if (daysTo < 0) {
    state = "overdue";
    words = `${plural(-daysTo, "day")} late${paid.amount > 0 ? `, ${formatMoney(paid.amount)} of ${formatMoney(plan.amount)} ${did}` : ""}`;
  } else if (paid.amount > 0) {
    state = "partly";
    words = `${Did} ${formatMoney(paid.amount)} of ${formatMoney(plan.amount)}, ${daysTo === 0 ? "rest due today" : `rest due in ${plural(daysTo, "day")}`}`;
  } else if (daysTo === 0) {
    state = "today";
    words = "Due today";
  } else if (daysTo <= 7) {
    state = "soon";
    words = dueKindOf(plan) !== "day" ? `By the end of ${MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1]}, in ${plural(daysTo, "day")}` : daysTo === 1 ? "Due tomorrow" : `Due in ${plural(daysTo, "day")}`;
  } else {
    state = "later";
    // A month or a year is said as one: "in 35 days" read as a day nobody chose.
    words =
      dueKindOf(plan) !== "day"
        ? plan.due.slice(0, 7) === asOf.slice(0, 7)
          ? "Sometime this month"
          : whenOf(plan)
        : daysTo <= 60
          ? `Due in ${plural(daysTo, "day")}`
          : `Due ${MONTH_NAMES[Number(plan.due.slice(5, 7)) - 1]} ${plan.due.slice(0, 4)}`;
  }

  const goalAccount = plan.goalId ? accounts.find((a) => a.id === plan.goalId) : undefined;
  const goal = plan.goalId
    ? goalAccount
      ? (() => {
          const holds = walletBalance(transactions, goalAccount.name);
          const still = Math.max(0, left - holds);
          return { name: goalAccount.name, holds, perMonth: still > 0 && daysTo > 0 && plan.due !== NO_DATE && monthsTo(asOf, plan.due) >= 2 ? Math.ceil(still / monthsTo(asOf, plan.due)) : 0, missing: false };
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
    // Only when it spreads over two months or more: "₱9,000.00 a month" for one 35 days off said nothing (27 October 2026).
    perMonth: open && !plan.goalId && plan.due !== NO_DATE && daysTo > 31 && monthsTo(asOf, plan.due) >= 2 ? Math.ceil(left / monthsTo(asOf, plan.due)) : 0,
    // A plan to save is held back only when it takes money out of the spending wallets (P11).
    counts: open && plan.setAside && !plan.goalId && plan.due <= monthEnd && left > 0 && (!isSave(plan) || accounts.length === 0 || savesOutOfSpending(plan, accounts.filter((a) => a.kind === "spending" && !a.archived).map((a) => a.name))),
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
    /*
     * "Sometime in 2027" is kept on December 31 of that year, and was listed
     * under "December 2027" once the year began (2 November 2026, testing the
     * app on 1 January 2027). It is its own group, after that year's months.
     */
    const wholeYear = dueKindOf(v.plan) === "year";
    const key = v.plan.due === NO_DATE ? "4-nodate" : v.state === "overdue" ? "0-overdue" : wholeYear ? (month <= yearOut ? `2-${month.slice(0, 4)}-year` : "3-later") : month === thisMonth ? `1-${month}` : month <= yearOut ? `2-${month}` : "3-later";
    const title =
      key === "4-nodate"
        ? "No date yet"
        : key === "0-overdue"
          ? "Overdue"
          : key.startsWith("1-")
            ? "This month"
            : key === "3-later"
              ? "Later"
              : key.endsWith("-year")
                ? `Sometime in ${month.slice(0, 4)}`
                : `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
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
    .filter((v) => v.plan.due.slice(0, 7) === key && v.left > 0 && v.state !== "paid" && v.state !== "skipped" && v.state !== "removed" && !v.plan.goalId && !isSave(v.plan) && !paysDebt(v.plan))
    .map((v) => ({ name: v.plan.title, amount: v.left }));
}

/** What is planned in a month, by the Budget's two parts. */
export interface PlannedMonth {
  /** Spending: everything filed under a kind of spending, or under no kind. */
  readonly spending: Centavos;
  /** Bills and subscriptions: plans filed under one. */
  readonly billsSubs: Centavos;
  readonly total: Centavos;
  /** Soonest first: the plans to spend. */
  readonly views: readonly PlanView[];
  /** The ones counted in spending, soonest first. */
  readonly spendingViews: readonly PlanView[];
  /** Plans to save or move money in the month (P11): apart from the budget, said beside it. */
  readonly saving: Centavos;
  readonly savingViews: readonly PlanView[];
  /** Plans to pay a debt in the month (P12): a repayment is not spending, so said beside the budget too. */
  readonly debt: Centavos;
  readonly debtViews: readonly PlanView[];
}

/**
 * The open plans a month's budget will have to carry: what is left of each
 * due in the month, and for the month running the overdue ones too, which
 * will be paid in it if they are paid at all. Budget, Insights and the
 * Dashboard read this one figure (27 October 2026: "Add also the planned in
 * budget and insight and other parts like make sure it makes sense").
 *
 * Unlike safe to spend, a plan saved in a goal counts here: safe to spend
 * asks what the spending wallets can let go of, and a goal's money is apart
 * from them; a budget measures spending, and paying for the phone from the
 * goal is spending all the same.
 */
export function plannedForBudget(
  views: readonly PlanView[],
  year: number,
  month: number,
  reference: Pick<ReferenceLists, "bills" | "subscriptions">,
  asOf: IsoDate,
): PlannedMonth {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const running = key === asOf.slice(0, 7);
  const open = views
    .filter((v) => v.state !== "paid" && v.state !== "skipped" && v.state !== "removed" && v.left > 0)
    .filter((v) => v.plan.due.slice(0, 7) === key || (running && v.plan.due < `${key}-01`))
    .sort((a, b) => a.plan.due.localeCompare(b.plan.due));
  let spending = 0;
  let billsSubs = 0;
  let saving = 0;
  let debt = 0;
  const spendingViews: PlanView[] = [];
  const savingViews: PlanView[] = [];
  const debtViews: PlanView[] = [];
  for (const v of open) {
    // Saving is not spending: it is said beside the budget, never counted in it (P11).
    if (isSave(v.plan)) {
      saving += v.left;
      savingViews.push(v);
    } else if (paysDebt(v.plan)) {
      // Nor is paying back what was borrowed (P12): the spending happened when the borrowed money was used.
      debt += v.left;
      debtViews.push(v);
    } else if (isRecurringKind(v.plan.item, reference)) billsSubs += v.left;
    else {
      spending += v.left;
      spendingViews.push(v);
    }
  }
  return { spending, billsSubs, total: spending + billsSubs, views: open.filter((v) => !isSave(v.plan) && !paysDebt(v.plan)), spendingViews, saving, savingViews, debt, debtViews };
}

/** What is planned on each day from a day on: the Insights calendar's marks. Open plans only, what is left of each. */
export function plannedByDay(views: readonly PlanView[], from: IsoDate): Map<IsoDate, Centavos> {
  const out = new Map<IsoDate, Centavos>();
  for (const v of views) {
    // The calendar marks spending to come; money moved into savings is not spending (P11).
    if (v.state === "paid" || v.state === "skipped" || v.state === "removed" || v.left <= 0 || v.plan.due < from || isSave(v.plan)) continue;
    // Only a day is a day on the calendar: "sometime in November" is not November 30.
    if (dueKindOf(v.plan) !== "day") continue;
    out.set(v.plan.due, (out.get(v.plan.due) ?? 0) + v.left);
  }
  return out;
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
export function likelyPayments(plan: Plan, rows: readonly Transaction[], allPlans: readonly Plan[]): Transaction[] {
  // The entries the ledger holds, not a day's share of one (see `paidSoFar`).
  const transactions = wholeRows(rows);
  const linked = new Set(allPlans.flatMap((p) => p.entryIds));
  const words = plan.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  const from = addDays(plan.createdOn < plan.due ? plan.createdOn : plan.due, -7);
  const to = plan.due === NO_DATE ? NO_DATE : addDays(plan.due, 60);
  const left = Math.max(0, plan.amount - paidSoFar(plan, transactions).amount) || plan.amount;
  /*
   * A plan to save is paid by money moved into its account: a transfer, or
   * income put straight into it, from where it was to come from when that
   * was said. Close to what is left, or naming the plan (P11).
   */
  /*
   * A plan to pay a debt is paid by a repayment on its own line (P12):
   * close to what is left, around its day, not linked to another plan.
   */
  if (paysDebt(plan)) {
    return transactions
      .filter((t) => t.type === "Debt" && t.debtId === plan.debtId && t.debtEffect === "repay" && !linked.has(t.id) && t.date >= from && t.date <= to && t.amount > 0)
      .map((t) => {
        // The whole payment, its interest row included.
        const paid = t.amount + interestWith(t, transactions);
        return { t, close: paid === left ? 3 : Math.abs(paid - left) <= left * 0.2 ? 2 : paid < left && paid * 4 >= left ? 1 : 0 };
      })
      .filter((s) => s.close >= 1)
      .sort((a, b) => b.close - a.close || Math.abs(daysBetween(plan.due, a.t.date)) - Math.abs(daysBetween(plan.due, b.t.date)))
      .slice(0, 6)
      .map((s) => s.t);
  }
  if (isSave(plan)) {
    const into = (plan.into ?? "").trim().toLowerCase();
    const from_ = plan.wallet.trim().toLowerCase();
    /*
     * Its own words only: not the account's name, which every row into it
     * carries, nor deposit or save. "Deposit to Maya Bank" took a PHP 1.50
     * "Bank interest" as its likely payment (2 November 2026, on the owner's
     * data). Income paid straight in counts only at about the amount.
     */
    const plain = new Set([...into.split(/[^a-z0-9]+/), "deposit", "save", "saving", "savings", "move", "into", "transfer", "money", "put"]);
    const own = words.filter((w) => !plain.has(w));
    return transactions
      .filter((t) => (t.type === "Transfer" || t.type === "Revenue") && t.toWallet.trim().toLowerCase() === into && !linked.has(t.id) && t.date >= from && t.date <= to && t.amount > 0)
      .map((t) => {
        const saysIt = own.some((w) => `${t.item} ${t.description}`.toLowerCase().includes(w));
        const close = t.amount === left ? 3 : Math.abs(t.amount - left) <= left * 0.2 ? 2 : t.amount < left && t.amount * 4 >= left ? 1 : 0;
        const sameFrom = Boolean(from_) && t.fromWallet.trim().toLowerCase() === from_ ? 1 : 0;
        const fits = t.type === "Revenue" ? close >= 2 : close >= 1 || saysIt;
        return { t, score: close + sameFrom + (saysIt ? 2 : 0), fits };
      })
      .filter((s) => s.fits)
      .sort((a, b) => b.score - a.score || Math.abs(daysBetween(plan.due, a.t.date)) - Math.abs(daysBetween(plan.due, b.t.date)))
      .slice(0, 6)
      .map((s) => s.t);
  }
  const scored = transactions
    .filter((t) => t.type === "Spending" && !linked.has(t.id) && t.date >= from && t.date <= to)
    .map((t) => {
      const text = `${t.item} ${t.description}`.toLowerCase();
      const sameKind = Boolean(plan.item) && t.item.trim().toLowerCase() === plan.item.trim().toLowerCase();
      const saysIt = words.some((w) => text.includes(w));
      const close = t.total === left ? 3 : Math.abs(t.total - left) <= left * 0.2 ? 2 : t.total < left && t.total * 4 >= left ? 1 : 0;
      /*
       * Only the kind in common: it must also come after the plan was made,
       * or, for a plan made after its own day (planned in the past), around
       * that day: the entry was there first (27 October 2026).
       */
      const fits = saysIt ? close >= 1 : sameKind && close >= 2 && t.date >= (plan.due < plan.createdOn ? from : plan.createdOn);
      return { t, score: (sameKind ? 2 : 0) + (saysIt ? 2 : 0) + close, fits };
    })
    .filter((s) => s.fits)
    .sort((a, b) => b.score - a.score || Math.abs(daysBetween(plan.due, a.t.date)) - Math.abs(daysBetween(plan.due, b.t.date)));
  return scored.slice(0, 6).map((s) => s.t);
}

/**
 * The open plan a new entry most likely pays, read with `likelyPayments`'s
 * own rule from the other side: the Add form offers to count the entry as
 * that plan's payment, so a plan typed in by hand is not left open and set
 * aside a second time (owner, 27 October 2026: "make sure the planner is
 * connected also in add too"). `sure` when the entry names the plan or is
 * exactly what is left of it; the form starts with the link on only then.
 */
export function planPaidBy(
  row: Transaction,
  plans: readonly Plan[],
  transactions: readonly Transaction[],
  /** The open accounts' names: with them, a plan to save that was saved as spending is found too (`misfiledSaving`). */
  accounts: readonly string[] = [],
): { readonly plan: Plan; readonly left: Centavos; readonly sure: boolean; readonly makesSaving?: string } | null {
  // Spending pays a plan to spend; money moved into an account pays a plan to save into it (P11); a repayment, a plan to pay that debt (P12).
  const moved = (row.type === "Transfer" || row.type === "Revenue") && row.toWallet.trim() !== "";
  const repaid = row.type === "Debt" && row.debtEffect === "repay" && Boolean(row.debtId);
  if ((row.type !== "Spending" && !moved && !repaid) || row.total <= 0) return null;
  const all = [...transactions.filter((t) => t.id !== row.id), row];
  const kindOf = (p: Plan): "debt" | "save" | "spend" => (paysDebt(p) ? "debt" : isSave(p) ? "save" : "spend");
  const rowKind = repaid ? "debt" : moved ? "save" : "spend";
  // Open, or shown open again because what paid it was binned (`statusNow`).
  const open = plans.filter((p) => statusNow(p, transactions) === "open");
  /*
   * Money moved into an account, and a plan saved as spending whose own
   * words say it goes there: offered as that plan's, made a plan to save
   * when it is counted (owner, 3 November 2026: "i allready transfer to my
   * bank then it didnt recognize it").
   */
  const misfiled = moved && accounts.length > 0
    ? open.flatMap((p) => {
        const m = misfiledSaving(p, accounts, all, plans);
        const into = m && (m.into === row.toWallet || (m.into === null && m.options.includes(row.toWallet))) ? row.toWallet : null;
        return into ? [{ as: { ...p, into, item: "" }, plan: p, into }] : [];
      })
    : [];
  const found = [
    ...open.filter((p) => kindOf(p) === rowKind).map((p) => ({ as: p, plan: p, into: undefined as string | undefined })),
    ...misfiled,
  ]
    .filter(({ as }) => likelyPayments(as, all, plans).some((t) => t.id === row.id))
    .map(({ as, plan, into }) => {
      const left = Math.max(0, as.amount - paidSoFar(as, transactions).amount);
      const words = plan.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const text = `${row.item} ${row.description}`.toLowerCase();
      const exact = (moved ? row.amount : repaid ? row.amount + interestWith(row, all) : row.total) === left;
      // A change of kind is on by itself only for exactly what is left: its words name the account every deposit goes to.
      return { plan, left, sure: into ? exact : exact || words.some((w) => text.includes(w)), ...(into ? { makesSaving: into } : {}) };
    })
    .filter((m) => m.left > 0)
    .sort((a, b) => Number(b.sure) - Number(a.sure) || Number(!b.makesSaving) - Number(!a.makesSaving) || a.plan.due.localeCompare(b.plan.due));
  return found[0] ?? null;
}

/** "Save into Maya Bank", "Deposit 1500 to my Maya Bank", "Transfer to Gcash": the place named. */
const SAVE_TITLE = /^(?:save|saving|savings|deposit|move|transfer|put|ipon)\b(?:\s+(?:money|it|some|(?:php|₱)?\s?[\d,.]+\s*k?))?\s+(?:into|to|in|sa)\s+(?:my\s+|the\s+)?(.+?)\s*[.!]?$/i;

/** An account's name without what is in brackets: "Maya Bank (Personal savings)" is "maya bank". */
const baseName = (name: string): string => name.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();

/**
 * A plan saved as spending whose own words say the money goes into one of
 * the accounts: "Save into Maya Bank", its notes "Into Maya Bank (Personal
 * savings)". A change to its chat card by words dropped where the money
 * goes, so the owner's plan showed Pay, booked ₱1,500.00 of "Random
 * necessities", and never saw the transfer made for it (3 November 2026).
 *
 * Read, never changed by itself (report, never correct): `asSaving` makes
 * the change when the owner presses for it. `into` is the account, or null
 * when the words fit several and nothing tells them apart ("Maya Bank" with
 * three Maya Bank accounts and no notes); `options` is every account they
 * fit; `fits` is the transfer or deposit into `into` that looks like it.
 */
export function misfiledSaving(
  plan: Plan,
  accounts: readonly string[],
  transactions: readonly Transaction[],
  allPlans: readonly Plan[],
): { readonly into: string | null; readonly options: readonly string[]; readonly fits: Transaction | null } | null {
  if (isSave(plan) || paysDebt(plan) || plan.goalId || plan.item.trim() || statusNow(plan, transactions) !== "open") return null;
  // Spending counted for it already: a plan to spend, whatever it is called.
  if (paidSoFar(plan, transactions).amount > 0) return null;
  const named = SAVE_TITLE.exec(plan.title.trim())?.[1]?.trim().toLowerCase();
  if (!named) return null;
  const options = accounts.filter((n) => n.trim().toLowerCase() === named || baseName(n) === named);
  if (options.length === 0) return null;
  const notes = plan.notes.toLowerCase();
  const exact = options.filter((n) => n.trim().toLowerCase() === named);
  const inNotes = options.filter((n) => notes.includes(n.trim().toLowerCase()));
  const fitsInto = (into: string): Transaction | null => likelyPayments({ ...plan, into, item: "" }, transactions, allPlans)[0] ?? null;
  let into: string | null = exact.length === 1 ? exact[0]! : inNotes.length === 1 ? inNotes[0]! : options.length === 1 ? options[0]! : null;
  if (into === null) {
    // Several accounts by that name, and money moved into one of them that fits: that one.
    const moved = options.filter((n) => fitsInto(n) !== null);
    if (moved.length === 1) into = moved[0]!;
  }
  return { into, options, fits: into === null ? null : fitsInto(into) };
}

/**
 * `misfiledSaving`'s change, made when the owner asks for it: a plan to save
 * into `into`. What is linked to it and in the bin is let go (spending never
 * pays a plan to save, and restored it would count twice), so a plan shown
 * open again because of it is open; `link`, when given, is then counted as
 * the money moved, as Link a payment does.
 */
export function asSaving(plan: Plan, into: string, spendingWallets: readonly string[], transactions: readonly Transaction[], asOf: IsoDate, link?: string): Plan {
  const gone = new Set(paidSoFar(plan, transactions).gone);
  const reopened = statusNow(plan, transactions) === "open" && plan.status === "done";
  const base: Plan = tidy({ ...plan, entryIds: plan.entryIds.filter((id) => !gone.has(id)), ...(reopened ? { status: "open" as const, closedOn: undefined, settled: undefined } : {}) });
  const next = editPlan(base, inputOf(base, { into, item: "", goalId: undefined, setAside: base.setAside && savesOutOfSpending({ into, wallet: base.wallet }, spendingWallets) }), asOf, transactions);
  return link ? linkPayments(next, [link], transactions, asOf) : next;
}

/** What `asSaving` did, for Activity, the bell and the chat: "Made "X" a plan to save into Y, and counted #3974 as the money moved. #3976, in the bin, is no longer linked." */
export function asSavingWords(before: Plan, after: Plan, transactions: readonly Transaction[], link?: Transaction | null): string {
  const no = (n: number): string => `#${String(n).padStart(4, "0")}`;
  const gone = paidSoFar(before, transactions).gone.length;
  return [
    `Made "${after.title}" a plan to save into ${after.into}${link ? `, and counted ${no(link.recordNumber)} (${formatMoney(link.amount)}) as the money moved${after.status === "done" ? "" : `, ${formatMoney(Math.max(0, after.amount - paidSoFar(after, transactions).amount))} still to move`}` : ""}.`,
    gone > 0 ? `${gone === 1 ? "The payment" : `${gone} payments`} linked to it from the bin ${gone === 1 ? "is" : "are"} no longer linked.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** "Moved twice, first planned for Nov 15". */
export function movesWords(plan: Plan): string {
  if (plan.moves.length === 0) return "";
  const first = plan.moves[0]!.from;
  return `Moved ${plan.moves.length === 1 ? "once" : plan.moves.length === 2 ? "twice" : `${plan.moves.length} times`}, first planned for ${formatMedium(first)}`;
}

/** One line for the activity trail and the chat. */
export function planLine(plan: Plan): string {
  if (isSave(plan)) return `${plan.title}, ${formatMoney(plan.amount)} to save into ${plan.into}, ${byWhen(plan)}${plan.wallet ? `, from ${plan.wallet}` : ""}`;
  return `${plan.title}, ${formatMoney(plan.amount)}, ${byWhen(plan)}${plan.item ? `, ${plan.item}` : ""}${plan.wallet ? `, from ${plan.wallet}` : ""}`;
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
