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
import type { ReferenceLists } from "./types";

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
       * Typed "food", stored "Food".
       *
       * The ledger already has an item called Food, and writing a second one
       * that differs only in case splits every total and every ranking that
       * groups by item. So a reply is matched against the owner's own list
       * and the list's spelling wins.
       *
       * An item that genuinely is new is kept as typed: that is how a new one
       * gets added, and refusing it would mean the assistant could only ever
       * record things that had happened before.
       */
      const known = itemsFor(draft.flow as Flow, draft.category, reference);
      return { ...draft, item: matchExact(text, known) || text.slice(0, 80) };
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
): Amendment | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return null;

  const accounts = [...reference.wallets, ...reference.savings];

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
