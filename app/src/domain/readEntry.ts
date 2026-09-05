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

/**
 * Money moved, or sent away.
 *
 * `gave` and `padala` are here because giving money away is a transfer out,
 * not a purchase: there is no item and no category, and the destination is
 * what decides whether it counts as spending. Income is tested first, so
 * "gave me 500" is still read as income.
 */
const MOVED =
  /\b(transferred|transfer|moved|sent|send|gave|give|giving|padala|pinadala|cashed out|withdrew|withdraw|deposited)\b/i;

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
 * ── Why this is read from the destination clause and nothing else ─────────
 *
 * It used to be tested against the whole sentence, so "I moved 500 from cash
 * to gcash for the store" looked like money given away because the word
 * "store" appeared somewhere in it. Whose pocket the money landed in is
 * decided by the words after "to". Nothing else in the sentence has an
 * opinion about it.
 */
const SOMEONE_ELSE =
  /\b(friend|friends|kaibigan|barkada|mother|mom|mama|nanay|father|dad|papa|tatay|sister|ate|brother|kuya|cousin|pinsan|tita|tito|aunt|auntie|uncle|lola|lolo|grandma|grandpa|classmate|schoolmate|officemate|roommate|neighbou?r|landlord|landlady|teacher|driver|boss|seller|shop|store|vendor|rider|courier|girlfriend|boyfriend|wife|husband|someone|somebody|him|her|them|his|hers|their|theirs)\b/i;

/**
 * A possessive that is not yours: "mama's gcash", "Jhayrel's maya".
 *
 * The apostrophe carries the whole meaning. "to gcash" is your Gcash and "to
 * mama's gcash" is not, and those are opposite entries: one is money moved
 * between your own pockets, where only the fee counts as spending, and the
 * other is money given away, where all of it does.
 */
const THEIR_POSSESSIVE = /\b(?!my\b|our\b)[\w-]+['’]s\b/i;

/**
 * Handing money to a person: "paid my friend", "gave her", "sent my mom".
 *
 * People only. A landlord, a seller, a shop or a driver is somebody you buy
 * from, and that is spending with a real item behind it. A friend or a
 * relative is not selling you anything, so there is no item to find and no
 * point looking for one.
 *
 * The person has to follow the verb closely, so "I paid Globe today, my
 * friend told me about the promo" stays a bill.
 */
const PAID_A_PERSON =
  /\b(?:paid|pay|paying|repaid|reimbursed|sent|send|gave|give|giving)\s+(?:back\s+)?(?:to\s+)?(?:my|his|her|their|our|the|a)?\s*(?:friend|friends|kaibigan|barkada|mother|mom|mama|nanay|father|dad|papa|tatay|sister|brother|kuya|cousin|pinsan|tita|tito|aunt|auntie|uncle|lola|lolo|grandma|grandpa|classmate|schoolmate|girlfriend|boyfriend|wife|husband|someone|somebody|him|her|them)\b/i;

/** Explicitly one of yours: "my gcash", "my own savings". */
const MINE = /\b(my|mine|our|ours|own)\b/i;

/**
 * "to buy food" is not a destination.
 *
 * A transfer sentence often ends in its reason, and a reason starts with
 * "to" as well. Read as a recipient, "I withdrew 5000 to buy food" became
 * money that had left your accounts, which books the whole 5,000 as spending
 * on the day you took it out of the bank and loses the cash you are holding.
 */
const PURPOSE =
  /^(?:buy|buying|pay|paying|get|cover|spend|purchase|order|reload|load|top\s*up|withdraw|send|settle|fund|save|use|treat)\b/i;

/**
 * Which way the money went.
 *
 * Order matters. "sent me 500" is income and contains "sent", so the incoming
 * phrases are tested before the moving ones.
 */
function flowOf(text: string): Flow | null {
  if (GOT.test(text)) return "Revenue";
  /**
   * Paying a person is money leaving, not a category of purchase.
   *
   * "I paid my friend yesterday 600 cash because I buy clubshirt" came back
   * as Gas, and "I paid my friend 1000 but using gcash and cash" as Food.
   * Both were rejected, seconds apart, and both were the same mistake:
   * "paid" put the sentence on the spending path, and the spending path has
   * to name a thing, so it went looking for one and found a coincidence.
   *
   * There is no thing. The money went to somebody, which is a transfer with
   * nobody on the other end, and this ledger already has a name for that:
   * Money Send, derived from the blank destination rather than typed. The
   * totals are identical either way, because a transfer that left your
   * accounts counts in full. What changes is that nothing has to be invented.
   *
   * Deliberately only people, not roles. Paying a shop, a seller or a driver
   * is buying something, and that is spending with a real item behind it.
   */
  if (PAID_A_PERSON.test(text)) return "Transfer";
  if (SPENT.test(text)) return "Spending";
  if (MOVED.test(text)) return "Transfer";
  return null;
}

/**
 * The first figure that could be money.
 *
 * Skips a figure that is part of a date, so "paid 500 on 8/31" reads 500 and
 * not 8. Two or more digits, or a decimal, so a stray "1" is not an amount.
 *
 * ── Why k and m are read ──────────────────────────────────────────────────
 *
 * "I earnd 100k today" was read as one hundred pesos. People write amounts
 * that way constantly, and being out by a factor of a thousand is the worst
 * single mistake this file can make: the row looks perfectly ordinary and the
 * balance is wrong by the whole amount.
 *
 * Only when the letter is attached to the digits. "100 k" is not an amount
 * followed by a suffix, it is a number and a stray letter, and reading it as
 * a hundred thousand would be inventing the zeroes.
 */
function amountIn(text: string): number | null {
  let withoutDates = text.replace(/\b\d{1,4}[/-]\d{1,2}([/-]\d{2,4})?\b/g, " ");

  /**
   * A year beside a month is a date, not two thousand pesos.
   *
   * "give me insights oif all transaction under treat this may to august
   * 2026" produced a card proposing a PHP 2,026.00 transfer, built entirely
   * out of the year at the end of the date range. Five messages of
   * bewilderment followed, then a rejection.
   *
   * Only when a month is named and nothing marks the figure as money, so
   * "2026" on its own is still an amount if that is what somebody typed, and
   * "PHP 2,026" always is. A year written next to August is not.
   */
  const NAMES_A_MONTH =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;
  const MARKS_MONEY = /₱|\bphp\b|\bpesos?\b/i;

  /**
   * "in 2027" is a year, whether or not a month is named.
   *
   * "How much did I spend on food in 2027?" read PHP 2,027.00. The earlier
   * rule only stripped a year when a month name sat beside it, and a bare
   * year with a preposition in front of it is just as plainly a date: "in",
   * "during", "for" and "back in" are not how anybody writes a price.
   */
  if (!MARKS_MONEY.test(withoutDates)) {
    if (NAMES_A_MONTH.test(withoutDates)) {
      withoutDates = withoutDates.replace(/\b(19|20)\d{2}\b/g, " ");
    }
    withoutDates = withoutDates.replace(
      /\b(?:in|during|for|of|back in|since|until|till)\s+((?:19|20)\d{2})\b/gi,
      " ",
    );
  }

  const scaled = /(?:₱|php\s*)?(\d+(?:\.\d+)?)([km])\b/i.exec(withoutDates);
  if (scaled?.[1] && scaled[2]) {
    const pesos = Number(scaled[1]) * (scaled[2].toLowerCase() === "k" ? 1_000 : 1_000_000);
    return Number.isFinite(pesos) ? Math.round(pesos * 100) : null;
  }

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
    const clause = clauseAfter(text, word);
    const found = walletIn(clause, accounts);
    if (found) return found;
  }
  return "";
}

