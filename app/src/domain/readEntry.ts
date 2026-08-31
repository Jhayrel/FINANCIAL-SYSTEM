/**
 * Reading an entry out of a sentence, on this device, with no model at all.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * "I paid spotify" came back with "I cannot read your question without the
 * model". Every part of that sentence is answerable from the ledger: Spotify
 * is a subscription, it is usually paid from a particular wallet, it is
 * usually the same amount. The model added nothing and its absence broke the
 * whole thing.
 *
 * So the sentence is read here first. It is instant, it costs nothing, it
 * works with the model switched off or the provider rate limited, and it is
 * more reliable than a free model at exactly this job, because it is reading
 * the owner's own ledger rather than guessing at English.
 *
 * The model is still called when this finds too little: a receipt photo, or a
 * sentence with a description worth keeping. This is the floor, not the
 * ceiling.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * Invent an amount, or invent a wallet. A blank stays blank and becomes a
 * question (`domain/capture.ts`). Debt is never produced: the credit line and
 * the effect cannot be read off a sentence, and getting either wrong misfiles
 * borrowing as spending.
 */

import { emptyDraft, type Draft, type Flow } from "./entry";
import type { Blank } from "./capture";
import { inferFromHistory, itemFromHistory } from "./infer";
import { readMoney } from "./proposal";
import type { IsoDate, ReferenceLists, Transaction, TransactionStatus } from "./types";

export interface ReadEntry {
  readonly draft: Draft;
  /** Why each field is what it is, for the card. */
  readonly because: readonly string[];
  /** True when enough was found to be worth showing at all. */
  readonly worthOffering: boolean;
  /** Blanks that are blank on purpose, so nothing asks about them. */
  readonly settled: readonly Blank[];
  /**
   * The sentence is about borrowing or repaying.
   *
   * Never turned into a row: a debt movement needs the credit line and
   * whether it is a draw, a repayment, interest or a write-off, and reading
   * either wrong misfiles borrowing as spending. That is the exact mistake
   * that put PHP 5,450 of borrowed money into the income line for eight
   * months. The caller says so and points at the form.
   */
  readonly readsAsDebt: boolean;
}

/** Money out. */
const SPENT =
  /\b(spent|spend|spending|paid|pay|paying|bought|buy|buying|purchased|purchase|ordered|renewed|topped up|top up|loaded|reloaded)\b/i;

/** Money in. */
const GOT =
  /\b(received|receive|got|earned|earn|collected|refunded|allowance|salary|paid me|sent me|gave me)\b/i;

/** Money moved, or sent away. */
const MOVED = /\b(transferred|transfer|moved|sent|send|cashed out|withdrew|withdraw|deposited)\b/i;

/**
 * Borrowing and repaying, which this file refuses to guess at.
 *
 * Tested before everything else, so "I paid my credit card" is recognised as
 * debt rather than read as ordinary spending by the word "paid".
 */
const DEBT =
  /\b(debt|debts|dept|borrowed|borrow|loan|loaned|utang|credit card|credit line|installment|repaid|repay|repayment|interest|paid off|pay off|owe|owed|owing)\b/i;

/**
 * Someone else, rather than another of your own pockets.
 *
 * "to my friend", "to my mom", "to his gcash account". The destination is a
 * person, so the money has left your accounts however it travelled.
 */
const SOMEONE_ELSE =
  /\b(friend|mother|mom|nanay|father|dad|tatay|sister|ate|brother|kuya|cousin|tita|tito|lola|lolo|classmate|landlord|seller|shop|store|him|her|them|his|their|someone|somebody)\b/i;

/** A destination was named, whatever it turned out to be. */
const SAID_TO = /\bto\s+\S/i;

/**
 * Which way the money went.
 *
 * Order matters. "sent me 500" is income and contains "sent", so the incoming
 * phrases are tested before the moving ones.
 */
function flowOf(text: string): Flow | null {
  if (GOT.test(text)) return "Revenue";
  if (SPENT.test(text)) return "Spending";
  if (MOVED.test(text)) return "Transfer";
  return null;
}

/**
 * The first figure that could be money.
 *
 * Skips a figure that is part of a date, so "paid 500 on 8/31" reads 500 and
 * not 8. Two or more digits, or a decimal, so a stray "1" is not an amount.
 */
function amountIn(text: string): number | null {
  const withoutDates = text.replace(/\b\d{1,4}[/-]\d{1,2}([/-]\d{2,4})?\b/g, " ");
  const match = /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{1,2}|\d{2,})/i.exec(
    withoutDates,
  );
  return match?.[1] ? readMoney(match[1]) : null;
}

