/**
 * Autofill: spec 5.12, ported from VBA Module8.
 *
 * Learns from the ledger and proposes the next field before you type it.
 * Suggestions render as grey ghost text; tapping or tabbing accepts.
 *
 * Everything here is a frequency count over history, no model, no network.
 * The VBA used an LLM only for free-text descriptions, with a local generator
 * as fallback; this is that local generator, and the LLM layer sits on top of
 * it later rather than replacing it.
 */

import type { Draft, Flow } from "./entry";
import type { Centavos } from "./money";
import type { Transaction } from "./types";

/** Most frequent value, ties broken by most recent use. */
function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let best = "";
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Most recent rows first: recency beats ancient history. */
function recent(transactions: readonly Transaction[], limit = 200): Transaction[] {
  return [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export interface Suggestions {
  readonly toWallet?: string;
  readonly fromWallet?: string;
  readonly category?: string;
  readonly item?: string;
  readonly status?: string;
  readonly description?: string;
  readonly fee?: Centavos;
}

/**
 * Suggest the fields the draft has not filled yet.
 *
 * Each suggestion is conditioned on what the user has already chosen, so the
 * proposal narrows as the form fills: picking "Bills" changes the item
 * suggestion from "Food" to whatever bill you usually pay.
 */
export function suggest(
  draft: Draft,
  transactions: readonly Transaction[],
): Suggestions {
  if (!draft.flow) return {};

  const history = recent(transactions);
  const sameFlow = history.filter((t) => t.type === draft.flow);
  const out: Suggestions = {};
  const s = out as Record<string, unknown>;

  // ── Wallets ──────────────────────────────────────────────────────────────
  if (draft.flow === "Revenue" && !draft.toWallet) {
    const w = mostCommon(sameFlow.map((t) => t.toWallet || t.fromWallet));
    if (w) s["toWallet"] = w;
  }

  if ((draft.flow === "Spending" || draft.flow === "Transfer") && !draft.fromWallet) {
    const w = mostCommon(sameFlow.map((t) => t.fromWallet));
    if (w) s["fromWallet"] = w;
  }

  if (draft.flow === "Transfer" && draft.fromWallet && !draft.toWallet) {
    const w = mostCommon(
      sameFlow.filter((t) => t.fromWallet === draft.fromWallet).map((t) => t.toWallet),
    );
    if (w) s["toWallet"] = w;
  }

  // ── Category, conditioned on the wallet ──────────────────────────────────
  if (draft.flow === "Spending" && !draft.category) {
    const pool = draft.fromWallet
      ? sameFlow.filter((t) => t.fromWallet === draft.fromWallet)
      : sameFlow;
    const c = mostCommon(pool.map((t) => t.category));
    if (c) s["category"] = c;
  }

  // ── Item, conditioned on the category ────────────────────────────────────
  if (!draft.item) {
    const pool = draft.category
      ? sameFlow.filter((t) => t.category === draft.category)
      : sameFlow;
    const i = mostCommon(pool.map((t) => t.item));
    if (i) s["item"] = i;
  }

  // ── Status, conditioned on the item ──────────────────────────────────────
  if (!draft.status) {
    const pool = draft.item
      ? sameFlow.filter((t) => t.item === draft.item)
      : sameFlow;
    const st = mostCommon(pool.map((t) => t.status));
    if (st) s["status"] = st;
  }

  // ── Description, reuse what was written for this item before ────────────
  if (!draft.description && draft.item) {
    const d = mostCommon(
      sameFlow.filter((t) => t.item === draft.item).map((t) => t.description),
    );
    if (d) s["description"] = d;
  }

  // ── Fee, from this exact wallet pair ─────────────────────────────────────
  if (draft.flow === "Transfer" && draft.fromWallet && draft.toWallet && !draft.fee) {
    const fee = predictFee(transactions, draft.fromWallet, draft.toWallet);
    if (fee > 0) s["fee"] = fee;
  }

  return out;
}

/**
 * The fee this wallet pair usually charges.
 *
 * Uses the most common non-zero fee rather than the mean, transfer fees are
 * fixed tiers (₱15, ₱18), so an average would propose a number that has never
 * actually been charged.
 */
export function predictFee(
  transactions: readonly Transaction[],
  fromWallet: string,
  toWallet: string,
): Centavos {
  const fees = transactions
    .filter(
      (t) =>
        t.type === "Transfer" &&
        t.fromWallet === fromWallet &&
        t.toWallet === toWallet &&
        t.fee > 0,
    )
    .map((t) => String(t.fee));

  const common = mostCommon(fees);
  return common ? Number(common) : 0;
}

/**
 * Bills and subscriptions likely due around a date.
 *
 * Each recurring item is predicted one month after it was last paid
 * (spec 5.9); anything landing within the window is surfaced on the entry
 * screen so a due bill can be logged in one tap.
 */
export function billsDueNear(
  transactions: readonly Transaction[],
  date: string,
  windowDays = 3,
): { item: string; expected: Centavos; dueDate: string }[] {
  const lastPaid = new Map<string, Transaction>();

  for (const t of transactions) {
    if (t.type !== "Spending") continue;
    if (t.category !== "Bills" && t.category !== "Subscriptions") continue;
    if (!t.item) continue;

    const prev = lastPaid.get(t.item);
    if (!prev || t.date > prev.date) lastPaid.set(t.item, t);
  }

  const target = new Date(date);
  const out: { item: string; expected: Centavos; dueDate: string }[] = [];

  for (const [item, t] of lastPaid) {
    const due = new Date(t.date);
    due.setMonth(due.getMonth() + 1);
    const diff = Math.round((due.getTime() - target.getTime()) / 86_400_000);

    if (Math.abs(diff) <= windowDays) {
      out.push({
        item,
        expected: t.total,
        dueDate: due.toISOString().slice(0, 10),
      });
    }
  }

  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Items ranked by use, for ordering a picker. */
export function frequentItems(
  transactions: readonly Transaction[],
  flow: Flow,
  category?: string,
  limit = 8,
): string[] {
  const counts = new Map<string, number>();

  for (const t of recent(transactions, 300)) {
    if (t.type !== flow) continue;
    if (category && t.category !== category) continue;
    if (!t.item) continue;
    counts.set(t.item, (counts.get(t.item) ?? 0) + 1);
  }

  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item]) => item);
}
