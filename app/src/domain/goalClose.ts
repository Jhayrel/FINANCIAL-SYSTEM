/**
 * Closing a goal.
 *
 * ── The question this answers ─────────────────────────────────────────────
 *
 * A goal is not a pot of money. It is a label over money that is really
 * sitting in its parent account: "Maya Bank (Drone)" is Maya Bank, earmarked.
 * So when the goal ends, the money does not disappear and it does not move
 * anywhere on its own. It goes back to being ordinary parent money.
 *
 * The old behaviour was to refuse: `canArchive` blocked any goal still holding
 * a balance and told you to transfer it yourself. That is safe and useless. It
 * turns the one moment you know what you want into a chore you have to go and
 * do somewhere else, which is exactly when people give up and leave the goal
 * open forever.
 *
 * Closing now writes the transfer for you, as a real transaction you can see,
 * edit and undo like any other.
 *
 * ── Interest, and why the app has to ask ──────────────────────────────────
 *
 * Nothing here is connected to a bank. Every peso in this system is here
 * because it was typed in. If a goal lives in a real savings account, the bank
 * pays interest into it that the app cannot see and will never see.
 *
 * The moment you close the goal is the one moment you are looking at that
 * account and would notice. So that is when it asks: "the bank says this is
 * worth X, the app thinks Y, what happened to the difference?" A difference
 * upward is interest, which is real income. A difference downward is a fee,
 * which is real spending. Either way it becomes a transaction rather than a
 * silent discrepancy, which is the whole reason the Excel's TOTAL FUNDS tile
 * drifted PHP 30.00 from the wallets beside it.
 *
 * ── The invariant ─────────────────────────────────────────────────────────
 *
 * After closing, the goal holds exactly zero, the parent holds exactly what it
 * held plus what the goal held plus any interest, and net worth moves by the
 * interest and nothing else. `goalClose.test.ts` asserts all three.
 */

import { walletBalance } from "./balances";
import type { Account } from "./accounts";
import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

/** What the bank says, versus what the app has recorded. */
export interface Reconciliation {
  /** The balance the bank actually shows. Leave undefined to skip the check. */
  readonly actual?: Centavos | undefined;
}

export interface GoalClosePlan {
  readonly goal: Account;
  readonly parent: Account | undefined;
  /** What the app currently thinks the goal holds. */
  readonly recorded: Centavos;
  /** Difference between the bank and the app. Positive is interest. */
  readonly adjustment: Centavos;
  /** What moves back to the parent, after any adjustment. */
  readonly returning: Centavos;
  /** The rows that will be written, in order. */
  readonly rows: readonly Transaction[];
  /** True when this goal sits in something that can pay interest. */
  readonly couldEarnInterest: boolean;
  /** Set when the close cannot proceed. */
  readonly blocked?: string;
}

/**
 * Plan the close.
 *
 * Writes nothing. The caller shows the plan, the owner confirms, and only then
 * are `rows` appended to the ledger and the goal archived.
 */
export function planGoalClose(
  goal: Account,
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  options: {
    readonly today: IsoDate;
    readonly nextRecordNumber: number;
    readonly reconcile?: Reconciliation | undefined;
  },
): GoalClosePlan {
  const parent = accounts.find((a) => a.id === goal.parentId);
  const recorded = walletBalance(transactions, goal.name);

  // A bank pays interest; an envelope of cash does not. Only ask where the
  // question makes sense.
  const couldEarnInterest =
    (parent?.channel ?? "bank") === "bank" && (parent?.kind === "savings" || goal.kind === "goal");

  const actual = options.reconcile?.actual;
  const adjustment = actual === undefined ? 0 : actual - recorded;
  const returning = recorded + adjustment;

  if (!parent) {
    return {
      goal,
      parent: undefined,
      recorded,
      adjustment,
      returning,
      rows: [],
      couldEarnInterest,
      ...(recorded === 0
        ? {}
        : {
            blocked: `${goal.name} still holds money but is not inside any account, so there is nowhere to return it to. Move it by hand, then close the goal.`,
          }),
    };
  }

  const rows: Transaction[] = [];
  let n = options.nextRecordNumber;

  if (adjustment !== 0) {
    // Interest is income the bank paid you. A shortfall is a fee it charged.
    // Both are real events that happened; neither is a correction.
    rows.push(
      adjustment > 0
        ? {
            id: `goal-interest-${goal.id}-${options.today}`,
            recordNumber: n++,
            date: options.today,
            type: "Revenue",
            fromWallet: "",
            toWallet: goal.name,
            category: "Revenue",
            item: "Interest",
            description: `Interest credited to ${goal.name}`,
            amount: adjustment,
            fee: 0,
            total: adjustment,
            notes: "Recorded when the goal was closed and reconciled with the bank.",
            status: "Received",
          }
        : {
            id: `goal-fee-${goal.id}-${options.today}`,
            recordNumber: n++,
            date: options.today,
            type: "Spending",
            fromWallet: goal.name,
            toWallet: "",
            category: "Spending",
            item: "Transaction Fee",
            description: `Bank charge on ${goal.name}`,
            amount: -adjustment,
            fee: 0,
            total: -adjustment,
            notes: "Recorded when the goal was closed and reconciled with the bank.",
            status: "Done",
          },
    );
  }

  if (returning > 0) {
    rows.push({
      id: `goal-return-${goal.id}-${options.today}`,
      recordNumber: n++,
      date: options.today,
      type: "Transfer",
      fromWallet: goal.name,
      toWallet: parent.name,
      // A transfer between two of your own accounts with no fee is not
      // spending. `domain/transfers.ts` derives exactly this.
      category: "",
      item: "",
      description: `${goal.name} closed, balance returned to ${parent.name}`,
      amount: returning,
      fee: 0,
      total: returning,
      notes: "",
      status: "Transferred",
    });
  }

  return {
    goal,
    parent,
    recorded,
    adjustment,
    returning,
    rows,
    couldEarnInterest,
    ...(returning < 0
      ? {
          blocked: `Closing would leave ${goal.name} holding less than nothing. Check the balance you entered.`,
        }
      : {}),
  };
}

/** One line saying what closing will do, for the confirmation. */
export function describeClose(plan: GoalClosePlan, format: (c: Centavos) => string): string {
  if (plan.blocked) return plan.blocked;

  const parts: string[] = [];
  if (plan.adjustment > 0) {
    parts.push(`records ${format(plan.adjustment)} of interest`);
  } else if (plan.adjustment < 0) {
    parts.push(`records ${format(-plan.adjustment)} of bank charges`);
  }

  if (plan.returning > 0 && plan.parent) {
    parts.push(`moves ${format(plan.returning)} back to ${plan.parent.name}`);
  }

  if (parts.length === 0) return "The goal is empty, so closing it only changes its status.";
  return `Closing ${parts.join(", and ")}. Both appear in your ledger as ordinary rows.`;
}

/**
 * A goal past its deadline that still holds money.
 *
 * Nothing closes itself. The app cannot know whether you actually spent the
 * money, so it says what it sees and leaves the decision alone.
 */
export function overdueGoals(
  goals: readonly Account[],
  transactions: readonly Transaction[],
  today: IsoDate,
): { goal: Account; balance: Centavos }[] {
  return goals
    .filter((g) => !g.archived && g.deadline !== undefined && g.deadline < today)
    .map((goal) => ({ goal, balance: walletBalance(transactions, goal.name) }))
    .filter((g) => g.balance !== 0);
}