const shift = (asOf: IsoDate, days: number): IsoDate => {
  const date = new Date(`${asOf}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** "today", "yesterday", "2026-08-30", or nothing, in which case today. */
function dateIn(text: string, asOf: IsoDate): { date: IsoDate; said: boolean } {
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (iso?.[1]) return { date: iso[1], said: true };

  const slashed = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(text);
  if (slashed) {
    const [, m, d, y] = slashed;
    return {
      date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      said: true,
    };
  }

  // Longest phrase first: "day before yesterday" contains "yesterday", and
  // testing the shorter one first reads it as one day back instead of two.
  if (/\bday before yesterday\b/i.test(text)) return { date: shift(asOf, -2), said: true };
  if (/\byesterday\b/i.test(text)) return { date: shift(asOf, -1), said: true };
  if (/\btoday\b|\bjust now\b|\bearlier\b/i.test(text)) return { date: asOf, said: true };

  return { date: asOf, said: false };
}

/**
 * A wallet named in the sentence.
 *
 * Longest name first, so "Maya Bank (Personal savings)" is not beaten by
 * "Maya". Word-boundary anchored, so "Cash" does not match "cashier".
 */
function walletIn(text: string, accounts: readonly string[]): string {
  const lower = text.toLowerCase();
  for (const account of [...accounts].sort((a, b) => b.length - a.length)) {
    const name = account.trim().toLowerCase();
    if (!name) continue;
    const at = lower.indexOf(name);
    if (at === -1) continue;
    const before = at === 0 ? " " : (lower[at - 1] ?? " ");
    const after = lower[at + name.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return account;
  }
  return "";
}

/**
 * The wallet named after a particular word.
 *
 * "transferred 1000 from cash to gcash" holds both ends, and which is which is
 * decided by the preposition. Reading the sentence as a whole and taking the
 * first name found gets it backwards: `walletIn` tries longest first, so it
 * returned Gcash as the source and then had nothing left for the destination.
 */
function walletAfter(text: string, words: readonly string[], accounts: readonly string[]): string {
  for (const word of words) {
    const match = new RegExp(`\\b${word}\\s+(.{0,40})`, "i").exec(text);
    if (!match?.[1]) continue;
    /**
     * Stop at the next direction word.
     *
     * Without this the window after "from" in "from cash to gcash" is the
     * whole rest of the sentence, and `walletIn` tries longest first, so it
     * found Gcash and made the destination the source.
     */
    const clause = match[1].split(BOUNDARY)[0] ?? match[1];
    const found = walletIn(clause, accounts);
    if (found) return found;
  }
  return "";
}

/** Where one clause ends and the next begins. */
const BOUNDARY = /\b(?:to|into|from|using|via|thru|through|out of)\b/i;

/** Words that mark where money came from, and where it went. */
const FROM_WORDS = ["from", "using", "used", "thru", "through", "via", "with", "out of"];
const TO_WORDS = ["to", "into"];

const STATUS_FOR: Partial<Record<Flow, TransactionStatus>> = {
  Spending: "Paid",
  Revenue: "Received",
  Transfer: "Transferred",
};

/**
 * Read what the sentence says, then let the ledger fill the rest.
 *
 * The two halves are deliberately separate: this one reads English, and
 * `inferFromHistory` reads the owner's own rows. Neither invents.
 */
export function readEntry(
  text: string,
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  asOf: IsoDate,
): ReadEntry {
  const readsAsDebt = DEBT.test(text);

  /**
   * A sentence with no verb in it.
   *
   * "I gas today usual ammount cash" names an item and a wallet and nothing
   * else, and it was answered with a summary of the month because none of the
   * verb lists matched. Once the ledger recognises the item, the sentence is
   * about spending on that item: that is the only thing it could be, and the
   * card shows every field for checking before anything is saved.
   *
   * The item has to be one the ledger already knows. Falling back to Spending
   * on any unrecognised sentence would turn "hatdog" into an entry.
   */
  const verbless =
    !readsAsDebt &&
    flowOf(text) === null &&
    itemFromHistory(text, transactions.filter((t) => t.type === "Spending")) !== null;

  const flow = readsAsDebt ? null : (flowOf(text) ?? (verbless ? "Spending" : null));
  if (!flow) {
    /**
     * A debt sentence still gives up its date, amount and wallet.
     *
     * They are not enough to make a row (the credit line and the effect are
     * the two that matter and neither is in a sentence), but they are enough
     * to open the form on Debt with three fields already filled, which is the
     * useful half of what was asked for.
     */
    const accounts = readsAsDebt ? [...reference.wallets, ...reference.savings] : [];
    const partial: Draft = readsAsDebt
      ? {
          ...emptyDraft(dateIn(text, asOf).date),
          flow: "Debt",
          amount: amountIn(text),
          fromWallet: walletIn(text, accounts),
        }
      : emptyDraft(asOf);

    return {
      draft: partial,
      because: [],
      worthOffering: false,
      settled: [],
      readsAsDebt,
    };
  }

  const accounts = [...reference.wallets, ...reference.savings];
  const { date, said } = dateIn(text, asOf);

  /**
   * The fee, before the amount.
   *
   * A transfer usually names both ("sent 1000 to gcash, 15 fee"), and the
   * ledger holds PHP 458.00 of them. Read first, and its digits removed
   * before the amount is looked for, so the fee is not mistaken for the
   * amount in "fee 15" and the amount is not mistaken for the fee.
   */
  const { fee, rest } = feeIn(text);
  const amount = amountIn(rest);

  /**
   * Both ends, read from the prepositions first and only then from the
   * sentence as a whole. A transfer names two wallets and the words say which
   * is which; a purchase usually names one, and either reading finds it.
   */
  const stated = walletAfter(text, FROM_WORDS, accounts);
  const destination = walletAfter(text, TO_WORDS, accounts);
  const loose = walletIn(text, accounts);
  const source = stated || (destination ? "" : loose);

  const because: string[] = [];
  if (said && date !== asOf) because.push(`Dated ${date}, from what you said.`);

  const leftYourAccounts = flow === "Transfer" && !destination && (SAID_TO.test(text) || SOMEONE_ELSE.test(text));

  const settled: Blank[] = leftYourAccounts ? ["toWallet"] : [];
  if (leftYourAccounts) {
    because.push("It left your accounts, so the whole amount counts as spending.");
  }

  const base: Draft = {
    ...emptyDraft(date),
    flow,
    category: flow === "Revenue" ? "Revenue" : flow === "Transfer" ? "Transfer" : "Spending",
    fromWallet: flow === "Revenue" ? "" : source,
    toWallet:
      flow === "Revenue"
        ? destination || loose
        : flow === "Transfer"
          ? (destination !== source ? destination : "")
          : "",
    amount,
    fee,
    status: STATUS_FOR[flow] ?? "",
    // Tells `checkDraft` the blank destination is the answer rather than a
    // field nobody filled in yet. See `Draft.sentOut`.
    ...(leftYourAccounts ? { sentOut: true } : {}),
  };

  /**
   * A transfer whose destination is not one of your accounts.
   *
   * "I sent money to my friend gotyme 1000 using my gcash" became a transfer
   * from Gcash to Gcash, was refused as needing two different wallets, and
   * then asked which account it went into: it offered the five names and
   * refused the answer, because a friend's bank is not one of them.
   *
   * A blank destination is the answer, not a gap. CLAUDE.md's transfer rule:
   * a named destination is still your money and only the fee is spending; a
   * blank one means it left your accounts and the whole amount is.
   */
  const { draft, because: fromHistory } = inferFromHistory(base, transactions, reference, text);

  /**
   * Worth showing when the sentence gave a figure, or the ledger recognised
   * what it was about. Neither on its own is nothing: "I paid spotify" has no
   * figure but a known item, and "I spent 500" has a figure and no item. Both
   * become a card with one question on it, which is the point.
   */
  const worthOffering = amount !== null || Boolean(draft.item.trim());

  return {
    draft,
    because: [...because, ...fromHistory],
    worthOffering,
    settled,
    readsAsDebt: false,
  };
}

/**
 * A fee named in the sentence, and what is left once it is taken out.
 *
 * "sent 1000 to gcash with 15 fee" and "fee 15" both say the same thing, and
 * both would otherwise have their fee read as the amount. Removing the words
 * that named it is what keeps the two figures apart.
 */
function feeIn(text: string): { fee: number; rest: string } {
  const patterns = [
    // "15 fee", "15 pesos fee", "15 charge"
    /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d{1,2})?)\s*(?:pesos?\s*)?(?:fee|charge|convenience fee|service fee)\b/i,
    // "fee 15", "fee of 15", "charge: 15"
    /\b(?:fee|charge|convenience fee|service fee)\s*(?:of|is|:)?\s*(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d{1,2})?)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const fee = readMoney(match[1]);
    if (fee === null || fee <= 0) continue;
    return { fee, rest: text.replace(match[0], " ") };
  }

  return { fee: 0, rest: text };
}
