/**
 * Needs review, fixed in one press.
 *
 * The owner, 20 October 2026, after the flagged rows were listed with what to
 * do: "I said ai can do everything, mean if I need some fixes it can do it ...
 * do I re-enter it or something? I want something to fix it". The model then
 * said it could not fix rows from the chat, and named rows that were not in
 * the list.
 *
 * The checks still only report (CLAUDE.md §4). This works out, for each
 * finding with a fix that follows from the row itself, the same entry edited:
 * its record number kept, what it does to each wallet said, and nothing
 * changed until the owner presses Apply on its card. Every fix is tried on a
 * copy of the ledger first and the checks are run again, so a card never
 * offers a change that the checks would flag in its turn.
 */
import { walletDelta } from "./balances";
import { addDays, formatMedium } from "./dates";
import { actionableIssues, checkIntegrity, type Issue } from "./integrity";
import { formatMoney } from "./money";
import type { IsoDate, Transaction } from "./types";
import { cashWallet, feeInside } from "./withdrawal";

export interface ReviewFix {
  /** The rows as they are and as they would be. */
  readonly rows: readonly { readonly before: Transaction; readonly after: Transaction }[];
  /** What it changes, in a sentence, with what it does to each wallet. */
  readonly words: string;
  /** Fixes for the same row that exclude each other share a group: applying one sets the others aside. */
  readonly group?: string;
  /** Only right when what the sentence says is true: said so on the card. */
  readonly onlyIf?: string;
}

export interface ReviewFixes {
  readonly fixes: readonly ReviewFix[];
  /** Flagged rows nothing here can fix, with why. */
  readonly unfixed: readonly { readonly row: Transaction; readonly why: string }[];
  /** How many rows the checks would still flag with every first-choice fix applied. */
  readonly leftAfter: number;
}

const no = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;

/** What a set of edits does to each wallet, as "Cash goes down ₱52.00". */
export function walletEffects(rows: readonly { readonly before: Transaction; readonly after: Transaction }[], wallets: readonly string[]): string {
  const parts: string[] = [];
  for (const w of wallets) {
    const counts = (x: string): boolean => x === w;
    const change = rows.reduce((s, r) => s + walletDelta(r.after, counts) - walletDelta(r.before, counts), 0);
    if (change !== 0) parts.push(`${w} goes ${change > 0 ? "up" : "down"} ${formatMoney(Math.abs(change))}`);
  }
  return parts.length > 0 ? `${parts.join(", ")}.` : "No wallet changes: only the entry's own figures are put right.";
}

const flaggedIds = (transactions: readonly Transaction[], context: { readonly wallets: readonly string[]; readonly asOf?: IsoDate }): Set<string> =>
  new Set(actionableIssues(checkIntegrity(transactions, context)).flatMap((i) => i.ids));

const withRows = (transactions: readonly Transaction[], rows: readonly { readonly after: Transaction }[]): Transaction[] => {
  const byId = new Map(rows.map((r) => [r.after.id, r.after] as const));
  return transactions.map((t) => byId.get(t.id) ?? t);
};

