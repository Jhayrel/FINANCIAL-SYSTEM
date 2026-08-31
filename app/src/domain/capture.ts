/**
 * Finishing an entry the assistant only half read.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * "I have paid my load today" is a real entry with one detail left out. The
 * first version threw it away and answered "the data does not include a
 * figure for the load payment you made today", which is true, useless, and
 * the opposite of what was wanted. What a person expects is to be asked how
 * much, and for the entry to appear once they say.
 *
 * So a half-read entry becomes a question. One field at a time, most
 * important first, and the answer completes the row.
 *
 * ── Why the answers are read here and not by the model ────────────────────
 *
 * The reply to "how much was it" is "500". Sending that back to a provider to
 * be told it means five hundred pesos costs a round trip, a slice of a rate
 * limit, and a chance of being told something else. Every one of these is a
 * field this app already knows how to parse, so it parses them, instantly and
 * offline, with the same functions the form uses.
 *
 * The model reads pictures and sentences. Filling in one blank is not that.
 */

import { itemsFor, needs, type Draft, type Flow } from "./entry";
import { matchExact, readMoney } from "./proposal";
import type { IsoDate, ReferenceLists } from "./types";

/** The blanks worth stopping for, in the order they are worth asking about. */
export type Blank = "amount" | "fromWallet" | "toWallet" | "item";

const ORDER: readonly Blank[] = ["amount", "fromWallet", "toWallet", "item"];

/**
 * What is missing, given the flow.
 *
 * Only what `checkDraft` would refuse to save, plus the item, which it allows
 * empty but which makes a row meaningless in every report. Fee, description
 * and notes are never asked about: they are usually genuinely absent, and an
 * assistant that interrogates you about a fee you did not pay is worse than
 * one that leaves the field blank.
 */
export function blanksIn(
  draft: Draft,
  accounts: readonly string[],
  /**
   * Blanks that are blank on purpose.
   *
   * A transfer to someone else's bank has no destination wallet, and that is
   * the whole meaning of it: CLAUDE.md's transfer rule says a blank
   * destination books the full amount as spending. Asking "which one did it
   * go into" about money that left your accounts is asking an unanswerable
   * question, and the app did exactly that: it offered the five account names
   * and then refused the answer, because the friend's bank is not one of them.
   */
  settled: readonly Blank[] = [],
): Blank[] {
  if (!draft.flow) return [];
  const flow = draft.flow as Flow;

  return ORDER.filter((blank) => {
    if (settled.includes(blank)) return false;
    switch (blank) {
      case "amount":
        return draft.amount === null || draft.amount <= 0;
      case "fromWallet":
        return needs(flow, "fromWallet") && !matchExact(draft.fromWallet, accounts);
      case "toWallet":
        return flow === "Transfer" && !matchExact(draft.toWallet, accounts);
      case "item":
        return (flow === "Spending" || flow === "Revenue") && !draft.item.trim();
    }
  });
}

/** The question to put next, or null when nothing is missing. */
export function nextQuestion(
  draft: Draft,
  reference: ReferenceLists,
  settled: readonly Blank[] = [],
): { readonly blank: Blank; readonly question: string } | null {
  const accounts = [...reference.wallets, ...reference.savings];
  const blank = blanksIn(draft, accounts, settled)[0];
  if (!blank) return null;

  // Named, so the answer can be one word. A list of your own wallet names is
  // both the question and its own answer key.
  const list = accounts.join(", ");

  switch (blank) {
    case "amount":
      return { blank, question: "How much was it?" };
    case "fromWallet":
      return {
        blank,
        question: list
          ? `Which one did it come out of? ${list}`
          : "Which wallet did it come out of?",
      };
    case "toWallet":
      return {
        blank,
        question: list ? `And which one did it go into? ${list}` : "Which wallet did it go into?",
      };
    case "item":
      return { blank, question: "What was it for?" };
  }
}

/**
 * Read a reply into the blank it was asked about.
 *
 * Returns null when the reply does not answer the question, which is the
 * caller's cue to say so rather than to write something wrong into the row.
 * A reply is allowed to be a sentence: "about 500 I think" answers "how much"
 * perfectly well, so the field is looked for inside it rather than required
 * to be the whole of it.
 */
