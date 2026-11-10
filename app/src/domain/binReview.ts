/**
 * "Which ones would be a mistake to put back?": the bin, entry by entry,
 * with what putting each back would do.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026: "Go through everything in my recycle bin.
 * Which ones would be a mistake to put back, and what would each do to my
 * balances? Don't put anything back." The chat listed the bin, newest
 * first, under a green **Restore all 12** button, and answered nothing it
 * was asked. Twelve entries put back at once would have paid a Maya Credit
 * payment the ledger already holds a second time and taken two wallets
 * below zero.
 *
 * So a question that asks about the bin rather than for it is answered
 * here: each entry with the wallets it would move and by how much, against
 * what they hold now; whether the ledger already has it (the same kind of
 * entry, the same wallets, the same amount, within two days), or already has
 * one like it on the same day, which is how an earlier try at a payment
 * looks; and whether it would take a wallet below zero. Then all of them
 * together. Nothing is put back from here, and no button offers to.
 */
import { allWalletBalances, walletDelta } from "./balances";
import { addDays, formatMedium } from "./dates";
import { formatMoney } from "./money";
import type { DeletedTransaction, Transaction } from "./types";

/** Asking about the bin rather than for it: what to put back, what it would do. */
const REVIEW =
  /\b(?:mistakes?|should(?:n'?t|\s+not)?\s+(?:i\s+)?(?:put|restore|bring|recover)|safe\s+to\s+(?:put|restore|bring|recover)|what\s+would\s+(?:each|it|they|that|those|these)(?:\s+one)?\s+do|what\s+happens\s+if|effects?|affect|balances?|go\s+through|review|which\s+ones?\s+(?:should|would|are|is|can)|worth\s+(?:putting|restoring)|dapat\s+(?:ko\s+)?(?:bang\s+)?ibalik)\b/i;

/** "Don't put anything back", "just tell me", "huwag mong ibalik". */
const HOLD_BACK =
  /\b(?:don'?t|do\s+not|never|wag|huwag)\s+(?:mo(?:ng)?\s+)?(?:put|restore|bring|recover|ibalik|undo|touch)\b|\bjust\s+(?:tell|look|check|show)\b|\bwithout\s+(?:restoring|putting)\b/i;

export function asksBinReview(text: string): boolean {
  return REVIEW.test(text) || HOLD_BACK.test(text);
}

/** The owner said not to put anything back. */
export function holdsBack(text: string): boolean {
  return HOLD_BACK.test(text);
}

export interface BinVerdict {
  readonly row: DeletedTransaction;
  /** What putting it back would do to each wallet, in centavos. */
  readonly moves: readonly { readonly wallet: string; readonly by: number; readonly after: number }[];
  /** The same entry, already in the ledger. */
  readonly twin: Transaction | null;
  /** An entry like it in the ledger on the same day or the next: an earlier or later try at the same thing. */
  readonly like: Transaction | null;
  /** Bin entries with the same record number: parts of one entry, deleted together. */
  readonly parts: number;
  readonly mistake: boolean;
}

export interface BinReview {
  readonly verdicts: readonly BinVerdict[];
  /** Every wallet the bin would move, what it holds now, and after all of it is put back. */
  readonly together: readonly { readonly wallet: string; readonly now: number; readonly by: number; readonly after: number }[];
}

const near = (a: string, b: string, days: number): boolean => a >= addDays(b, -days) && a <= addDays(b, days);
const sameSides = (a: Transaction, b: Transaction): boolean =>
  a.type === b.type && a.fromWallet.trim() === b.fromWallet.trim() && a.toWallet.trim() === b.toWallet.trim();

/** What each entry in the bin would do if put back, and all of them together. */
export function binReview(deleted: readonly DeletedTransaction[], transactions: readonly Transaction[]): BinReview {
  const balances = allWalletBalances(transactions);
  const rows = [...deleted].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || b.recordNumber - a.recordNumber);
  const walletsOf = (t: Transaction): string[] => [t.fromWallet.trim(), t.toWallet.trim()].filter(Boolean);
  const verdicts = rows.map((row): BinVerdict => {
    const moves = [...new Set(walletsOf(row))]
      .map((wallet) => {
        const by = walletDelta(row, (w) => w.trim() === wallet);
        const now = balances.get(wallet) ?? 0;
        return { wallet, by, after: now + by };
      })
      .filter((m) => m.by !== 0);
    const twin = transactions.find((t) => t.id !== row.id && sameSides(t, row) && t.total === row.total && near(t.date, row.date, 2)) ?? null;
    const like = twin ? null : (transactions.find((t) => t.id !== row.id && sameSides(t, row) && near(t.date, row.date, 1) && (row.type === "Debt" || Math.abs(t.total - row.total) <= Math.max(1, Math.round(row.total / 10)))) ?? null);
    const parts = deleted.filter((d) => d.recordNumber === row.recordNumber).length;
    const below = moves.some((m) => m.by < 0 && m.after < 0);
    return { row, moves, twin, like, parts, mistake: twin !== null || like !== null || below };
  });
  const sums = new Map<string, number>();
  for (const v of verdicts) for (const m of v.moves) sums.set(m.wallet, (sums.get(m.wallet) ?? 0) + m.by);
  const together = [...sums.entries()]
    .filter(([, by]) => by !== 0)
    .map(([wallet, by]) => ({ wallet, now: balances.get(wallet) ?? 0, by, after: (balances.get(wallet) ?? 0) + by }))
    .sort((a, b) => a.by - b.by);
  return { verdicts, together };
}

const no = (n: number): string => `#${String(n).padStart(4, "0")}`;
/** A balance, with the minus sign money uses everywhere. */
const level = (c: number): string => (c < 0 ? `−${formatMoney(-c)}` : formatMoney(c));
const moved = (m: { readonly wallet: string; readonly by: number; readonly after: number }): string =>
  `${m.wallet} ${m.by < 0 ? "down" : "up"} ${formatMoney(Math.abs(m.by))}, to ${level(m.after)}`;

function line(v: BinVerdict): string {
  const r = v.row;
  const what = `${no(r.recordNumber)}, ${formatMedium(r.date)}, ${r.type}${r.item ? ` ${r.item}` : ""}${r.description && !r.item ? ` "${r.description.slice(0, 40)}"` : ""} ${formatMoney(r.total)}${r.fromWallet ? ` from ${r.fromWallet}` : ""}${r.toWallet ? ` to ${r.toWallet}` : ""}`;
  const why: string[] = [];
  if (v.twin) why.push(`the ledger already has it as ${no(v.twin.recordNumber)}, ${formatMedium(v.twin.date)}, ${formatMoney(v.twin.total)}, so it would count twice`);
  else if (v.like) why.push(`the ledger already has a ${v.like.type} like it${v.like.fromWallet ? ` from ${v.like.fromWallet}` : ""} on ${formatMedium(v.like.date)}, ${no(v.like.recordNumber)} ${formatMoney(v.like.total)}, so it looks like an earlier try at the same thing`);
  const sinks = v.moves.filter((m) => m.by < 0 && m.after < 0);
  if (sinks.length > 0) why.push(`it would take ${sinks.map((m) => `${m.wallet} below zero, to ${level(m.after)}`).join(" and ")}`);
  const effect = v.moves.length > 0 ? v.moves.map(moved).join("; ") : "no wallet moves";
  const parts = v.parts > 1 ? ` One of ${v.parts} parts of ${no(r.recordNumber)} in the bin.` : "";
  return `- ${what}${why.length > 0 ? `: ${why.join("; and ")}` : ""}. Putting it back: ${effect}.${parts}`;
}

/** The answer, said plainly: the mistakes first, then the rest, then all of it at once. */
export function binReviewWords(review: BinReview, heldBack: boolean): string {
  const { verdicts, together } = review;
  if (verdicts.length === 0) return "The bin is empty: there is nothing to put back.";
  const wrong = verdicts.filter((v) => v.mistake);
  const fine = verdicts.filter((v) => !v.mistake);
  const now = together.length > 0 ? ` against what the wallets hold now (${together.map((t) => `${t.wallet} ${level(t.now)}`).join(", ")})` : "";
  const out = [
    `${heldBack ? "**Nothing was put back.** " : ""}The bin holds ${verdicts.length} ${verdicts.length === 1 ? "entry" : "entries"}. What each would do if it were put back,${now}:`,
  ];
  if (wrong.length > 0) out.push(`**A mistake to put back (${wrong.length}):**\n${wrong.map(line).join("\n")}`);
  if (fine.length > 0) out.push(`**Fine to put back, if it really happened (${fine.length}):**\n${fine.map(line).join("\n")}`);
  if (together.length > 0) out.push(`**All ${verdicts.length} together:** ${together.map(moved).join("; ")}.`);
  out.push(`To put one back, say "restore ${no((fine[0] ?? verdicts[0] as BinVerdict).row.recordNumber)}", or press Restore on it in the Bin. Nothing is put back from here.`);
  return out.join("\n\n");
}