export function reviewFixes(
  transactions: readonly Transaction[],
  context: { readonly wallets: readonly string[]; readonly asOf?: IsoDate },
): ReviewFixes {
  const issues = actionableIssues(checkIntegrity(transactions, context));
  const byId = new Map(transactions.map((t) => [t.id, t] as const));
  const cash = cashWallet(context.wallets);
  const fixes: ReviewFix[] = [];
  const fixed = new Set<string>();
  const unfixed: { row: Transaction; why: string }[] = [];

  // The machine's fee split out of a withdrawal, all of them on one card.
  const splits = issues
    .filter((i) => i.code === "fee-inside-withdrawal")
    .flatMap((i) => i.ids.map((id) => byId.get(id)).filter((t): t is Transaction => t !== undefined))
    .flatMap((t) => {
      const split = feeInside(t, cash);
      // Filed as the form files a transfer with a fee, or the fee is never counted as spending (the "uncategorised-fee" check).
      return split ? [{ before: t, after: { ...t, amount: split.cash, fee: split.fee, total: split.cash + split.fee, category: "Spending", item: "Transaction Fee" } as Transaction }] : [];
    });
  if (splits.length > 0) {
    const fees = splits.reduce((s, r) => s + r.after.fee, 0);
    fixes.push({
      rows: splits,
      words: `${splits.map((r) => no(r.before)).join(", ")}: the machine's fee split out of the cash, ${formatMoney(fees)} in fees in all. ${walletEffects(splits, context.wallets)}`,
    });
    for (const r of splits) fixed.add(r.before.id);
  }

  // A total that leaves out the fee: counted, or the fee was never charged.
  for (const issue of issues.filter((i) => i.code === "total-mismatch")) {
    for (const id of issue.ids) {
      const t = byId.get(id);
      if (!t || fixed.has(id)) continue;
      const counted = { before: t, after: { ...t, total: t.amount + t.fee } };
      fixes.push({
        rows: [counted],
        group: t.id,
        words: `${no(t)}: its ${formatMoney(t.fee)} fee counted in its total, ${formatMoney(t.amount + t.fee)} in all. ${walletEffects([counted], context.wallets)}`,
        onlyIf: `the ${formatMoney(t.fee)} fee was charged`,
      });
      if (t.fee > 0) {
        // A move between their own accounts with no fee carries no item, as the form saves it.
        const plain = t.type === "Transfer" && t.toWallet.trim() !== "" && t.item.trim().toLowerCase() === "transaction fee";
        const noFee = { before: t, after: { ...t, fee: 0, total: t.amount, ...(plain ? { item: "", category: "" } : {}) } as Transaction };
        fixes.push({
          rows: [noFee],
          group: t.id,
          words: `${no(t)}: no fee, ${formatMoney(t.amount)} in all. ${walletEffects([noFee], context.wallets)}`,
          onlyIf: "no fee was charged",
        });
      }
      fixed.add(id);
    }
  }

  /*
   * A wallet below zero at a day's close: nothing in that day's rows is wrong.
   * The money that came in next, within three days, is offered moved to that
   * day, when doing so clears it and the checks find nothing new; it is right
   * only if that money really arrived by then, and the card says so.
   */
  const firstChoice = withRows(transactions, fixes.filter((f, n) => !f.group || fixes.findIndex((g) => g.group === f.group) === n).flatMap((f) => f.rows));
  for (const issue of issues.filter((i) => i.code === "below-zero-day")) {
    const rows = issue.ids.map((id) => byId.get(id)).filter((t): t is Transaction => t !== undefined);
    const day = rows[0]?.date;
    const wallet = context.wallets.find((w) => issue.message.startsWith(`${w} closed `));
    const pending = rows.filter((t) => !fixed.has(t.id));
    if (!day || !wallet) {
      for (const t of pending) unfixed.push({ row: t, why: issue.message });
      continue;
    }
    const limit = addDays(day, 3);
    const next = [...transactions]
      .filter((t) => t.date > day && t.date <= limit && walletDelta(t, (w) => w === wallet) > 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.recordNumber - b.recordNumber))[0];
    const moved = next ? { before: next, after: { ...next, date: day } } : null;
    const clears = moved ? clearsWithoutNew(firstChoice, moved, issue, context) : false;
    if (moved && clears && !fixes.some((f) => f.rows.some((r) => r.before.id === moved.before.id))) {
      fixes.push({
        rows: [moved],
        words: `${wallet} closed ${formatMedium(day)} at ${formatMoney(-(issue.impact ?? 0))}, and nothing in that day's ${rows.length === 1 ? "row" : "rows"} (${rows.map(no).join(", ")}) is wrong. The next money into ${wallet} is ${no(next!)}, ${formatMoney(walletDelta(next!, (w) => w === wallet))} on ${formatMedium(next!.date)}: dated ${formatMedium(day)}, ${wallet} never goes below zero.`,
        onlyIf: `that money really reached ${wallet} by ${formatMedium(day)}`,
      });
      for (const t of pending) fixed.add(t.id);
      continue;
    }
    /*
     * Or the day's payments out of that wallet were made the day the money
     * came, after it: tried the same way, and offered only on that condition.
     */
    const out = rows.filter((t) => walletDelta(t, (w) => w === wallet) < 0 && !fixes.some((f) => f.rows.some((r) => r.before.id === t.id)));
    const later = next && out.length > 0 ? out.map((t) => ({ before: t, after: { ...t, date: next.date } })) : [];
    if (next && later.length > 0 && clearsWithoutNew(firstChoice, later, issue, context)) {
      fixes.push({
        rows: later,
        words: `${wallet} closed ${formatMedium(day)} at ${formatMoney(-(issue.impact ?? 0))}. The next money into ${wallet} is ${no(next)}, ${formatMoney(walletDelta(next, (w) => w === wallet))} on ${formatMedium(next.date)}: with ${later.map((r) => no(r.before)).join(", ")} dated ${formatMedium(next.date)}, ${wallet} never goes below zero. Balances today stay the same.`,
        onlyIf: `${later.length === 1 ? "it was" : "they were"} paid on ${formatMedium(next.date)}, after that money came in`,
      });
      for (const t of pending) fixed.add(t.id);
    } else {
      for (const t of pending) {
        unfixed.push({
          row: t,
          why: `${wallet} closed ${formatMedium(day)} below zero: money that came in by then is missing. Add it, dated that day, if you know what it was.`,
        });
      }
    }
  }

  // Everything else the checks flag: edited in the form, as before.
  for (const issue of issues) {
    for (const id of issue.ids) {
      const t = byId.get(id);
      if (t && !fixed.has(id) && !unfixed.some((u) => u.row.id === id)) unfixed.push({ row: t, why: issue.message });
    }
  }

  // Never a fix the checks would flag in turn: tried alone on the ledger as it is.
  const before = new Set(actionableIssues(checkIntegrity(transactions, context)).map(issueKey));
  const safe = fixes.filter((f) => actionableIssues(checkIntegrity(withRows(transactions, f.rows), context)).every((i) => before.has(issueKey(i)) || !i.ids.some((id) => f.rows.some((r) => r.after.id === id))));
  for (const f of fixes) {
    if (safe.includes(f)) continue;
    for (const r of f.rows) if (!unfixed.some((u) => u.row.id === r.before.id)) unfixed.push({ row: r.before, why: "Its fix would leave it flagged another way, so it is left for you to edit." });
  }
  fixes.splice(0, fixes.length, ...safe);

  const leftAfter = flaggedIds(
    withRows(transactions, fixes.filter((f, n) => !f.group || fixes.findIndex((g) => g.group === f.group) === n).flatMap((f) => f.rows)),
    context,
  ).size;
  return { fixes, unfixed, leftAfter };
}

const issueKey = (i: Issue): string => `${i.code}|${[...i.ids].sort().join(",")}`;

function clearsWithoutNew(
  ledger: readonly Transaction[],
  moved: { readonly before: Transaction; readonly after: Transaction } | readonly { readonly before: Transaction; readonly after: Transaction }[],
  issue: Issue,
  context: { readonly wallets: readonly string[]; readonly asOf?: IsoDate },
): boolean {
  const before = actionableIssues(checkIntegrity(ledger, context));
  const after = actionableIssues(checkIntegrity(withRows(ledger, Array.isArray(moved) ? moved : [moved]), context));
  const key = (i: Issue): string => `${i.code}|${[...i.ids].sort().join(",")}`;
  const had = new Set(before.map(key));
  const stillThere = after.some((i) => i.code === issue.code && i.message.split(" closed ")[0] === issue.message.split(" closed ")[0] && i.ids.some((id) => issue.ids.includes(id)));
  const fresh = after.some((i) => !had.has(key(i)));
  return !stillThere && !fresh;
}
