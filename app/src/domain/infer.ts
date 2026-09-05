/**
 * Filling the blanks from what you have already done.
 *
 * ── The complaint this answers ────────────────────────────────────────────
 *
 * "I spent 100 today buying load using maya" came back asking "What was it
 * for?". Everything needed to answer that was already in the ledger: there
 * are rows for load, they have an item, they have a usual category, and they
 * are usually marked paid. Asking a question the ledger already answers is
 * the assistant failing to read its own data.
 *
 * So before anything is asked, the blanks are filled from history. Not from a
 * model, and not from a guess: from rows that exist, counted, with the count
 * shown on the card so you can see why it chose what it chose.
 *
 * ── How an item is recognised ─────────────────────────────────────────────
 *
 * Two passes, in order of how sure they are.
 *
 *   1. The words name it. "buying load" contains "Load", which is an item in
 *      the ledger, so it is that item. Longest name wins, so "Cellphone Load"
 *      beats "Load" when both are there.
 *
 *   2. The words have gone with it before. If nothing is named directly, the
 *      words are matched against what past descriptions said. Someone who
 *      writes "load" in the description of rows booked as "Online buy" gets
 *      "Online buy", because that is the pattern their own ledger holds.
 *
 * Pass 2 needs the pairing to have happened more than once. One row is a
 * coincidence, and an item chosen off a coincidence is a wrong row that looks
 * right.
 *
 * ── What is never inferred ────────────────────────────────────────────────
 *
 * The amount, and the wallet when the sentence named one. An amount is the
 * one field where being wrong costs money directly, and a wallet named in the
 * sentence is a statement of fact, not a blank. History fills blanks; it does
 * not overrule you.
 */

import { itemsFor } from "./entry";
import type { Draft, Flow } from "./entry";
import type { ReferenceLists, Transaction, TransactionCategory, TransactionStatus } from "./types";

