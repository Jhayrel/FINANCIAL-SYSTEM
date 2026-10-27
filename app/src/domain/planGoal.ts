/**
 * A goal for a plan: the money for it put aside in a savings account until
 * it is paid (docs/16-PLANNER.md, P4.17).
 *
 * The owner, 27 October 2026: "it just keep creating a goal it shouldnt do
 * that", then "it will not do goal until it is actually created also add
 * validation etc overthink the process add what if and connect it better to
 * the system". Picking "Make a goal for it" made a goal there and then, so a
 * cancelled form left one behind and a second pick made "... fund"; a plan
 * with no date gave it December 31, 9999 as its deadline. Now the goal is
 * worked out here and made only when the plan is saved, as Settings makes
 * one: inside a savings or reserve account, named after it, checked the same
 * way, with what it means said before anything is made.
 */
import { validateAccount, type Account } from "./accounts";
import { walletBalance } from "./balances";
import { formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { dueFor, NO_DATE, type DueKind, type Plan } from "./planner";
import type { IsoDate, Transaction } from "./types";

/** Where a goal can sit, as Settings' "Inside" offers: savings and reserve accounts still open. */
export const goalParents = (accounts: readonly Account[]): Account[] => accounts.filter((a) => (a.kind === "savings" || a.kind === "reserve") && !a.archived);

/** A goal's name inside its account, as Settings names one: "Maya Bank (iPhone 18 Pro Max)". */
export const goalNameIn = (parent: Account | undefined, title: string): string => (parent ? `${parent.name.replace(/\s*\(.*\)$/, "")} (${title.trim()})` : title.trim());

/** The deadline a plan gives its goal: its day, or its month's or year's end; none with no date or a day gone. */
export function goalDeadline(plan: { readonly due: IsoDate; readonly dueKind?: DueKind | undefined }, asOf: IsoDate): IsoDate | undefined {
  if (plan.due === NO_DATE || plan.due >= "9000") return undefined;
  const day = dueFor(plan.dueKind ?? "day", plan.due);
  return day > asOf ? day : undefined;
}

export interface GoalForPlan {
  /** What the goal will be, or the one already there that is used. */
  readonly name: string;
  readonly parentId: string;
  readonly target: Centavos;
  readonly deadline?: IsoDate | undefined;
  readonly reuse: Account | null;
  /** Stops the save. */
  readonly problems: readonly string[];
  /** Said beside the choice: what it means, and what to watch. */
  readonly notes: readonly string[];
}

/** Months from today to a day, at least one. */
const monthsTo = (asOf: IsoDate, day: IsoDate): number => Math.max(1, (Number(day.slice(0, 4)) - Number(asOf.slice(0, 4))) * 12 + (Number(day.slice(5, 7)) - Number(asOf.slice(5, 7))));

/**
 * The goal a plan would get, checked, before anything is made. Nothing here
 * changes anything.
 */
export function goalForPlan(
  plan: { readonly id?: string | undefined; readonly title: string; readonly amount: Centavos | null; readonly due: IsoDate; readonly dueKind?: DueKind | undefined },
  ctx: { readonly accounts: readonly Account[]; readonly plans: readonly Plan[]; readonly transactions: readonly Transaction[]; readonly asOf: IsoDate; readonly parentId?: string | undefined; readonly goalId?: string | undefined },
): GoalForPlan {
  const problems: string[] = [];
  const notes: string[] = [];
  const title = plan.title.trim();
  const target = plan.amount ?? 0;
  if (!title) problems.push("Say what it is for first: the goal is named after it.");
  if (plan.amount === null || plan.amount <= 0) problems.push("Put in how much it will cost first: that is the goal's target.");
  const parents = goalParents(ctx.accounts);
  const parent = parents.find((p) => p.id === ctx.parentId) ?? parents[0];
  if (!parent) problems.push("A goal sits inside a savings or reserve account, and there is none open. Add one in Settings, Accounts first.");
  const name = goalNameIn(parent, title);
  const deadline = goalDeadline(plan, ctx.asOf);

  // One already there by that name, or the plain name or "... fund" an earlier version made: used, never a second.
  const lower = (s: string): string => s.trim().toLowerCase();
  const reuse =
    (ctx.goalId ? ctx.accounts.find((a) => a.id === ctx.goalId) : undefined) ??
    ctx.accounts.find((a) => a.kind === "goal" && !a.archived && [name, title, `${title} fund`].some((n) => lower(n) === lower(a.name))) ??
    null;
  // A goal picked from the list: its own problems only (none to make), and what it means.
  if (ctx.goalId && reuse) problems.splice(0, problems.length, ...problems.filter((p) => !p.startsWith("A goal sits inside")));

  if (reuse) {
    const holds = walletBalance(ctx.transactions, reuse.name);
    notes.push(ctx.goalId ? `${reuse.name} holds ${formatMoney(holds)}.` : `Uses the goal ${reuse.name} you have already; no new one is made. It holds ${formatMoney(holds)}.`);
    if ((reuse.target ?? 0) !== target && target > 0) notes.push(`Its target is ${formatMoney(reuse.target ?? 0)} and this plan is ${formatMoney(target)}: change the target in Settings, Goals if they should match.`);
    const sharing = ctx.plans.filter((p) => p.status === "open" && p.goalId === reuse.id && p.id !== plan.id);
    if (sharing.length > 0) notes.push(`It is saving for ${sharing.map((p) => `"${p.title}"`).join(" and ")} too, so the plans share its money.`);
  } else if (parent && title && target > 0) {
    // Checked as Settings checks a new goal; a plan's goal may wait for a deadline until the plan has a date.
    const draft: Account = { id: "draft", name, kind: "goal", parentId: parent.id, target, deadline: deadline ?? "9999-12-31", openedDate: ctx.asOf, archived: false };
    for (const issue of validateAccount(draft, ctx.accounts, ctx.transactions)) if (issue.field !== "deadline") problems.push(issue.message);
    notes.push(`A goal called ${name} is made inside ${parent.name} when you save, aiming for ${formatMoney(target)}.`);
  }

  // What it takes, worked out: a month's share to the deadline, or why there is none.
  if (title && target > 0) {
    const holds = reuse ? walletBalance(ctx.transactions, reuse.name) : 0;
    const still = Math.max(0, target - holds);
    if (plan.due === NO_DATE || plan.due >= "9000") notes.push("No deadline until the plan has a date; give it one and the goal follows.");
    else if (!deadline) notes.push("Its day has passed, so the goal gets no deadline: give the plan a new day and the goal follows.");
    else if (still > 0) {
      const months = monthsTo(ctx.asOf, deadline);
      notes.push(`To have it by ${formatMedium(deadline)}, put in about ${formatMoney(Math.ceil(still / months))} a month${months > 1 ? ` for ${months} months` : ""}, moved into the goal as a transfer.`);
    }
    notes.push("Saved in a goal, it is not counted in safe to spend: its money is put aside already. Paying it comes out of the goal.");
  }
  return { name: reuse?.name ?? name, parentId: reuse?.parentId ?? parent?.id ?? "", target, deadline, reuse, problems, notes };
}

/**
 * A goal made for a plan follows the plan: when its target was the plan's
 * amount and its deadline the plan's day, an edit to either moves the goal
 * too. A goal set by hand is left as it is. Null when nothing changes.
 */
export function goalInStep(goal: Account, before: Plan, after: Plan, asOf: IsoDate): Partial<Account> | null {
  const change: { target?: Centavos; deadline?: IsoDate | undefined } = {};
  if ((goal.target ?? 0) === before.amount && after.amount !== before.amount && after.amount > 0) change.target = after.amount;
  const was = goalDeadline(before, asOf);
  const now = goalDeadline(after, asOf);
  const wasPlaceholder = !goal.deadline || goal.deadline >= "9000";
  if ((goal.deadline === was || wasPlaceholder) && now !== (wasPlaceholder ? undefined : was) && now !== goal.deadline) change.deadline = now;
  return Object.keys(change).length > 0 ? change : null;
}

/** "Make a goal for it", "save for the phone plan in a new goal": the Planner's "Make a goal for it", said. */
export const asksForGoal = (text: string): boolean =>
  /\b(?:make|create|start|open|set\s+up|add)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:savings\s+)?goal\b|\bsave\s+(?:up\s+)?for\s+(?:it|this|that|the\s+[\w\s]{1,40}?plan)\s+in\s+a\s+(?:new\s+)?goal\b|\bput\s+(?:it|this|that)\s+in\s+a\s+(?:new\s+)?goal\b|\bgawa(?:n|in)?\s+(?:ng\s+)?goal\b/i.test(text);
