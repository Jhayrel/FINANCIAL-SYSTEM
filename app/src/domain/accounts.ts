/**
 * Accounts, reserves and goals: docs/05-ACCOUNTS-AND-GOALS.md.
 *
 * Replaces the Excel's flat "wallet or savings" split, which had already
 * broken down: the reserves sat in the wallet list, and two savings goals were
 * masquerading as accounts.
 *
 * The important consequence is rule A3: only `spending` accounts feed the
 * daily budget. Today the reserves are excluded only because they happen to
 * hold ₱0.00; this makes the exclusion deliberate.
 */

import { allWalletBalances, walletBalance } from "./balances";
import { daysBetween, today } from "./dates";
import type { Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export type AccountKind = "spending" | "reserve" | "savings" | "goal";

export const KIND_LABEL: Record<AccountKind, string> = {
  spending: "Spending",
  reserve: "Reserve",
  savings: "Savings",
  goal: "Goal",
};

export const KIND_HINT: Record<AccountKind, string> = {
  spending: "Money you spend from day to day",
  reserve: "Cash set aside and hidden from yourself",
  savings: "Held somewhere longer-term",
  goal: "A savings target inside a parent account",
};

export interface Account {
  readonly id: string;
  /** Must match the name used in the ledger's from/to wallet fields. */
  readonly name: string;
  readonly kind: AccountKind;
  /** Goals only: the account this one sits inside. */
  readonly parentId?: string | undefined;
  /** Goals only. */
  readonly target?: Centavos | undefined;
  readonly deadline?: IsoDate | undefined;
  readonly openedDate?: IsoDate | undefined;
  /** Hidden from pickers, still counted, still shown under "Retired". */
  readonly archived: boolean;
  /**
   * Physical cash or an account. Only used to name a transfer correctly:
   * bank to cash is a withdrawal, cash to bank is a deposit. Absent means
   * bank, because all but one account is one.
   */
  readonly channel?: "cash" | "bank" | undefined;
}

// ── Balances ───────────────────────────────────────────────────────────────

export interface AccountBalance {
  readonly account: Account;
  readonly balance: Centavos;
}

export function accountBalances(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): AccountBalance[] {
  const computed = allWalletBalances(transactions);
  return accounts.map((account) => ({
    account,
    balance: computed.get(account.name) ?? 0,
  }));
}

const sumOf = (
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  kinds: readonly AccountKind[],
): Centavos => {
  const set = new Set(kinds);
  return accounts
    .filter((a) => set.has(a.kind))
    .reduce((total, a) => total + walletBalance(transactions, a.name), 0);
};

/**
 * Money available to spend: rule A3.
 *
 * Reserves, savings and goals are deliberately excluded. That is the whole
 * point of setting money aside: the daily budget should not offer it back.
 */
export const spendableBalance = (
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): Centavos => sumOf(accounts, transactions, ["spending"]);

export const reserveBalance = (
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): Centavos => sumOf(accounts, transactions, ["reserve"]);

export const savingsBalance = (
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): Centavos => sumOf(accounts, transactions, ["savings", "goal"]);

/** Rule A2: every kind counts. Money hidden from yourself is still yours. */
export const totalHoldings = (
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): Centavos => sumOf(accounts, transactions, ["spending", "reserve", "savings", "goal"]);

// ── Goals ──────────────────────────────────────────────────────────────────

export type GoalStatus = "active" | "reached" | "matured" | "archived";

export interface GoalProgress {
  readonly account: Account;
  readonly saved: Centavos;
  readonly target: Centavos;
  readonly remaining: Centavos;
  /** 0–1+. Can exceed 1; overshooting is fine (rule G7). */
  readonly progress: number;
  readonly status: GoalStatus;
  readonly daysLeft?: number | undefined;
  /** What you need to put in each month to make the deadline. */
  readonly requiredPerMonth?: Centavos | undefined;
  readonly onTrack: boolean;
}

const DAYS_PER_MONTH = 30.44;

/**
 * A goal's progress. Status is derived (rule G3), never stored, so it can
 * never disagree with the balance.
 */
export function goalProgress(
  goal: Account,
  transactions: readonly Transaction[],
  asOf: IsoDate = today(),
): GoalProgress {
  const saved = walletBalance(transactions, goal.name);
  const target = goal.target ?? 0;
  const remaining = Math.max(0, target - saved);
  const progress = target > 0 ? saved / target : 0;

  const daysLeft = goal.deadline ? daysBetween(asOf, goal.deadline) : undefined;

  let status: GoalStatus;
  if (goal.archived) status = "archived";
  else if (target > 0 && saved >= target) status = "reached";
  else if (daysLeft !== undefined && daysLeft < 0) status = "matured";
  else status = "active";

  /**
   * Required pace. Only meaningful while there is still time and still a gap,
   * a matured goal does not need a monthly figure, it needs a decision.
   */
  const requiredPerMonth =
    status === "active" && remaining > 0 && daysLeft !== undefined && daysLeft > 0
      ? Math.round(remaining / Math.max(1, daysLeft / DAYS_PER_MONTH))
      : undefined;

  /**
   * On track compares progress against elapsed time, not against the calendar
   * alone: being 40% funded is fine at 30% elapsed and behind at 80%.
   */
  let onTrack = true;
  if (status === "active" && goal.deadline && goal.openedDate && target > 0) {
    const total = daysBetween(goal.openedDate, goal.deadline);
    const gone = daysBetween(goal.openedDate, asOf);
    if (total > 0) onTrack = progress >= gone / total;
  }

  return {
    account: goal,
    saved,
    target,
    remaining,
    progress,
    status,
    daysLeft,
    requiredPerMonth,
    onTrack,
  };
}

export function goalsOf(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  asOf: IsoDate = today(),
): GoalProgress[] {
  return accounts
    .filter((a) => a.kind === "goal")
    .map((g) => goalProgress(g, transactions, asOf))
    .sort((a, b) => {
      // Things needing a decision first, then by soonest deadline.
      const rank: Record<GoalStatus, number> = { matured: 0, reached: 1, active: 2, archived: 3 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9);
    });
}

/** Goals sitting inside one parent, for showing what a balance is spoken for. */
export function goalsInside(
  accounts: readonly Account[],
  parentId: string,
): Account[] {
  return accounts.filter((a) => a.kind === "goal" && a.parentId === parentId);
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface AccountIssue {
  readonly field: "name" | "kind" | "parentId" | "target" | "deadline";
  readonly message: string;
}

export function validateAccount(
  account: Account,
  all: readonly Account[],
  transactions: readonly Transaction[],
): AccountIssue[] {
  const issues: AccountIssue[] = [];
  const name = account.name.trim();

  if (!name) {
    issues.push({ field: "name", message: "Give the account a name." });
  } else if (
    all.some((a) => a.id !== account.id && a.name.trim().toLowerCase() === name.toLowerCase())
  ) {
    issues.push({ field: "name", message: `"${name}" already exists.` });
  }

  if (account.kind === "goal") {
    if (!account.parentId) {
      issues.push({ field: "parentId", message: "Pick the account this goal sits inside." });
    }
    if (!account.target || account.target <= 0) {
      issues.push({ field: "target", message: "Set a target above ₱0.00." });
    }
    if (!account.deadline) {
      issues.push({ field: "deadline", message: "Set a deadline." });
    }
  }

  // Rule G6 / A6: money must move before an account can go.
  if (account.archived && walletBalance(transactions, account.name) !== 0) {
    issues.push({
      field: "name",
      message: "This still holds money. Move it out before archiving.",
    });
  }

  return issues;
}

export interface ArchiveCheck {
  readonly ok: boolean;
  readonly balance: Centavos;
  readonly reason?: string | undefined;
  /** Suggested next step when it cannot be archived yet. */
  readonly fix?: string | undefined;
}

/**
 * Whether an account can be marked inactive: a used-up Extra Cash, or a goal
 * you have finished with.
 *
 * Refused while it still holds money, because archiving would hide a balance
 * that still counts toward net worth: the total would stop matching the parts
 * shown beside it. Move the money first, and the app never has to move it for
 * you (rule G4).
 */
export function canArchive(
  account: Account,
  transactions: readonly Transaction[],
): ArchiveCheck {
  const balance = walletBalance(transactions, account.name);

  if (balance === 0) return { ok: true, balance };

  const isGoal = account.kind === "goal";
  return {
    ok: false,
    balance,
    reason: `${account.name} still holds money.`,
    fix: isGoal
      ? "Spend it, or transfer it back to the parent account, then mark the goal done."
      : "Transfer the balance to another account first.",
  };
}

/** Accounts offered in pickers: active ones only. */
export const activeAccounts = (accounts: readonly Account[]): Account[] =>
  accounts.filter((a) => !a.archived);

/** Archived accounts, for the "Inactive" section in Settings. */
export const inactiveAccounts = (accounts: readonly Account[]): Account[] =>
  accounts.filter((a) => a.archived);

/** Rows that would be rewritten by renaming an account. */
export function renameImpact(
  transactions: readonly Transaction[],
  from: string,
): number {
  return transactions.filter((t) => t.fromWallet === from || t.toWallet === from).length;
}

/**
 * Rename an account everywhere it appears.
 *
 * Leaving history pointing at the old name would silently split the account in
 * two and corrupt every balance, so the rewrite is all-or-nothing.
 */
export function renameAccount(
  transactions: readonly Transaction[],
  from: string,
  to: string,
): Transaction[] {
  const next = to.trim();
  if (!next || next === from) return [...transactions];

  return transactions.map((t) =>
    t.fromWallet === from || t.toWallet === from
      ? {
          ...t,
          fromWallet: t.fromWallet === from ? next : t.fromWallet,
          toWallet: t.toWallet === from ? next : t.toWallet,
        }
      : t,
  );
}

/** Same, for a spending type: it is the key every ranking groups by. */
export function renameItem(
  transactions: readonly Transaction[],
  from: string,
  to: string,
): Transaction[] {
  const next = to.trim();
  if (!next || next === from) return [...transactions];
  return transactions.map((t) => (t.item === from ? { ...t, item: next } : t));
}

// ── Migration from the old flat lists ──────────────────────────────────────

/** Names that read as a set-aside stash rather than a spending wallet. */
export const RESERVE_PATTERN = /\(reserve\)|reserved|hidden/i;

/** "Maya Bank (Drone)": a parent name with a qualifier in brackets. */
export const GOAL_PATTERN = /^(.+?)\s*\((.+)\)$/;

/**
 * Build the account list from the old wallet/savings lists plus whatever the
 * ledger references.
 *
 * Classification only: no balance moves. `accounts.test.ts` asserts that.
 */
export function migrateAccounts(
  wallets: readonly string[],
  savings: readonly string[],
  transactions: readonly Transaction[],
): Account[] {
  const seen = new Map<string, Account>();
  const declared = new Set([...wallets, ...savings]);

  const add = (name: string, kind: AccountKind, archived: boolean): void => {
    if (!name || seen.has(name)) return;
    seen.set(name, { id: slug(name), name, kind, archived });
  };

  for (const w of wallets) add(w, RESERVE_PATTERN.test(w) ? "reserve" : "spending", false);
  for (const s of savings) add(s, "savings", false);

  // Anything the ledger references but the lists never declared.
  for (const name of allWalletBalances(transactions).keys()) {
    if (declared.has(name) || seen.has(name)) continue;
    add(name, RESERVE_PATTERN.test(name) ? "reserve" : "savings", true);
  }

  /**
   * "Maya Bank (Drone)" next to "Maya Bank (Personal savings)" is a goal, not
   * a separate account: the shared prefix is the parent.
   */
  const savingsNames = new Set(savings);
  for (const account of [...seen.values()]) {
    if (account.kind !== "savings" || savingsNames.has(account.name)) continue;

    const match = GOAL_PATTERN.exec(account.name);
    const prefix = match?.[1];
    if (!prefix) continue;

    const parent = [...seen.values()].find(
      (a) => a.name !== account.name && a.name.startsWith(prefix) && savingsNames.has(a.name),
    );
    if (!parent) continue;

    seen.set(account.name, { ...account, kind: "goal", parentId: parent.id });
  }

  return [...seen.values()];
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const makeAccountId = slug;
