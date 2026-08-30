/**
 * Transfer classification.
 *
 * In the Excel, "Money Send" and "Transaction Fee" are spending types you pick
 * by hand. That is the wrong shape: they are not categories of spending, they
 * are consequences of where the money went. Picking them is a chore, and
 * forgetting to pick them silently loses money from the totals. Record #8 is
 * exactly that: a PHP 15.00 transfer fee with the item left blank, so it never
 * reached a single report. Record #406 is the mirror image, labelled as a fee
 * while charging none.
 *
 * ── The rule, derived from the ledger ─────────────────────────────────────
 *
 * Verified against all 440 historical rows, with no exceptions:
 *
 *   toWallet is blank  ->  the money left your accounts entirely.
 *                          Someone else has it now. The amount is spending.
 *                          The Excel calls this "Money Send" (3 rows, 3/3).
 *
 *   toWallet is set    ->  the money is still yours, in another pocket.
 *                          Net worth did not move. Only the FEE is spending.
 *                          The Excel calls this "Transaction Fee" (26 rows).
 *
 * That single question, "did it leave your accounts?", answers every scenario:
 *
 *   Send money to a person        blank destination    amount is spending
 *   Send to your own other bank   named destination    fee only
 *   Withdraw from e-wallet        named destination    fee only
 *   Deposit cash into a bank      named destination    fee only
 *   Move into a reserve or goal   named destination    fee only
 *
 * A named destination is treated as yours even when the account is archived.
 * "Hidden cash (fieldtrip)" and "Maya Bank (Drone)" are both retired accounts
 * that still appear as destinations in history, and PHP 13,000.00 moved into
 * the first one. Treating an unrecognised name as external would book that as
 * money given away.
 *
 * ── What this changes ─────────────────────────────────────────────────────
 *
 * August 2026 is unchanged at PHP 11,291.37, so the pinned month still holds.
 * The 2026 annual total rises by PHP 4,115.00, in two parts:
 *
 *   PHP    15.00  record #8's fee, which no report ever saw.
 *   PHP 4,100.00  the three Money Send rows. The Excel showed these in the
 *                 spending ranking but never added them to the month total,
 *                 so the ranking and the total disagreed by that much.
 *
 * `transfers.test.ts` pins both halves separately, so a future change that
 * moves either one has to say which.
 */

import type { Centavos } from "./money";
import type { Transaction } from "./types";

/** Where a transfer's money ended up. */
export type TransferKind =
  /** Left your accounts. Someone else has it. */
  | "sent-out"
  /** Bank or e-wallet to physical cash. */
  | "withdrawal"
  /** Physical cash into a bank or e-wallet. */
  | "deposit"
  /** Into a reserve, a savings account, or a goal. */
  | "set-aside"
  /** Out of a reserve, savings, or goal, back into spending money. */
  | "drawn-down"
  /** Between two accounts of the same sort. */
  | "moved";

export interface TransferFacts {
  readonly kind: TransferKind;
  /** Short label for a row or a badge. */
  readonly label: string;
  /** One line saying what happened to the money. */
  readonly explanation: string;
  /** What this row contributes to spending. Never negative. */
  readonly spending: Centavos;
  /**
   * The Excel spending type this corresponds to, kept so historical rows and
   * new rows agree and every existing report keeps working.
   */
  readonly item: "Money Send" | "Transaction Fee" | "";
  /** True when net worth is unchanged, which is every case but `sent-out`. */
  readonly internal: boolean;
}

/** What an account is, as far as a transfer is concerned. */
export interface AccountFacts {
  /** `cash` covers physical money; `bank` covers e-wallets and banks alike. */
  readonly channel: "cash" | "bank";
  /** True for reserve, savings, and goal accounts. */
  readonly setAside: boolean;
}

export type AccountLookup = (name: string) => AccountFacts | undefined;

/**
 * Classify one transfer.
 *
 * `lookup` describes your accounts. An unknown name is still treated as yours,
 * because retired accounts drop out of the list but stay in history. Only a
 * blank destination means the money left.
 */