export function applyReply(
  draft: Draft,
  blank: Blank,
  reply: string,
  reference: ReferenceLists,
): Draft | null {
  const text = reply.trim();
  if (!text) return null;

  const accounts = [...reference.wallets, ...reference.savings];

  switch (blank) {
    case "amount": {
      const amount = readMoney(text) ?? firstAmountIn(text);
      return amount !== null && amount > 0 ? { ...draft, amount } : null;
    }
    case "fromWallet": {
      const wallet = matchExact(text, accounts) || walletInside(text, accounts);
      return wallet ? { ...draft, fromWallet: wallet } : null;
    }
    case "toWallet": {
      const wallet = matchExact(text, accounts) || walletInside(text, accounts);
      return wallet ? { ...draft, toWallet: wallet } : null;
    }
    case "item": {
      /**
       * Typed "outing fun", stored "Fun".
       *
       * The owner's own lists decide the spelling, because a second item that
       * differs only in wording splits every total and every ranking that
       * groups by item. `matchItem` reads those lists, including the note
       * beside each type, which is there to say what counts as it.
       */
      const { item } = matchItem(text, draft.flow as Flow, draft.category, reference);
      return { ...draft, item };
    }
  }
}

/**
 * The first figure in a sentence.
 *
 * `readMoney` wants the whole string to be an amount. This finds one inside
 * "about 500 I think", which is how people answer.
 */
function firstAmountIn(text: string): number | null {
  const match = /\d[\d,]*(?:\.\d+)?/.exec(text);
  return match ? readMoney(match[0]) : null;
}

/**
 * A wallet named inside a longer reply.
 *
 * Longest first, so "Maya Bank (Personal savings)" is not beaten to the match
 * by "Maya". Word-boundary anchored, so "Cash" does not match "Cashier".
 */
function walletInside(text: string, accounts: readonly string[]): string {
  const lower = text.toLowerCase();
  const byLength = [...accounts].sort((a, b) => b.length - a.length);

  for (const account of byLength) {
    const name = account.trim().toLowerCase();
    if (!name) continue;
    const at = lower.indexOf(name);
    if (at === -1) continue;
    const before = at === 0 ? " " : lower[at - 1] ?? " ";
    const after = lower[at + name.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return account;
  }
  return "";
}

// ── Changing your mind about a card already on screen ──────────────────────

export interface Amendment {
  readonly draft: Draft;
  /** What changed, for the line that confirms it. */
  readonly what: string;
}

/**
 * Read a correction to a proposal that is already showing.
 *
 * "make it 300" used to be answered with a summary of the month, because it
 * was read as a new question. It is not a question: there is a card on the
 * screen with an amount on it, and that is what "it" means.
 *
 * Deliberately narrow. It amends the four fields a person actually corrects,
 * and returns null for anything else, which sends the message back down the
 * ordinary path. A wrong amendment is worse than no amendment: it changes a
 * figure on a card you are about to approve.
 */
export function amend(
  draft: Draft,
  text: string,
  reference: ReferenceLists,
  asOf: IsoDate,
): Amendment | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return null;

  const accounts = [...reference.wallets, ...reference.savings];

  /**
   * The date, first.
   *
   * "2026 change the date" holds a four digit number, and reading it as an
   * amount would quietly make the entry PHP 2,026.00. A receipt read as 2022
   * when it was 2026 is a real correction and there was no way to make it:
   * the model answered "I cannot change entries here".
   */
  const date = dateFrom(trimmed, draft.date, asOf);
  if (date) return { draft: { ...draft, date }, what: `Dated ${date}.` };

  // A wallet named on its own, or with a correcting phrase around it.
  const wallet = matchExact(trimmed, accounts) || walletInside(trimmed, accounts);
  if (wallet) {
    return draft.flow === "Revenue"
      ? { draft: { ...draft, toWallet: wallet }, what: `Into ${wallet} instead.` }
      : { draft: { ...draft, fromWallet: wallet }, what: `From ${wallet} instead.` };
  }

  // A figure, with or without "make it" in front of it.
  const amount = readMoney(trimmed) ?? firstAmountIn(trimmed);
  if (amount !== null && amount > 0 && /\d/.test(trimmed)) {
    return { draft: { ...draft, amount }, what: "Amount changed." };
  }

  // An item the owner already has.
  const known = itemsFor(draft.flow as Flow, draft.category, reference);
  const item = matchExact(trimmed, known);
  if (item) return { draft: { ...draft, item }, what: `${item} instead.` };

  return null;
}

