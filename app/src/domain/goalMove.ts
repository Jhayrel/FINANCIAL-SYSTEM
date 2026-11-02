/**
 * Moving a goal's money somewhere else, and what happens to the plans that
 * were saving in it.
 *
 * The owner, 27 October 2026: "what if I want to use the money in goal to
 * another like more good or what if I transfer the goal to another account
 * or another goal money wallet etc overthink everthign fix it", and "what if
 * the plan i made is connected to a goal then I edit the goal change it to
 * none goal". Closing a goal could only send its money back to the account
 * it sat in, and said nothing of the plans saving in it.
 *
 * Here the money goes to any open account or goal, all of it or part, as one
 * ordinary transfer row, and each plan saving in the goal is either kept on
 * it, moved with the money to the other goal, or let go to be counted in safe
 * to spend again. Nothing is written: the caller shows what it means, the
 * owner confirms, and only then are the row and the plans saved.
 */
import { walletBalance } from "./balances";
import type { Account } from "./accounts";
import { formatMoney, type Centavos } from "./money";
import type { Plan } from "./planner";
import type { IsoDate, Transaction } from "./types";

/** What happens to the plans saving in the goal. */
export type PlansChoice = "keep" | "follow" | "free";

export interface GoalMove {
  readonly rows: readonly Transaction[];
  /** The plans as they will be after, when any changes; empty when none do. */
  readonly plans: readonly Plan[];
  /** What it means, said before anything is saved. */
  readonly notes: readonly string[];
  /** Set when it cannot be done, and why. */
  readonly blocked?: string;
}

/** Where a goal's money can go: any open account or goal but itself. */
export const moveTargets = (goal: Account, accounts: readonly Account[]): Account[] => accounts.filter((a) => a.id !== goal.id && !a.archived);

export function planGoalMove(
  goal: Account,
  toId: string,
  /** Centavos to move; null for all of it. */
  amount: Centavos | null,
  ctx: {
    readonly accounts: readonly Account[];
    readonly transactions: readonly Transaction[];
    readonly plans: readonly Plan[];
    readonly choice: PlansChoice;
    readonly today: IsoDate;
    readonly nextRecordNumber: number;
  },
): GoalMove {
  const holds = walletBalance(ctx.transactions, goal.name);
  const to = ctx.accounts.find((a) => a.id === toId);
  const fail = (blocked: string): GoalMove => ({ rows: [], plans: [], notes: [], blocked });
  if (!to) return fail("Pick where the money goes.");
  if (to.id === goal.id) return fail("That is the same goal.");
  if (to.archived) return fail(`${to.name} is closed. Open it again in Settings first, or pick another.`);
  if (holds <= 0) return fail(`${goal.name} holds nothing, so there is no money to move.`);
  const moving = amount ?? holds;
  if (moving <= 0) return fail("Say how much to move, more than PHP 0.00.");
  if (moving > holds) return fail(`${goal.name} holds ${formatMoney(holds)}, so at most that can move.`);

  const notes: string[] = [];
  const left = holds - moving;
  notes.push(`${formatMoney(moving)} moves from ${goal.name} to ${to.name} as a transfer, so no money is gained or lost${left > 0 ? `; ${formatMoney(left)} stays in ${goal.name}` : ""}.`);
  if (to.kind === "goal") {
    const after = walletBalance(ctx.transactions, to.name) + moving;
    const target = to.target ?? 0;
    notes.push(target > 0 ? `${to.name} will hold ${formatMoney(after)} of its ${formatMoney(target)}${after >= target ? ", its target reached" : `, ${formatMoney(target - after)} to go`}.` : `${to.name} will hold ${formatMoney(after)}.`);
  } else if (to.kind === "spending") {
    notes.push(`In ${to.name} it is money to spend: it counts in safe to spend from now.`);
  } else {
    notes.push(`In ${to.name} it is savings again, not held for anything.`);
  }

  // The plans saving in this goal.
  const saving = ctx.plans.filter((p) => p.status === "open" && p.goalId === goal.id);
  let plans: Plan[] = [];
  if (saving.length > 0) {
    const titles = saving.map((p) => `"${p.title}"`).join(" and ");
    const choice: PlansChoice = ctx.choice === "follow" && to.kind !== "goal" ? "free" : ctx.choice;
    if (choice === "keep") {
      notes.push(`${titles} ${saving.length === 1 ? "keeps" : "keep"} saving in ${goal.name}${left > 0 ? `, with ${formatMoney(left)} in it` : ", which will be empty"}.`);
    } else if (choice === "follow") {
      plans = ctx.plans.map((p) => (saving.includes(p) ? { ...p, goalId: to.id, wallet: p.wallet === goal.name ? to.name : p.wallet } : p));
      notes.push(`${titles} ${saving.length === 1 ? "moves" : "move"} with the money and ${saving.length === 1 ? "saves" : "save"} in ${to.name} from now.`);
    } else {
      plans = ctx.plans.map((p) => (saving.includes(p) ? { ...p, goalId: undefined, wallet: p.wallet === goal.name ? "" : p.wallet, setAside: true } : p));
      notes.push(`${titles} no longer ${saving.length === 1 ? "saves" : "save"} in a goal, so ${saving.length === 1 ? "it is" : "they are"} counted in safe to spend again.`);
    }
    if (ctx.choice === "follow" && to.kind !== "goal") notes.push(`${to.name} is not a goal, so a plan cannot save in it; ${saving.length === 1 ? "it goes" : "they go"} back to safe to spend.`);
  }

  const row: Transaction = {
    id: `goal-move-${goal.id}-${ctx.today}-${ctx.nextRecordNumber}`,
    recordNumber: ctx.nextRecordNumber,
    date: ctx.today,
    type: "Transfer",
    fromWallet: goal.name,
    toWallet: to.name,
    category: "",
    item: "",
    description: `Moved from the goal ${goal.name} to ${to.name}`,
    amount: moving,
    fee: 0,
    total: moving,
    notes: "",
    status: "Transferred",
  };
  return { rows: [row], plans, notes };
}

/**
 * Moving a goal inside another account: only where it is said to sit. The
 * ledger keeps its money under the goal's own name either way; the money in
 * the bank moves only when the owner moves it, so that is said.
 */
export function goalParentNote(goal: Account, toParent: Account | undefined, transactions: readonly Transaction[]): string {
  const holds = walletBalance(transactions, goal.name);
  if (!toParent) return "Pick the savings or reserve account it sits inside.";
  return holds > 0
    ? `${goal.name} will sit inside ${toParent.name}. Its ${formatMoney(holds)} stays its own here; if the money is really kept in another bank, move it there in that bank's app too.`
    : `${goal.name} will sit inside ${toParent.name}. It holds nothing yet, so no money moves.`;
}

/** What closing does to the plans saving in a goal, for the confirmation. */
export function closePlansNote(goal: Account, plans: readonly Plan[]): string {
  const saving = plans.filter((p) => p.status === "open" && p.goalId === goal.id);
  if (saving.length === 0) return "";
  const titles = saving.map((p) => `"${p.title}"`).join(" and ");
  return ` ${titles} ${saving.length === 1 ? "saves" : "save"} in it: after closing, ${saving.length === 1 ? "it is" : "they are"} counted in safe to spend again. To keep ${saving.length === 1 ? "it" : "them"} on a goal, use Move its money first and take ${saving.length === 1 ? "the plan" : "the plans"} with it.`;
}
