/**
 * Rebuilding accounts from the ledger.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * On 2026-08-30 a race in `App.tsx` wrote an empty settings document over a
 * populated one in Firestore. The store swapped from the browser to Firestore
 * when auth resolved, and the save effect fired against the new store carrying
 * settings read from the old one. Every account disappeared.
 *
 * The transactions survived, because they live in a different collection and
 * nothing touched them. That is what makes recovery possible at all, and it is
 * the reason the ledger is the source of truth rather than the account list.
 *
 * ── The insight ───────────────────────────────────────────────────────────
 *
 * An account is not really defined by its row in settings. It is defined by
 * the transactions that name it. "Maya" exists because 200 rows say money
 * moved in or out of Maya. The settings row is a label on top of that: a kind,
 * an archived flag, a parent for a goal.
 *
 * So the names are always recoverable. The classification has to be guessed,
 * and this is honest about which parts are guesses.
 *
 * ── What is recovered, and what is not ────────────────────────────────────
 *
 *   RECOVERED EXACTLY   Every account name, and therefore every balance,
 *                       ranking and report that groups by name.
 *
 *   INFERRED            The kind. A name in brackets after a parent name is a
 *                       goal or a reserve; the rest are spending accounts.
 *                       The same rules `migrateAccounts` used on the original
 *                       Excel import.
 *
 *   LOST                Goal targets and deadlines, and which accounts were
 *                       archived. Nothing in a transaction records those, so
 *                       inventing them would be worse than leaving them blank.
 *                       A backup file restores them; this cannot.
 */

import { GOAL_PATTERN, makeAccountId, RESERVE_PATTERN } from "./accounts";
import type { Account } from "./accounts";
import type { Transaction } from "./types";

export interface RecoveryReport {
  readonly accounts: readonly Account[];
  /** Names found in the ledger, in order of how much moved through them. */
  readonly recovered: number;
  /** True when nothing needed recovering. */
  readonly alreadyPopulated: boolean;
  readonly note: string;
}

/**
 * Every account name the ledger mentions.
 *
 * Sorted by how many rows reference each one, so the accounts that matter come
 * first and the app's pickers are useful straight away.
 */
export function accountNamesInLedger(transactions: readonly Transaction[]): string[] {
  const counts = new Map<string, number>();

  const bump = (name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  };

  for (const t of transactions) {
    bump(t.fromWallet);
    bump(t.toWallet);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/**
 * Rebuild the account list.
 *
 * Returns the existing list untouched when it already has accounts: recovery
 * must never overwrite good data, which is the whole failure being recovered
 * from.
 */
export function recoverAccounts(
  transactions: readonly Transaction[],
  existing: readonly Account[],
): RecoveryReport {
  if (existing.length > 0) {
    return {
      accounts: existing,
      recovered: 0,
      alreadyPopulated: true,
      note: "Accounts are already present. Nothing was rebuilt.",
    };
  }

  const names = accountNamesInLedger(transactions);

  /**
   * The same rules `migrateAccounts` applied to the original Excel import,
   * reusing its patterns rather than a second copy that could drift.
   *
   * A bracketed suffix on a name that shares a prefix with another account is
   * a goal: "Maya Bank (Drone)" next to "Maya Bank (Personal savings)".
   */
  const accounts: Account[] = names.map((name) => {
    if (RESERVE_PATTERN.test(name)) {
      return { id: makeAccountId(name), name, kind: "reserve" as const, archived: false };
    }

    const match = GOAL_PATTERN.exec(name);
    const prefix = match?.[1];
    const parent = prefix
      ? names.find((other) => other !== name && other.startsWith(prefix))
      : undefined;

    if (parent) {
      return {
        id: makeAccountId(name),
        name,
        kind: "goal" as const,
        archived: false,
        parentId: makeAccountId(parent),
      };
    }

    // Everything else is somewhere money is spent from. The owner can move it
    // to savings in Settings; guessing harder would be guessing.
    return { id: makeAccountId(name), name, kind: "spending" as const, archived: false };
  });

  return {
    accounts,
    recovered: accounts.length,
    alreadyPopulated: false,
    note:
      accounts.length === 0
        ? "No account names appear in the ledger, so there is nothing to rebuild."
        : `Rebuilt ${accounts.length} accounts from ${transactions.length} transactions. Names and balances are exact. Kinds are inferred from the names, and goal targets, deadlines and archived flags cannot be recovered this way: restore a backup for those.`,
  };
}
