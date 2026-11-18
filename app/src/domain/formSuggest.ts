/**
 * What the Add form offers to fill in, and why.
 *
 * ── Why this replaced `autofill.suggest` for the form ──────────────────────
 *
 * The form's suggestions were the most common value over the last 200 rows
 * of the same type, whatever had been typed: every Spending row was offered
 * Food and Cash, a ₱239.00 subscription and a ₱20.00 parking fee alike. The
 * owner, 18 November 2026: "the autofill in entry is always innacurate".
 *
 * The chat already reads an entry far better (`infer.ts`): the words you
 * wrote, the item names in them, your plans, the note you keep on each kind,
 * the wallet a shop is paid from, and the wallet each kind is paid from. The
 * form now asks the same engine, so the form and the chat agree, and adds
 * the one thing the form knows that a sentence often does not say: the
 * amount, which picks out a bill or a subscription on its own.
 *
 * ── The rules ────────────────────────────────────────────────────────────
 *
 * 1. A field you filled is never suggested over.
 * 2. Every suggestion says why, in your history's own numbers.
 * 3. No suggestion beats a weak one: a habit counts only when it is most of
 *    the history it comes from, so a blind "Food" is not offered for
 *    everything any more. The model (`classifyItem`) is asked by the form
 *    for a description nothing here recognises.
 *
 * Money is integer centavos throughout (CLAUDE.md).
 */

import { predictFee } from "./autofill";
import type { Draft } from "./entry";
import { formatMoney, type Centavos } from "./money";
import { inferFromHistory } from "./infer";
import type { ReferenceLists, Transaction, TransactionCategory } from "./types";

export interface Suggested<T> {
  readonly value: T;
  /** One short line, in the owner's numbers: "Paid from Gcash, which is where 8 of these came from." */
  readonly why: string;
}

/** A kind, with the category it lives under: taking "Globe Postpaid" also takes Bills. */
export interface SuggestedItem extends Suggested<string> {
  readonly category: TransactionCategory;
}

export interface FormSuggestions {
  readonly item?: SuggestedItem;
  readonly category?: Suggested<TransactionCategory>;
  readonly fromWallet?: Suggested<string>;
  readonly toWallet?: Suggested<string>;
  readonly fee?: Suggested<Centavos>;
}

/** A habit is offered only when it is at least this share of the rows it comes from. */
const MOST = 0.6;
/** Rows of the same type the recent-habit fallback looks back over. */
const RECENT = 30;
/** A kind's own recent entries, for the wallet it is paid from now. */
const KIND_RECENT = 20;
/** How far back an amount is matched to a kind, in days. */
const AMOUNT_DAYS = 400;

function dayNumber(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? 0 : Math.floor(t / 86_400_000);
}

/** The commonest value and how many of `rows` have it, ties to the most recent. */
function commonest<T>(rows: readonly T[], key: (row: T) => string): { value: string; count: number } {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = key(row).trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let value = "";
  let count = 0;
  for (const [k, n] of counts) {
    if (n > count) {
      value = k;
      count = n;
    }
  }
  return { value, count };
}

/** The kinds on the owner's lists for a type, lower-cased, so a kind from years back is not offered today. */
function currentKinds(flow: Draft["flow"], reference: ReferenceLists): Set<string> {
  const names =
    flow === "Revenue"
      ? reference.revenueCategories
      : [...reference.spendingTypes.map((s) => (typeof s === "string" ? s : s.name)), ...reference.bills, ...reference.subscriptions];
  return new Set(names.map((n) => n.trim().toLowerCase()));
}

/** Rows saved before the one being typed, newest first. */
function newestFirst(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.recordNumber - a.recordNumber);
}

/**
 * The kind an amount picks out: ₱239.00 every month is the one
 * subscription, ₱999.00 the wifi. Only when that figure was nearly always
 * that kind, at least twice.
 */