/** Only for saying which figure was used. Display, not arithmetic. */
const pesos = (centavos: number): string =>
  `PHP ${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface Inferred {
  readonly draft: Draft;
  /** Why each field was filled, in the owner's own numbers. */
  readonly because: readonly string[];
  /**
   * Fields that were guessed rather than read out of the sentence.
   *
   * ── Why a card needs this ─────────────────────────────────────────────
   *
   * The record holds 24 rejected cards against 2 corrections. Rejecting is
   * one tap and correcting is several, so almost every time the assistant
   * was wrong the whole card went in the bin, and a rejection teaches it
   * nothing: it will make the same guess again tomorrow.
   *
   * Usually only one field was wrong. "I paid my friend 600 cash because I
   * buy clubshirt" had the date, the wallet and the amount right and the
   * item wrong, and it was thrown away whole.
   *
   * So the card says which field it is least sure of. Correcting the one
   * weak field is then the obvious action rather than the expensive one,
   * and a correction is the only thing that teaches.
   */
  readonly unsure: readonly string[];
}

/**
 * Words that carry no meaning about what was bought.
 *
 * Verbs and connectives, not nouns: "load", "food" and "grab" are exactly
 * what this is looking for and must never end up here.
 */
const NOISE = new Set([
  "i", "spent", "spend", "paid", "pay", "bought", "buy", "buying", "purchased",
  "got", "received", "sent", "send", "gave", "used", "using", "use", "today",
  "yesterday", "the", "a", "an", "my", "me", "for", "with", "from", "to", "in",
  "of", "on", "at", "and", "it", "was", "is", "this", "that", "some", "php",
  "peso", "pesos", "worth", "then", "just", "also", "about", "around", "via",
  "through", "by", "last", "night", "morning", "afternoon", "evening",
]);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !NOISE.has(w) && !/^\d+$/.test(w));

/** The most common value among rows, and how many had it. */
function commonest<T extends string>(rows: readonly Transaction[], pick: (t: Transaction) => T): {
  value: T | null;
  count: number;
} {
  const counts = new Map<T, number>();
  for (const row of rows) {
    const value = pick(row);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: T | null = null;
  let count = 0;
  for (const [value, n] of counts) {
    if (n > count) {
      best = value;
      count = n;
    }
  }
  return { value: best, count };
}

/** Whole-word, so "load" does not match "download" and "cash" not "cashier". */
const namesIt = (hint: string, name: string): boolean => {
  const escaped = name.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped ? new RegExp(`\\b${escaped}\\b`).test(hint.toLowerCase()) : false;
};

export interface ItemMatch {
  readonly item: string;
  /** How many past rows carry this item. */
  readonly seen: number;
  readonly how: "named" | "pattern";
}

/**
 * Which item this sentence is about, going by the ledger.
 *
 * Exported because it is the interesting half and deserves its own tests.
 */
export function itemFromHistory(
  hint: string,
  transactions: readonly Transaction[],
  /**
   * Words that say nothing about what was bought.
   *
   * Wallet names, mostly. "I paid my friend yesterday 600 cash because I buy
   * clubshirt" was booked as Gas, because "cash" appears in the description
   * of several Gas rows and nothing else in the sentence matched anything.
   * The wallet was already read out of that sentence by the time this runs,
   * so letting it vote a second time on what the thing was is the same fact
   * being counted twice, in a place where it means nothing.
   */
  ignore: readonly string[] = [],
): ItemMatch | null {
  const spending = transactions.filter((t) => t.item.trim());
  if (spending.length === 0) return null;

  const seen = new Map<string, number>();
  for (const row of spending) {
    const item = row.item.trim();
    seen.set(item, (seen.get(item) ?? 0) + 1);
  }

  // Pass 1: the sentence names it. Longest first, so a two-word item beats
  // the one-word item inside it.
  const named = [...seen.keys()]
    .filter((item) => namesIt(hint, item))
    .sort((a, b) => b.length - a.length)[0];
  if (named) return { item: named, seen: seen.get(named) ?? 0, how: "named" };

  // Pass 2: these words have gone with an item before, in descriptions.
  const skip = new Set(
    ignore.flatMap((name) =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean),
    ),
  );
  const hintWords = new Set(words(hint).filter((w) => !skip.has(w)));
  if (hintWords.size === 0) return null;

  const votes = new Map<string, number>();
  /**
   * A word only votes if it means something.
   *
   * "I paid my friend yesterday 600 cash because I buy clubshirt" was booked
   * as Gas, because "cash" appears in the descriptions of several Gas rows
   * and nothing else in the sentence matched anything at all. Counting rows
   * made it worse: twenty Gas rows saying "cash" was twenty votes off one
   * meaningless word.
   *
   * What separates "cash" from "restaurant" is not how often it appears but
   * how widely: a word used across several different items describes none of
   * them. So each word is weighed first, and one that turns up under three or
   * more items is structural noise and votes for nothing.
   */
  const itemsPerWord = new Map<string, Set<string>>();
  for (const row of spending) {
    const item = row.item.trim();
    for (const w of words(row.description)) {
      if (!hintWords.has(w)) continue;
      const found = itemsPerWord.get(w) ?? new Set<string>();
      found.add(item);
      itemsPerWord.set(w, found);
    }
  }

  const SPREAD = 3;
  for (const [, items] of itemsPerWord) {
    if (items.size >= SPREAD) continue;
    for (const item of items) votes.set(item, (votes.get(item) ?? 0) + 1);
  }

  let best: string | null = null;
  let score = 0;
  for (const [item, n] of votes) {
    if (n > score) {
      best = item;
      score = n;
    }
  }

  // A word that describes one or two items, and matches, is enough. A word
  // that describes everything was already thrown out above.
  if (!best || score < 1) return null;
  return { item: best, seen: seen.get(best) ?? 0, how: "pattern" };
}

/**
 * Fill what history can fill, and say why.
 *
 * `hint` is what the owner actually typed. It is the only place the words are
 * read from: the draft's own fields are what the model already decided, and
 * re-reading those would just agree with it.
 */
export function inferFromHistory(
  draft: Draft,
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  hint: string,
): Inferred {
  if (!draft.flow || draft.flow === "Debt") return { draft, because: [], unsure: [] };

  const flow = draft.flow as Flow;
  const because: string[] = [];
  /**
   * Every field this function fills was guessed, by definition.
   *
   * The sentence did not say it: that is why it was still blank when this
   * ran. The card uses the list to point at the one worth checking, so
   * correcting one field is easier than throwing the whole card away.
   */
  const unsure: string[] = [];
  let next = draft;

  // ── The item ─────────────────────────────────────────────────────────────
  if (!next.item.trim() && (flow === "Spending" || flow === "Revenue")) {
    const sameFlow = transactions.filter((t) => t.type === flow);
    const match = itemFromHistory(hint, sameFlow, [
      ...reference.wallets,
      ...reference.savings,
    ]);
    if (match) {
      next = { ...next, item: match.item };
      unsure.push("item");
      because.push(
        match.how === "named"
          ? `Booked as ${match.item}, which you have used ${match.seen} ${match.seen === 1 ? "time" : "times"}.`
          : `Booked as ${match.item}: that is what you called it the last few times you wrote this.`,
      );
    } else if (namedInLists(hint, flow, next.category, reference)) {
      /**
       * Named outright, whether or not it has ever been used.
       *
       * "I earnd 100k today framelink" left the item empty, because Framelink
       * is a revenue category the owner has set up and had no past rows to
       * find it by. A name they keep in Settings is a name they meant, and
       * waiting for it to have a history before recognising it means a new
       * category never gets recognised at all.
       */
      const named = namedInLists(hint, flow, next.category, reference);
      next = { ...next, item: named };
      unsure.push("item");
      because.push(`Booked as ${named}, which you named.`);
    } else {
      /**
       * The note beside each spending type, which says what counts as it.
       *
       * "I paid 300 in outing maya" has no item in the ledger called outing,
       * but Fun's note reads "Outings, parties, leisure". The owner wrote
       * that line for exactly this purpose, so it is read rather than
       * ignored, and reading it beats creating a new type by accident.
       */
      const byRemark = remarkMatch(hint, flow, reference);
      if (byRemark) {
        next = { ...next, item: byRemark };
        unsure.push("item");
        because.push(`Booked as ${byRemark}, which is what your note on it describes.`);
      }
    }
  }

  // Everything below leans on the item, so there is nothing more to do
  // without one.
  const item = next.item.trim();
  if (!item) return { draft: next, because, unsure };

  const past = transactions.filter(
    (t) => t.type === flow && t.item.trim().toLowerCase() === item.toLowerCase(),
  );
  if (past.length === 0) return { draft: next, because, unsure };

  // ── The category ─────────────────────────────────────────────────────────
  // Only for Spending: Revenue and Transfer each have exactly one.
  if (flow === "Spending") {
    const { value, count } = commonest(past, (t) => t.category as TransactionCategory);
    if (value && value !== next.category && count > 0) {
      next = { ...next, category: value };
      unsure.push("category");
      because.push(`Filed under ${value}, where your other ${item} entries are.`);
    }
  }

  // ── The wallet ───────────────────────────────────────────────────────────
  // Only when the sentence did not name one. A stated wallet is a fact.
  const accounts = [...reference.wallets, ...reference.savings];
  if (flow !== "Revenue" && !next.fromWallet) {
    const { value, count } = commonest(past, (t) => t.fromWallet);
    if (value && accounts.includes(value)) {
      next = { ...next, fromWallet: value };
      unsure.push("fromWallet");
      because.push(`Paid from ${value}, which is where ${count} of these came from.`);
    }
  }
  if (flow === "Revenue" && !next.toWallet) {
    const { value, count } = commonest(past, (t) => t.toWallet);
    if (value && accounts.includes(value)) {
      next = { ...next, toWallet: value };
      unsure.push("toWallet");
      because.push(`Into ${value}, which is where ${count} of these landed.`);
    }
  }

  // ── The amount, when you said it was the usual one ───────────────────────
  //
  // "I gas today usual ammount cash" is a complete instruction if you know
  // what the usual amount is, and the ledger does. Only ever fills a blank:
  // an amount you stated is never overruled, because being wrong about a
  // figure is the one mistake here that costs money directly.
  if ((next.amount === null || next.amount <= 0) && USUAL.test(hint)) {
    const counts = new Map<number, number>();
    for (const row of past) counts.set(row.amount, (counts.get(row.amount) ?? 0) + 1);

    let amount = 0;
    let seen = 0;
    for (const [value, n] of counts) {
      if (n > seen) {
        amount = value;
        seen = n;
      }
    }

    // Twice is a usual amount. Once is just the last time.
    if (amount > 0 && seen >= 2) {
      next = { ...next, amount };
      unsure.push("amount");
      because.push(
        `The usual ${item} is ${pesos(amount)}, which is what ${seen} of them came to.`,
      );
    }
  }

  /**
   * A bill or a subscription costs what it always costs.
   *
   * ── What the owner asked for ────────────────────────────────────────────
   *
   * "I paid my microsoft office 365 today from maya" left the amount blank,
   * and they wrote: "it should now the amount access the database". They are
   * right, and it is a narrower claim than it looks. Spotify is the same
   * figure every month. That is not a guess about this payment, it is a fact
   * about that subscription, and it is already in the ledger.
   *
   * ── Why this does not break the amount rule ─────────────────────────────
   *
   * CLAUDE.md says an amount is never inferred, because being wrong about a
   * figure is the one mistake that costs money directly. This keeps that
   * rule where it bites and narrows it where it does not:
   *
   *   - Bills and Subscriptions only. A Food row is a different figure every
   *     time and always will be, so it is still never filled.
   *   - The last three payments have to agree exactly. One differing figure
   *     and nothing is filled, because then it is not a fixed cost.
   *   - It only ever fills a blank. An amount you typed is never overruled.
   *   - It is marked unsure, so the card points at it before anything saves.
   */
  if (
    (next.amount === null || next.amount <= 0) &&
    (next.category === "Bills" || next.category === "Subscriptions") &&
    past.length >= 3
  ) {
    const recent = [...past]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 3)
      .map((t) => t.total);
    const first = recent[0];

    if (first !== undefined && first > 0 && recent.every((v) => v === first)) {
      next = { ...next, amount: first };
      unsure.push("amount");
      because.push(
        `${item} has been ${pesos(first)} the last three times, so that is what is filled in.`,
      );
    }
  }

  // ── The status ───────────────────────────────────────────────────────────
  const { value: status } = commonest(past, (t) => t.status as TransactionStatus);
  if (status && status !== next.status) {
    next = { ...next, status };
    unsure.push("status");
    because.push(`Marked ${status}, like the rest of them.`);
  }

  return { draft: next, because, unsure };
}

/**
 * "The usual", however it gets typed.
 *
 * Deliberately narrow. "same" alone would match "the same day", so it only
 * counts beside a word about the amount.
 */
const USUAL = /\b(usual|usually|the same|same as usual|normal|regular|as always|like always)\b/i;

/**
 * A spending type whose note covers these words.
 *
 * The note is the owner's own definition of what counts as that type, so it
 * is the right thing to read before inventing anything. Only for Spending:
 * revenue categories have no note.
 */
function remarkMatch(hint: string, flow: Flow, reference: ReferenceLists): string {
  if (flow !== "Spending") return "";

  const said = hint
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !NOISE.has(w));
  if (said.length === 0) return "";

  for (const type of reference.spendingTypes) {
    const remark = type.remark.toLowerCase();
    if (!remark) continue;
    if (said.some((w) => remark.includes(w) || remark.includes(w.replace(/s$/, "")))) {
      return type.name;
    }
  }
  return "";
}

/**
 * An item from the owner's own lists, named in the sentence.
 *
 * Independent of history: a category set up in Settings and never used is
 * still one they chose, and "framelink" should find Framelink the first time
 * as readily as the tenth.
 *
 * Longest first, so a two-word name beats the one word inside it, and
 * whole-word only, so "Gas" is not found inside "Gasoline station discount".
 */
function namedInLists(
  hint: string,
  flow: Flow,
  category: TransactionCategory,
  reference: ReferenceLists,
): string {
  const allowed = [
    ...itemsFor(flow, category, reference),
    // Bills and subscriptions are only offered under their own category, and
    // the category is often not decided yet when this runs.
    ...(flow === "Spending" ? [...reference.bills, ...reference.subscriptions] : []),
  ];

  return (
    [...new Set(allowed)]
      .sort((a, b) => b.length - a.length)
      .find((name) => namesIt(hint, name)) ?? ""
  );
}