export function classifyTransfer(t: Transaction, lookup: AccountLookup): TransferFacts {
  const to = t.toWallet.trim();
  const from = t.fromWallet.trim();

  if (to === "") {
    return {
      kind: "sent-out",
      label: "Sent out",
      explanation: "Money left your accounts. It is spending.",
      // The fee rides along: sending PHP 100 that costs PHP 15 cost you 115.
      spending: t.amount + t.fee,
      item: "Money Send",
      internal: false,
    };
  }

  const src = lookup(from);
  const dst = lookup(to);
  const spending = t.fee;
  const item = t.fee > 0 ? "Transaction Fee" : "";
  const feeNote =
    t.fee > 0
      ? " Only the fee is spending."
      : " Nothing here is spending.";

  const base = { spending, item, internal: true } as const;

  if (dst?.setAside && !src?.setAside) {
    return {
      ...base,
      kind: "set-aside",
      label: "Set aside",
      explanation: "Still yours, now earmarked." + feeNote,
    };
  }

  if (src?.setAside && !dst?.setAside) {
    return {
      ...base,
      kind: "drawn-down",
      label: "Drawn down",
      explanation: "Taken back out of what you set aside." + feeNote,
    };
  }

  if (src?.channel === "bank" && dst?.channel === "cash") {
    return {
      ...base,
      kind: "withdrawal",
      label: "Withdrawal",
      explanation: "Turned into cash in your hand." + feeNote,
    };
  }

  if (src?.channel === "cash" && dst?.channel === "bank") {
    return {
      ...base,
      kind: "deposit",
      label: "Deposit",
      explanation: "Cash put into an account." + feeNote,
    };
  }

  return {
    ...base,
    kind: "moved",
    label: "Moved",
    explanation: "Same money, different pocket." + feeNote,
  };
}

/**
 * What a transfer contributes to a spending total.
 *
 * Zero for every non-transfer, so a caller can add this over the whole ledger
 * without filtering first.
 */
export function transferSpending(t: Transaction, lookup: AccountLookup): Centavos {
  return t.type === "Transfer" ? classifyTransfer(t, lookup).spending : 0;
}

/**
 * Did this money leave your accounts?
 *
 * The only question the totals need, and it needs no account list to answer.
 * A blank destination means someone else has the money now.
 */
export function leftYourAccounts(t: Transaction): boolean {
  return t.type === "Transfer" && t.toWallet.trim() === "";
}

/**
 * What a transfer costs, derived from where the money went.
 *
 * Zero for anything that is not a transfer, so callers can add it across the
 * whole ledger without filtering first.
 */
export function transferCost(t: Transaction): Centavos {
  if (t.type !== "Transfer") return 0;
  return leftYourAccounts(t) ? t.amount + t.fee : t.fee;
}

/**
 * Which ranking bucket a transfer's cost belongs in.
 *
 * The two names are kept because 37 historical rows already carry them and
 * every report the owner knows uses them. What changed is that they are now
 * worked out rather than typed in.
 */
export function transferBucket(t: Transaction): "Money Send" | "Transaction Fee" | null {
  if (t.type !== "Transfer") return null;
  if (leftYourAccounts(t)) return "Money Send";
  return t.fee > 0 ? "Transaction Fee" : null;
}

/**
 * Rows whose stored item disagrees with what the destination implies.
 *
 * Reports only. These are the rows the Excel lost money on, and the fix is a
 * one-field edit the owner should see and approve, not a silent rewrite.
 */
export function misfiledTransfers(
  transactions: readonly Transaction[],
  lookup: AccountLookup,
): { transaction: Transaction; expected: string; stored: string }[] {
  const out: { transaction: Transaction; expected: string; stored: string }[] = [];

  for (const t of transactions) {
    if (t.type !== "Transfer") continue;
    const expected = classifyTransfer(t, lookup).item;
    const stored = t.item.trim();
    if (expected !== stored) out.push({ transaction: t, expected, stored });
  }
  return out;
}

/**
 * Build a lookup from the account list.
 *
 * `channel` is optional on an account: an account without one is assumed to be
 * a bank or e-wallet, because that is what all but one of them are.
 */
export function accountLookup(
  accounts: readonly { name: string; kind: string; channel?: "cash" | "bank" | undefined }[],
): AccountLookup {
  const byName = new Map<string, AccountFacts>();
  for (const a of accounts) {
    byName.set(a.name.trim().toLowerCase(), {
      channel: a.channel ?? "bank",
      setAside: a.kind === "reserve" || a.kind === "savings" || a.kind === "goal",
    });
  }
  return (name) => byName.get(name.trim().toLowerCase());
}