/**
 * The words that follow a direction word, up to the next one.
 *
 * Split out from `walletAfter` because the clause says more than which
 * account it names. "my mom's gcash" and "gcash" name the same account and
 * mean opposite things, and the difference is in the words around the name.
 */
function clauseAfter(text: string, word: string): string {
  const match = new RegExp(`\\b${word}\\s+(.{0,40})`, "i").exec(text);
  if (!match?.[1]) return "";
  /**
   * Stop at the next direction word.
   *
   * Without this the window after "from" in "from cash to gcash" is the
   * whole rest of the sentence, and `walletIn` tries longest first, so it
   * found Gcash and made the destination the source.
   */
  return (match[1].split(BOUNDARY)[0] ?? match[1]).trim();
}

/** The first non-empty clause after any of these words. */
const firstClause = (text: string, words: readonly string[]): string => {
  for (const word of words) {
    const clause = clauseAfter(text, word);
    if (clause) return clause;
  }
  return "";
};

/**
 * Where one clause ends and the next begins.
 *
 * The reason words are here as well as the direction words, because a reason
 * is where a sentence stops talking about the money and starts talking about
 * why. "to gcash for the store" moved money into your own Gcash; without a
 * stop at "for", the destination clause swallowed "the store" and the row
 * came back as money handed to a shop.
 */
