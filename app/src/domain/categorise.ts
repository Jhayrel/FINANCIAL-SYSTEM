/**
 * Choosing a category for an entry.
 *
 * ── Where the feedback loop actually lives ────────────────────────────────
 *
 * The usual design for this stores AI suggestions, watches for the user
 * correcting one, and keeps those corrections in a side table to feed back as
 * examples later. That machinery is unnecessary here, and worse than nothing,
 * because it would be a second copy of something the ledger already holds.
 *
 * A correction in this app is just the category on the saved row. So the
 * examples come straight out of the transactions, which means:
 *
 *   - Correcting a suggestion improves the next one, with no extra storage,
 *     no sync, and nothing to keep consistent with Firestore.
 *   - A category the owner typed by hand years ago is as good an example as
 *     one they fixed this morning, which is correct: both are their own
 *     labelling, and both are what "their style" means.
 *   - There is no stale corrections table to migrate, back up, or restore.
 *
 * ── The rules the model works under ───────────────────────────────────────
 *
 *   1. It picks from a fixed list. It never invents a category, because a
 *      category that exists only on one row breaks every total that groups by
 *      category, quietly.
 *   2. It sees the owner's own past labels for similar items, which teaches
 *      their style without any training.
 *   3. It may say it is unsure. A flagged guess the owner can check beats a
 *      confident wrong answer, and forcing a choice produces the latter.
 *
 * Nothing here calls a model. This module decides what may be asked and what
 * may be believed; `data/aiClient.ts` does the asking.
 */

import type { Draft, Flow } from "./entry";
import type { ReferenceLists, Transaction } from "./types";

export type Confidence = "high" | "medium" | "low";

export interface CategoryExample {
  readonly item: string;
  readonly category: string;
}

export interface CategoryRequest {
  /** The block of text the model is given. Structured fields only. */
  readonly fields: string;
  /** The list it must choose from, in the order shown to it. */
  readonly allowed: readonly string[];
}

export type CategoryPlan =
  /** History already answers this. No request needed. */
  | { readonly kind: "known"; readonly category: string; readonly seen: number }
  /** Nothing to go on. Ask, with these fields and this list. */
  | { readonly kind: "ask"; readonly request: CategoryRequest }
  /** Not enough filled in, or no list to choose from. */
  | { readonly kind: "not-yet" };

/** Where an unsure answer lands. Always last in the list, so it is offered. */
export const UNSURE = "Uncategorised";

/**
 * The categories that are valid for this flow.
 *
 * Spending picks from the spending types plus the two recurring buckets;
 * revenue picks from the revenue categories. Offering the wrong set is how a
 * bill ends up filed as income, which is the mistake this whole app exists to
 * stop repeating.
 */
export function allowedCategories(flow: Flow | "", reference: ReferenceLists): string[] {
  if (flow === "Spending") {
    return [
      ...reference.spendingTypes.map((t) => t.name),
      "Bills",
      "Subscriptions",
      UNSURE,
    ].filter(unique);
  }

  if (flow === "Revenue") {
    return [...reference.revenueCategories, UNSURE].filter(unique);
  }

  // Transfer, Debt and Opening are decided by the flow, not by a category.
  return [];
}

const unique = <T>(value: T, index: number, all: T[]): boolean =>
  all.indexOf(value) === index;

/**
 * How this item has been filed before.
 *
 * Most recent first, because the most recent labelling is the current
 * intention: a category the owner changed their mind about six months ago
 * should not outvote what they have done since.
 */