function kindByAmount(draft: Draft, rows: readonly Transaction[], kinds: ReadonlySet<string>, today: number): Suggested<string> | null {
  const amount = draft.amount;
  if (amount === null || amount <= 0) return null;
  const same = rows.filter(
    (t) => t.type === draft.flow && t.amount === amount && kinds.has(t.item.trim().toLowerCase()) && today - dayNumber(t.date) <= AMOUNT_DAYS,
  );
  if (same.length < 2) return null;
  const { value, count } = commonest(same, (t) => t.item);
  if (!value || count < 2 || count / same.length < MOST) return null;
  /*
   * Words typed that say something else win over the figure: "Bought 1 ream
   * of paper" at ₱599.00 is not the postpaid plan that also costs ₱599.00.
   * With words, the figure counts only when they share one with that kind's
   * own entries or name.
   */
  const said = wordsOf(`${draft.description} ${draft.notes}`);
  if (said.size > 0) {
    const theirs = wordsOf([value, ...same.filter((t) => t.item === value).map((t) => t.description)].join(" "));
    if (![...said].some((w) => theirs.has(w))) return null;
  }
  return { value, why: `${formatMoney(amount)} was ${value} ${count} of ${same.length} times.` };
}

/** Words worth matching on: three letters or more, not the ones every entry has. */
const COMMON = new Set(["the", "and", "for", "from", "with", "buy", "bought", "paid", "pay", "payment", "send", "sent", "money", "using", "via", "used", "use", "for", "my", "our", "some", "this", "that", "today", "cash", "gcash", "maya"]);
function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !COMMON.has(w) && !/^\d+$/.test(w)),
  );
}

/** The line in `because` a field's guess came with, or a plain one. */
function reason(because: readonly string[], starts: RegExp, fallback: string): string {
  return because.find((b) => starts.test(b)) ?? fallback;
}

/**
 * What to offer for each field still empty in `draft`.
 *
 * `today` is the form's date, so an old amount habit is not offered for a
 * kind given up long ago.
 */