const BOUNDARY =
  /\b(?:to|into|from|using|via|thru|through|out of|for|because|since|para)\b/i;

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

  /**
   * A figure inside the name of a thing is not an amount.
   *
   * "I paid my spotify and my google drive and my microsoft office 365 from
   * gcash" came back as PHP 365.00. The 365 is part of the subscription's
   * name, and reading it as the price is the kind of wrong that looks
   * entirely reasonable on the card.
   *
   * Every name the owner keeps that has a digit in it is removed before the
   * figure is looked for. Longest first, so "Microsoft Office 365" goes
   * before anything shorter sitting inside it.
   */
  const numbered = [
    ...reference.bills,
    ...reference.subscriptions,
    ...reference.revenueCategories,
    ...reference.spendingTypes.map((t) => t.name),
  ]
    .filter((name) => /\d/.test(name))
    .sort((a, b) => b.length - a.length);

  let withoutNames = rest;
  for (const name of numbered) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    withoutNames = withoutNames.replace(new RegExp(escaped, "gi"), " ");
  }

  const amount = amountIn(withoutNames);

  /**
   * Both ends, read from the prepositions first and only then from the
   * sentence as a whole. A transfer names two wallets and the words say which
   * is which; a purchase usually names one, and either reading finds it.
   */
  const stated = walletAfter(text, FROM_WORDS, accounts);

  /**
   * Whose pocket the money landed in, which is the whole question.
   *
   * CLAUDE.md's transfer rule turns on one thing: a named destination is
   * still your money and only the fee is spending, a blank one means it left
   * your accounts and the whole amount is. So reading the destination wrong
   * does not misfile a row, it misstates what you spent.
   *
   * Three signals, in this order, all read from the words after "to":
   *
   *   theirs   a person, or a possessive that is not yours. "to my mom's
   *            gcash" names Gcash and is not your Gcash, so the account it
   *            names is thrown away rather than trusted.
   *   mine     "my", "our", "own". Yours even when the name is one this app
   *            does not hold, like "to my savings".
   *   neither  a destination was named and nothing says whose it is. That
   *            is a question, not a guess, so nothing is settled and the
   *            assistant asks.
   */
  const toClause = firstClause(text, TO_WORDS);
  const theirs = SOMEONE_ELSE.test(toClause) || THEIR_POSSESSIVE.test(toClause);
  const mine = !theirs && MINE.test(toClause);
  const destination = theirs ? "" : walletAfter(text, TO_WORDS, accounts);

  const loose = walletIn(text, accounts);
  const source = stated || (destination ? "" : loose);

  const because: string[] = [];
  if (said && date !== asOf) because.push(`Dated ${date}, from what you said.`);

  /**
   * Said outright, rather than assumed from a bare "to".
   *
   * The old rule fired on any "to" followed by anything, so a sentence that
   * merely explained itself ("withdrew 5000 to buy food") counted the whole
   * amount as gone. It has to be a recipient: a person, or a name that is
   * not one of your accounts and not one of your own possessives.
   */
  const wentSomewhereElse =
    theirs ||
    /**
     * "I paid my friend 1000 using gcash" names no destination at all.
     *
     * The person is the object of the verb rather than the end of a "to"
     * clause, so there is nothing after "to" to read. It still left your
     * accounts, and that is the whole reason this sentence is a transfer.
     */
    (PAID_A_PERSON.test(text) && !destination) ||
    (!destination && !mine && toClause !== "" && !PURPOSE.test(toClause));

  const leftYourAccounts = flow === "Transfer" && wentSomewhereElse;

  const settled: Blank[] = leftYourAccounts ? ["toWallet"] : [];
  if (leftYourAccounts) {
    because.push(
      theirs
        ? "That account is somebody else's, so it left your accounts and the whole amount counts as spending."
        : "It left your accounts, so the whole amount counts as spending.",
    );
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

/**
 * One message, several entries.
 *
 * ── The sentence this exists for ──────────────────────────────────────────
 *
 *   "Transfer 1000 to my firend maya payment for things I bought and also
 *    add spending treat food 1000 paid gcash and also I paid my spotify and
 *    globe at home for next month"
 *
 * Four things happened. One row was created. Splitting only ever looked at
 * line breaks, so a message typed as one paragraph was one entry however
 * many times it said "and also".
 *
 * ── Why splitting liberally is safe here ──────────────────────────────────
 *
 * It is not this function's job to decide whether a split was right. It
 * offers the pieces, and the caller keeps them only when each piece reads as
 * an entry on its own. So "I paid 250 for gas and food" splits, fails that
 * test, and goes back to being one message: the cost of a wrong split is a
 * discarded guess, not a wrong row.
 *
 * `and` alone is deliberately not a separator. It joins two halves of one
 * thought far more often than it joins two entries, and "gas and food" is
 * the ordinary case.
 */
const JOINS =
  /(?:\band also\b|\bthen also\b|\band then\b|\bthen\b|\balso add\b|\balso i\b|\bplus i\b|;)/i;

export function splitEntries(text: string): string[] {
  const lines = text
    .split(String.fromCharCode(10))
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.flatMap((line) =>
    line
      .split(JOINS)
      .map((part) => part.trim().replace(/^(?:and|also|plus)\s+/i, ""))
      .filter((part) => part.length > 2),
  );
}