/**
 * A date correction, in the forms people type.
 *
 * A whole date, a relative day, or a bare year, which replaces the year in
 * what is already there: "2026" against 2022-10-07 gives 2026-10-07. A bare
 * year alone is not enough, because "2026" on its own is ambiguous with an
 * amount; something has to say it is about the date.
 */
function dateFrom(text: string, current: IsoDate, asOf: IsoDate): IsoDate | null {
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (iso?.[1]) return iso[1];

  const slashed = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(text);
  if (slashed) {
    const [, m, d, y] = slashed;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const shift = (days: number): IsoDate => {
    const at = new Date(`${asOf}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
  };

  if (/\bday before yesterday\b/i.test(text)) return shift(-2);
  if (/\byesterday\b/i.test(text)) return shift(-1);
  if (/\btoday\b/i.test(text)) return asOf;

  // A bare year, but only when the message says it is about the date.
  const year = /\b(20\d{2})\b/.exec(text);
  if (year?.[1] && /\b(date|dat|year|dated)\b/i.test(text) && /^\d{4}-/.test(current)) {
    return `${year[1]}${current.slice(4)}`;
  }

  return null;
}

// ── Matching what you said against what you already have ───────────────────

/**
 * The item the owner meant, from the lists they already keep.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────
 *
 * Asked "What was it for?" the owner answered "outing fun". The ledger has a
 * spending type called Fun, whose note reads "Outings, parties, leisure", and
 * the reply was stored verbatim as a brand new item called "outing fun". A
 * new type created by a typo splits every ranking and every total that groups
 * by item, quietly, forever.
 *
 * So the reply is matched against the owner's own lists first, in order of
 * how sure each step is, and only a reply that matches nothing at all is kept
 * as typed. That last case is real, it is how a genuinely new item gets
 * added, and the caller says so out loud when it happens.
 */
export function matchItem(
  text: string,
  flow: Flow,
  category: Draft["category"],
  reference: ReferenceLists,
): { readonly item: string; readonly matched: boolean } {
  const said = text.trim();
  if (!said) return { item: "", matched: false };

  const known = itemsFor(flow, category, reference);

  // 1. The same words, however they were capitalised.
  const exact = matchExact(said, known);
  if (exact) return { item: exact, matched: true };

  // 2. A known item named inside the reply. Longest first, so "Cellphone
  //    Load" wins over "Load" when the reply holds both.
  const inside = [...known]
    .sort((a, b) => b.length - a.length)
    .find((name) => wholeWord(said, name));
  if (inside) return { item: inside, matched: true };

  /**
   * 3. What the owner wrote in the note beside the type.
   *
   * "Outings, parties, leisure" is the note on Fun, and it is there precisely
   * to say what counts as it. Matching against it is reading the owner's own
   * definition rather than guessing.
   */
  const words = said
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  if (words.length > 0 && flow === "Spending") {
    for (const type of reference.spendingTypes) {
      if (!known.includes(type.name)) continue;
      const remark = type.remark.toLowerCase();
      // Stemmed loosely: "outing" should find "outings".
      if (words.some((w) => remark.includes(w) || remark.includes(w.replace(/s$/, "")))) {
        return { item: type.name, matched: true };
      }
    }
  }

  // 4. Genuinely new. Kept, tidied, and flagged.
  return { item: tidy(said), matched: false };
}

/**
 * A new item, written the way the existing ones are.
 *
 * Answering "dog" stored an item called "dog" beside Food, Gas and Online
 * Buy. Case is the only thing separating it from a second, identical type
 * later typed as "Dog", and two spellings of one item split every ranking
 * that groups by item.
 *
 * Only the first letter. The owner's own list is mixed ("Online Buy" beside
 * "Random necessities"), so title-casing every word would impose a
 * convention they do not use, and this is the one change that is never wrong.
 */
function tidy(said: string): string {
  const trimmed = said.trim().replace(/\s+/g, " ").slice(0, 80);
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

/** Word-boundary containment, so "Fun" does not match "funeral". */
function wholeWord(text: string, name: string): boolean {
  const lower = text.toLowerCase();
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  const at = lower.indexOf(needle);
  if (at === -1) return false;
  const before = at === 0 ? " " : (lower[at - 1] ?? " ");
  const after = lower[at + needle.length] ?? " ";
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}