export function formSuggest(
  draft: Draft,
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  options: {
    /** What a wallet holds now, so one that cannot cover the amount is not offered. */
    readonly balanceOf?: (wallet: string) => Centavos;
  } = {},
): FormSuggestions {
  const flow = draft.flow;
  if (flow !== "Spending" && flow !== "Revenue" && flow !== "Transfer") return {};

  const rows = newestFirst(transactions.filter((t) => t.type === flow));
  const kinds = currentKinds(flow, reference);
  const accounts = [...reference.wallets, ...reference.savings];
  const today = dayNumber(draft.date || new Date().toISOString().slice(0, 10));
  const words = `${draft.description} ${draft.notes}`.trim();
  const out: {
    item?: SuggestedItem;
    category?: Suggested<TransactionCategory>;
    fromWallet?: Suggested<string>;
    toWallet?: Suggested<string>;
    fee?: Suggested<Centavos>;
  } = {};

  // ── The kind: the words first, then the amount ───────────────────────────
  let item = draft.item.trim();
  if (!item && (flow === "Spending" || flow === "Revenue")) {
    const read = words ? inferFromHistory({ ...draft, item: "" }, transactions, reference, words) : null;
    const byWords = read?.draft.item.trim() ?? "";
    const found = byWords ? { value: byWords, why: reason(read?.because ?? [], /^Booked as/, `Booked as ${byWords}.`) } : kindByAmount(draft, rows, kinds, today);
    const home = found ? categoryOf(found.value, flow, reference) : null;
    if (found && home) {
      out.item = { ...found, category: home };
      item = found.value;
    }
  }

  // ── The category and the wallets, from the kind ─────────────────────────
  if (item && (flow === "Spending" || flow === "Revenue")) {
    const read = inferFromHistory({ ...draft, item }, transactions, reference, words);
    const next = read.draft;
    if (!draft.category && next.category && flow === "Spending") {
      out.category = { value: next.category, why: reason(read.because, /^Filed under/, `Filed under ${next.category}.`) };
    }
    /*
     * Named in the words, or the shop's own habit, as the chat reads them.
     * Otherwise this kind's recent habit rather than its all-time one:
     * where Food was paid from two years ago says little about today.
     */
    const side: "fromWallet" | "toWallet" = flow === "Revenue" ? "toWallet" : "fromWallet";
    const said = reason(read.because, flow === "Revenue" ? /^Into/ : /^Paid from/, "");
    const fromWords = /as you said|mentioning/.test(said);
    /*
     * A wallet that cannot cover it is not where it was paid from, and
     * entries of about the same amount say more than the rest: a ₱20.00
     * snack and a ₱600.00 grocery run are paid differently.
     */
    const covers = (w: string): boolean => side !== "fromWallet" || !options.balanceOf || draft.amount === null || options.balanceOf(w) >= draft.amount + (draft.fee ?? 0);
    const kindRows = rows.filter((t) => t.item.trim().toLowerCase() === item.toLowerCase() && accounts.includes(t[side]) && covers(t[side])).slice(0, KIND_RECENT);
    const near = (t: Transaction): boolean => draft.amount !== null && draft.amount > 0 && t.amount * 2 >= draft.amount && t.amount <= draft.amount * 2;
    const alike = kindRows.filter(near);
    const habit = alike.length >= 3 ? commonest(alike, (t) => t[side]) : commonest(kindRows, (t) => t[side]);
    const pool = alike.length >= 3 ? alike : kindRows;
    const pick =
      fromWords && next[side] && accounts.includes(next[side])
        ? { value: next[side], why: said }
        : habit.value && habit.count / Math.max(1, pool.length) >= 0.5
          ? {
              value: habit.value,
              why:
                flow === "Revenue"
                  ? `Into ${habit.value}: ${habit.count} of your last ${pool.length} ${item} entries${pool === alike ? " of about this amount" : ""} landed there.`
                  : `Paid from ${habit.value}: ${habit.count} of your last ${pool.length} ${item} entries${pool === alike ? " of about this amount" : ""} came from it.`,
            }
          : null;
    if (pick && !draft[side]) out[side] = pick;
  }

  // ── No kind to go by: the recent habit, only when it is most of it ───────
  const recent = rows.slice(0, RECENT);
  if (flow === "Spending" && !draft.fromWallet && !out.fromWallet) {
    const { value, count } = commonest(recent, (t) => t.fromWallet);
    const enough = !options.balanceOf || draft.amount === null || options.balanceOf(value) >= draft.amount;
    if (value && accounts.includes(value) && enough && count / Math.max(1, recent.length) >= MOST) {
      out.fromWallet = { value, why: `${count} of your last ${recent.length} payments came from ${value}.` };
    }
  }
  if (flow === "Revenue" && !draft.toWallet && !out.toWallet) {
    const { value, count } = commonest(recent, (t) => t.toWallet);
    if (value && accounts.includes(value) && count / Math.max(1, recent.length) >= MOST) {
      out.toWallet = { value, why: `${count} of your last ${recent.length} entries of money in landed in ${value}.` };
    }
  }

  // ── A transfer: where it usually goes from here, and where it comes from ──
  if (flow === "Transfer") {
    if (!draft.fromWallet && draft.toWallet) {
      const read = inferFromHistory(draft, transactions, reference, words);
      if (read.draft.fromWallet && accounts.includes(read.draft.fromWallet)) {
        out.fromWallet = { value: read.draft.fromWallet, why: reason(read.because, /^From/, `From ${read.draft.fromWallet}.`) };
      }
    }
    if (draft.fromWallet && !draft.toWallet && draft.sentOut !== true) {
      const from = rows.filter((t) => t.fromWallet === draft.fromWallet && t.toWallet.trim() !== "").slice(0, RECENT);
      const { value, count } = commonest(from, (t) => t.toWallet);
      if (value && value !== draft.fromWallet && accounts.includes(value) && count >= 2 && count / from.length >= 0.5) {
        out.toWallet = { value, why: `${count} of your last ${from.length} transfers from ${draft.fromWallet} went to ${value}.` };
      }
    }
    const from = draft.fromWallet || out.fromWallet?.value || "";
    const to = draft.toWallet || out.toWallet?.value || "";
    if (from && to && !draft.fee) {
      const fee = predictFee(transactions, from, to);
      if (fee > 0) out.fee = { value: fee, why: `The fee from ${from} to ${to} is usually ${formatMoney(fee)}.` };
    }
  }

  return out;
}

/** The category a kind lives under on the owner's lists, or null when it is on none of them. */
export function categoryOf(item: string, flow: Draft["flow"], reference: ReferenceLists): TransactionCategory | null {
  const k = item.trim().toLowerCase();
  const has = (list: readonly string[]): boolean => list.some((n) => n.trim().toLowerCase() === k);
  if (flow === "Revenue") return has(reference.revenueCategories) ? "Revenue" : null;
  if (has(reference.bills)) return "Bills";
  if (has(reference.subscriptions)) return "Subscriptions";
  if (has(reference.spendingTypes.map((s) => (typeof s === "string" ? s : s.name)))) return "Spending";
  return null;
}