export function pastLabels(
  transactions: readonly Transaction[],
  flow: Flow | "",
  item: string,
  limit = 6,
): CategoryExample[] {
  const needle = item.trim().toLowerCase();
  if (!needle) return [];

  const seen = new Set<string>();
  const out: CategoryExample[] = [];

  const rows = [...transactions]
    .filter((t) => t.type === flow && t.category.trim() && t.item.trim())
    .sort((a, b) => b.date.localeCompare(a.date));

  // Exact matches first: they are evidence about this item, not about style.
  for (const pass of [true, false]) {
    for (const t of rows) {
      const name = t.item.trim().toLowerCase();
      const hit = pass ? name === needle : related(name, needle);
      if (!hit) continue;

      const key = `${t.item.trim()}|${t.category.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ item: t.item.trim(), category: t.category.trim() });
      if (out.length >= limit) return out;
    }
  }

  return out;
}

/** Shares a word of four letters or more. Deliberately crude, and local. */
function related(a: string, b: string): boolean {
  const words = (s: string): string[] => s.split(/[^a-z0-9]+/i).filter((w) => w.length >= 4);
  const left = new Set(words(a));
  return words(b).some((w) => left.has(w));
}

/**
 * What to do about the category on this draft.
 *
 * The same split as `describe.ts`, for the same reason: when the ledger
 * already answers, the model is not asked. Filing the same item the same way
 * as last time is both the right answer and free.
 */
export function categoryPlan(
  draft: Draft,
  transactions: readonly Transaction[],
  reference: ReferenceLists,
): CategoryPlan {
  const item = draft.item.trim();
  const allowed = allowedCategories(draft.flow, reference);

  if (!draft.flow || !item || allowed.length <= 1) return { kind: "not-yet" };

  const exact = transactions.filter(
    (t) => t.type === draft.flow && t.item.trim().toLowerCase() === item.toLowerCase() && t.category.trim(),
  );

  /**
   * Two matching past entries make it settled. One is a single data point,
   * and a single data point is exactly where a model's wider knowledge is
   * worth more than this ledger's.
   */
  const counts = new Map<string, number>();
  for (const t of exact) {
    const c = t.category.trim();
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }

  let best = "";
  let seen = 0;
  for (const [category, count] of counts) {
    if (count > seen) {
      best = category;
      seen = count;
    }
  }

  if (seen >= 2 && allowed.includes(best)) return { kind: "known", category: best, seen };

  return {
    kind: "ask",
    request: { fields: describeForCategory(draft, transactions), allowed },
  };
}

/**
 * What may be sent.
 *
 * The item and the wallets are values chosen from lists the app controls. The
 * past examples are the owner's own category labels, which are also from those
 * lists. No description, no note, nothing typed as prose: the same boundary
 * `describe.ts` keeps, for the same reason.
 */
export function describeForCategory(
  draft: Draft,
  transactions: readonly Transaction[],
): string {
  const lines = [`Flow: ${draft.flow}`, `Item: ${draft.item.trim()}`];

  if (draft.fromWallet) lines.push(`From: ${draft.fromWallet}`);
  if (draft.toWallet) lines.push(`To: ${draft.toWallet}`);

  const examples = pastLabels(transactions, draft.flow, draft.item);
  if (examples.length > 0) {
    lines.push("");
    lines.push("How this person has filed similar items before:");
    for (const e of examples) lines.push(`${e.item} -> ${e.category}`);
  }

  return lines.join("\n");
}

export interface CategoryAnswer {
  readonly category: string;
  readonly confidence: Confidence;
}

/**
 * Decide whether an answer is usable.
 *
 * A category outside the list is not retried, because retrying will not fix
 * it: the model was told the list and did not use it. It becomes the unsure
 * value instead, which is a state the owner can see and correct, rather than a
 * new category silently entering the totals.
 */
export function acceptCategory(
  raw: string,
  confidence: string,
  allowed: readonly string[],
): CategoryAnswer {
  const level: Confidence =
    confidence === "high" || confidence === "medium" ? confidence : "low";

  const answer = raw.trim();
  const match = allowed.find((c) => c.toLowerCase() === answer.toLowerCase());

  if (!match || match === UNSURE) return { category: UNSURE, confidence: "low" };
  return { category: match, confidence: level };
}

/**
 * Whether to fill the field or merely offer it.
 *
 * A high-confidence answer is applied; anything less is shown and left for the
 * owner. The threshold is deliberately strict, because a wrong category is
 * invisible once saved: it does not look like an error, it looks like a fact,
 * and it quietly moves a figure in every report that groups by category.
 */
export const shouldApply = (answer: CategoryAnswer): boolean =>
  answer.confidence === "high" && answer.category !== UNSURE;
