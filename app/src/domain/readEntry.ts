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

import { namesMoney, withoutTotals } from "./entryTotals";
import { cashWallet } from "./withdrawal";
import { daysBackIn, itemHintIn } from "./filipino";
import { emptyDraft, itemsFor, withDebtEffect, type Draft, type Flow } from "./entry";
import { payBackClauseAt, readBehalf, readDebtSentence, readPassThrough } from "./debtSentence";
import type { Blank } from "./capture";
import { behalfFor } from "./behalfFor";
import { makeDebtId } from "./debt";
import { inferFromHistory, itemFromHistory } from "./infer";
import { centavosInWords } from "./numberWords";
import { readMoney } from "./proposal";
import { withoutDays } from "./money";
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
  /**
   * A debt payment said to include interest, with no figure for it: "I paid
   * 1000 including its interest". The chat asks for the figure off the bill
   * rather than assuming a rate.
   */
  readonly interestUnstated?: boolean | undefined;
  /** Money passing through for someone else, when the sentence says so. */
  readonly passThrough?: "held" | "fronted" | null | undefined;
  /**
   * Which fields the sentence said in so many words, as opposed to what was
   * filled in from the ledger's habits.
   *
   * 28 September 2026: "6 peosos unknown spending" came back "Cash, which
   * your message named". It named no wallet; Cash was the usual one for
   * Unknown, found in the history. And "revenue 14 pesos change of the
   * electric bill payment" was turned into Spending because "electric bill"
   * is an item in the history, over the model reading Revenue and the owner
   * saying "revenue". A guess from habit may fill a blank; it may not
   * overrule anything.
   */
  readonly named?: { readonly flow: boolean; readonly fromWallet: boolean; readonly toWallet: boolean } | undefined;
}

/**
 * Money out, in either language.
 *
 * ── Why Tagalog is here and not treated as a separate mode ────────────────
 *
 * The owner types both, often in one sentence: "nag bayad ako ng tricycle 500
 * kanina cash gamit ko". Neither of those messages produced anything at all,
 * because not one word in them was a verb this file knew. From the outside
 * that reads as the app ignoring you, which is the failure hardest to report
 * and easiest to give up on.
 *
 * Filipino verbs carry their tense in a prefix rather than an ending, so the
 * stem is what matters: `bayad` covers nagbayad, binayaran and magbayad, and
 * `bili` covers bumili, binili and bibili. `bumuli` is here as its own word
 * because it is how the owner actually spells it, and a reader that only
 * accepts the dictionary spelling is a reader that fails on real typing.
 */
const SPENT =
  /\b(spent|spend|spending|paid|pay|paying|bought|buy|buying|purchased|purchase|ordered|renewed|topped up|top up|loaded|reloaded|treated|payed|apid|piad|spnt|add|bayad|nagbayad|binayaran|magbayad|bumili|bumuli|binili|bibili|umorder|gumastos|gastos|nagastos|nag-load|nagload|ate|eat|kumain|drank|uminom)\b/i;

/**
 * Money in, in either language.
 *
 * "credited to" is here and bare "credited" is not. Money credited *to* an
 * account is arriving, which is what a bank statement means by the word and
 * how "bank interest credited to maya 4.02" reads. "I credited 5000" is the
 * owner drawing on a credit line, which is borrowing, and that is matched
 * separately below.
 */
const GOT =
  /\b(revenue|income|sukli|cash ?back|cashback|refund|refunded|received|receive|recieved|recieve|recived|recive|got|earned|earn|earnd|easrn|earnt|collected|allowance|salary|paid me|pays me|sent me|send me|sends me|gave me|give me|gives me|credited to|natanggap|nakatanggap|tinanggap|nakuha|kumita|sahod|binigyan ako|pinadalhan ako)\b/i;

/**
 * Money moved, or sent away.
 *
 * `gave` and `padala` are here because giving money away is a transfer out,
 * not a purchase: there is no item and no category, and the destination is
 * what decides whether it counts as spending. Income is tested first, so
 * "gave me 500" is still read as income.
 */
const MOVED =
  /\b(transferred|transfer|transfered|trasfer|tranfer|trasferred|moved|move|sent|send|gave|give|giving|padala|pinadala|nagpadala|magpadala|binigay|ibinigay|nagbigay|naglipat|inilipat|nag-withdraw|nagwithdraw|kinuha|cashed out|withdrew|withdraw|wihdraw|withraw|withdrawl|withdrawed|deposited|instapay|instapaid|took back|take back|took|brought back|put back|returned)\b/i;

/**
 * Borrowing and repaying, which this file refuses to guess at.
 *
 * Tested before everything else, so "I paid my credit card" is recognised as
 * debt rather than read as ordinary spending by the word "paid".
 */
const DEBT =
  /\b(debt|debts|dept|borrowed|borrow|borrowing|loan|loans|loaned|loaning|utang|nangutang|umutang|inutang|hulog|hulugan|credit card|credit line|installment|instalment|repaid|repay|repayment|interest|paid off|pay off|owe|owes|owed|owing|lent|lend|lending|pinautang|nagpautang|pautang|inutangan|paid me back|pay me back|paying me back|my credit|the credit|credit bill|credit payment)\b/i;

/**
 * Interest earned: a savings account, a time deposit, a bank paying you.
 *
 * "my maya savings earned 0.31 interest today" was read as debt, because
 * "interest" is a debt word. Interest a bank pays you is income, and on the
 * owner's own screen it arrives twice a day into savings. Only "bank
 * interest" was set aside before; now any interest said to be earned, or on
 * savings or a deposit, is income.
 */
const INTEREST_EARNED =
  /\b(earn\w*|received|receive|recieved|got|credited|kumita|natanggap)\b(?:[^.]|\.\d)*\binterest\b|\binterest\b(?:[^.]|\.\d)*\b(earn\w*|received|credited)\b|\b(savings?|saving|deposit|time deposit|td)\b(?:[^.]|\.\d)*\binterest\b|\binterest\b(?:[^.]|\.\d)*\b(savings?|deposit)\b|\binterest (earned|income)\b/i;

/**
 * Drawing on credit, said as "I credited".
 *
 * "i credited 5000 today and recieved it in maya" produced nothing at all:
 * no verb in it moves money, so there was no flow, no amount and no card.
 *
 * Deliberately narrow. A bare "credited" is the ordinary banking word for
 * money arriving, and "bank interest credited to maya" is income rather than
 * borrowing. It is only debt when the owner is the one doing the crediting,
 * which is what "I credited" says and what "credited to" does not.
 */
const CREDITED_MYSELF = /\b(?:i|we)\s+(?:just\s+)?credited\b/i;

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
  /\b(friend|friends|freind|freinds|frend|frends|fren|frnd|bestfriend|bff|tropa|jowa|gf|bf|kaibigan|barkada|mother|mom|mama|nanay|father|dad|papa|tatay|sister|ate|brother|kuya|cousin|pinsan|tita|tito|aunt|auntie|uncle|lola|lolo|grandma|grandpa|classmate|schoolmate|officemate|roommate|neighbou?r|landlord|landlady|teacher|driver|boss|seller|shop|store|vendor|rider|courier|girlfriend|boyfriend|wife|husband|someone|somebody|him|her|them|his|hers|their|theirs)\b/i;

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
  /\b(?:paid|pay|paying|repaid|reimbursed|sent|send|gave|give|giving|transferred|transfered|tranfer|transfer)\s+(?:back\s+)?(?:\S+\s+)?(?:to\s+)?(?:my|his|her|their|our|the|a)?\s*(?:friend|friends|freind|freinds|frend|fren|frnd|bestfriend|bff|tropa|jowa|kaibigan|barkada|mother|mom|mama|nanay|father|dad|papa|tatay|sister|brother|kuya|cousin|pinsan|tita|tito|aunt|auntie|uncle|lola|lolo|grandma|grandpa|classmate|schoolmate|girlfriend|boyfriend|wife|husband|someone|somebody|him|her|them)\b|\b(?:nagpadala|pinadala|padala|nagbigay|binigay|ibinigay)\b[^.]*?\bsa\s+(?:aking\s+|ang\s+|kay\s+)?(?:nanay|tatay|mama|papa|kuya|ate|pinsan|tita|tito|lola|lolo|kaibigan|barkada)\b/i;

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

  /**
   * The first verb is the sentence's verb.
   *
   * Spending used to be tested first outright, so any sentence containing a
   * spending word became spending however it opened. "I withdrew 5000 from
   * maya to cash, spent 1200 of it on school, and the rest is still in my
   * wallet" was read as PHP 5,000 of Spending out of Maya: the withdrawal
   * became a purchase, the school spending vanished, and the cash the owner
   * is holding was never recorded as arriving anywhere.
   *
   * What a sentence is about is what it opens with. A later verb belongs to
   * a later clause, and if that clause is a separate entry the splitter will
   * find it, which is its job rather than this one's.
   */
  const spentAt = text.search(SPENT);
  const movedAt = text.search(MOVED);

  if (spentAt >= 0 && movedAt >= 0) return movedAt < spentAt ? "Transfer" : "Spending";
  if (spentAt >= 0) return "Spending";
  if (movedAt >= 0) return "Transfer";
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
/**
 * A shop with a number in its name, which is not a price.
 *
 * "bumili ako ng pagkain 500 cash sa 711" was read as PHP 500.00, correctly,
 * and then the card warned "You wrote PHP 711.00": the shop's name. The same
 * shape of mistake made "microsoft office 365" a PHP 365.00 purchase.
 */
const SHOP_NUMBERS = /\b(?:7[\s-]?eleven|seven[\s-]?eleven|7[\s/-]?11|711|24[\s/-]?7)\b/gi;

function amountIn(text: string): number | null {
  let withoutDates = withoutDays(text.replace(SHOP_NUMBERS, " ")).replace(/\b\d{1,4}[/-]\d{1,2}([/-]\d{2,4})?\b/g, " ");

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
  if (match?.[1]) return readMoney(match[1]);

  /*
   * One digit, when it is the only figure and is not counting something.
   *
   * A stray "1" is not an amount ("1 kilo", "2 pcs", "3 days ago"), which is
   * why two digits were required. But "6 unknown spending" and "5 pesos
   * candy" are six and five pesos, and on 28 September 2026 the first was
   * met with "How much was it?" about a sentence that began with how much.
   */
  const lone = [...withoutDates.matchAll(/(?:₱|php\s*)?\b(\d)\b(?!\s*(?:(?:kilos?|kg|g|grams?|pcs|pieces?|pc|x|times?|days?|weeks?|months?|years?|hours?|hrs?|mins?|minutes?|liters?|litres?|l|ml|am|pm|o'?clock|people|persons?|of)\b|[/:]))/gi)];
  if (lone.length === 1 && lone[0]?.[1] && !/\d{2,}/.test(withoutDates)) return Number(lone[0][1]) * 100;

  /*
   * Written out, when nothing was typed in digits.
   *
   * The owner writes properly when the message is long: "I withdrew a
   * thousand pesos from my Maya account into cash, and the bank charged me
   * fifteen pesos". Every figure there is a word, and this reader found none
   * of them, so a paragraph that reads perfectly well was worth nothing
   * without a model. Only as a fallback: a digit anywhere is what somebody
   * typed on purpose, and it wins.
   */
  return centavosInWords(withoutDates);
}

const shift = (asOf: IsoDate, days: number): IsoDate => {
  const date = new Date(`${asOf}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const MONTH_OF: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
// "May" is left out here and matched on its own terms below: it is also Tagalog for "there is".
const MONTH_WORD = "january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const DAY_WORD = "([12]\\d|3[01]|0?[1-9])(?:st|nd|rd|th)?";
const YEAR_WORD = "(?:,?\\s+((?:19|20)\\d{2})\\b)?";

/**
 * A day and month with no year belongs to this year, unless that is more
 * than a month ahead: "Dec 30" typed on January 3 is last December's.
 */
function dayOfMonth(month: number, day: number, year: string | undefined, asOf: IsoDate): IsoDate | null {
  let y = year ? Number(year) : Number(asOf.slice(0, 4));
  const make = (yy: number): IsoDate => `${yy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!year && make(y) > shift(asOf, 31)) y -= 1;
  const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= last ? make(y) : null;
}

/**
 * "Aug 25", "August 25, 2026", "25 Aug", "25th of August", "May 5th", "08/25".
 *
 * The owner, 28 September 2026, a list typed into the chat: "Aug 25 Food 150
 * cash", "Aug 26 Gas 200 cash", and every card came back dated today. The
 * reader knew "yesterday", "2026-08-30" and "8/25/2026", but not a day named
 * with its month, which is how every bank and wallet history writes one, so a
 * week of spending typed on a Monday would all have been booked on Monday.
 */
function monthDayIn(text: string, asOf: IsoDate): IsoDate | null {
  const monthFirst = new RegExp(`\\b(${MONTH_WORD})\\.?\\s+${DAY_WORD}\\b${YEAR_WORD}`, "i").exec(text);
  if (monthFirst) return dayOfMonth(MONTH_OF[monthFirst[1]!.toLowerCase()] ?? 0, Number(monthFirst[2]), monthFirst[3], asOf);

  const dayFirst = new RegExp(`\\b${DAY_WORD}\\s+(?:of\\s+)?(${MONTH_WORD})\\b\\.?${YEAR_WORD}`, "i").exec(text);
  if (dayFirst) return dayOfMonth(MONTH_OF[dayFirst[2]!.toLowerCase()] ?? 0, Number(dayFirst[1]), dayFirst[3], asOf);

  /*
   * May, only where it cannot be the Tagalog word: "May 5th", "May 5, 2026",
   * "5th of May", "5 May 2026". "gave 20 may natira pa" is twenty pesos with
   * some left over, not the twentieth of May.
   */
  const may =
    /\bmay\s+([12]\d|3[01]|0?[1-9])(?:(?:st|nd|rd|th)\b|,?\s+((?:19|20)\d{2})\b)/i.exec(text) ??
    /\b([12]\d|3[01]|0?[1-9])(?:st|nd|rd|th)?\s+(?:of\s+may\b(?:,?\s+((?:19|20)\d{2})\b)?|may,?\s+((?:19|20)\d{2})\b)/i.exec(text);
  if (may) return dayOfMonth(5, Number(may[1]), may[2] ?? may[3], asOf);

  // "08/25": month then day, both written in two figures, so "1/2 kilo" is not January 2.
  const slashed = /(?<![\d/])(\d{2})\/(\d{2})(?![\d/])/.exec(text);
  if (slashed) return dayOfMonth(Number(slashed[1]), Number(slashed[2]), undefined, asOf);

  return null;
}

/** "today", "yesterday", "2026-08-30", "Aug 25", or nothing, in which case today. */
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

  const named = monthDayIn(text, asOf);
  if (named) return { date: named, said: true };

  // Longest phrase first: "day before yesterday" contains "yesterday", and
  // testing the shorter one first reads it as one day back instead of two.
  if (/\bday before yesterday\b/i.test(text)) return { date: shift(asOf, -2), said: true };
  if (/\byesterday\b/i.test(text)) return { date: shift(asOf, -1), said: true };
  if (/\btoday\b|\bjust now\b|\bearlier\b/i.test(text)) return { date: asOf, said: true };

  /**
   * The same words in Filipino, which is half of how the owner writes.
   *
   * "kanina" means earlier today and appears in most of these sentences.
   * Getting a date wrong by a day is the kind of error that survives into a
   * monthly total without anybody noticing.
   */
  const back = daysBackIn(text);
  if (back !== null) return { date: shift(asOf, back), said: true };

  return { date: asOf, said: false };
}

/**
 * A wallet named in the sentence.
 *
 * Longest name first, so "Maya Bank (Personal savings)" is not beaten by
 * "Maya". Word-boundary anchored, so "Cash" does not match "cashier".
 */
function walletIn(said: string, accounts: readonly string[]): string {
  /*
   * "maya cash back" is money into Maya, not into Cash (27 September 2026:
   * the card said "Cash rather than Maya: that is the account your message
   * named"). A cash back and a cash-in name a kind of money, not the wallet.
   */
  const text = said.replace(/\bcash[\s-]?(?:back|in)\b/gi, " ");
  const lower = text.toLowerCase();

  /**
   * The same name with its punctuation ignored.
   *
   * The owner's savings account is called "Maya Bank (Personal savings)" and
   * nobody types the brackets. Written out longhand it was not found, and
   * "Maya" was found inside it instead, so "I transferred 5000 from maya to
   * maya bank personal savings" came back as Maya to Maya: the destination
   * collapsed into the source, the row became a transfer with nowhere to go,
   * and PHP 5,000 moved between two of the owner's own accounts would have
   * been booked as PHP 5,000 given away.
   *
   * Only punctuation is ignored, never words.
   */
  const bare = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const flat = ` ${bare(text)} `;

  /**
   * Both spellings of each name, longest name first.
   *
   * One pass rather than two, because two passes let a short name spelled
   * exactly beat a long name spelled without its brackets, which is precisely
   * how "Maya" won against "Maya Bank (Personal savings)".
   */
  for (const account of [...accounts].sort((a, b) => b.length - a.length)) {
    const name = account.trim().toLowerCase();
    if (!name) continue;

    const at = lower.indexOf(name);
    if (at !== -1) {
      const before = at === 0 ? " " : (lower[at - 1] ?? " ");
      const after = lower[at + name.length] ?? " ";
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return account;
    }

    const flattened = bare(account);
    if (flattened && flat.includes(` ${flattened} `)) return account;

    /*
     * The name without its brackets: "maya bank" and "maya banks" for "Maya
     * Bank (Personal savings)". Said that way on 27 September 2026 it fell
     * through to "Maya", and a savings balance was compared with the wallet.
     * Only a name of two words or more, and only one no other account has.
     */
    const short = shortNameOf(account, accounts);
    if (short && (flat.includes(` ${short} `) || flat.includes(` ${short}s `))) return account;
  }

  return "";
}

/**
 * An account's name without its bracketed part, when that is how it is said:
 * "maya bank" for "Maya Bank (Personal savings)". Empty when the short name
 * is one word or belongs to another account too.
 */
export function shortNameOf(account: string, accounts: readonly string[]): string {
  const bare = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!/\(.+\)/.test(account)) return "";
  const short = bare(account.replace(/\(.*?\)/g, " "));
  if (!short.includes(" ")) return "";
  const clash = accounts.some((other) => other !== account && (bare(other) === short || bare(other.replace(/\(.*?\)/g, " ")) === short));
  return clash ? "" : short;
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
/**
 * "galing" is Filipino for "from". "nagpadala ako 300 sa nanay ko galing
 * gcash" names its source that way, and without it the source was blank.
 */
const FROM_WORDS = ["from", "using", "used", "thru", "through", "via", "with", "out of", "galing"];
const TO_WORDS = ["to", "into"];

const STATUS_FOR: Partial<Record<Flow, TransactionStatus>> = {
  Spending: "Paid",
  Revenue: "Received",
  Transfer: "Transferred",
};

/**
 * Taking money out is Withdrawn, not Transferred.
 *
 * The owner asked for this in as many words: "fix the status too like if its
 * withdrawn or something". The ledger has five statuses and they are not
 * decoration: the Excel used Withdrawn for cash out of an account, and a
 * transfer that says Transferred when the money came out as cash reads wrong
 * to the person who wrote the original.
 *
 * Only the verb decides. Where the money went is a separate question, and a
 * withdrawal into Cash and a withdrawal into a wallet are both withdrawals.
 */
const WITHDRAWING =
  /\b(withdrew|withdraw|withdrawn|withdrawal|wihdraw|withraw|withdrawl|withdrawed|cashed out|cash out|nag-withdraw|nagwithdraw|kinuha)\b/i;

/** Money arriving from outside, which the Excel booked as Done. */
const DEPOSITING = /\b(deposited|deposit|credited|credit to)\b/i;

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
  /**
   * A named credit line makes the sentence about debt, whatever verb it uses.
   *
   * "I recived it in maya and the credit is from maya credit" produced a
   * Transfer from Maya to Maya: the same wallet on both sides, PHP 5,000, and
   * the error "A transfer needs two different wallets". The reader had never
   * heard of Maya Credit, found the account "Maya" inside those words, and
   * used it for the source and the destination both.
   *
   * A credit line is where borrowed money comes from and is never one of the
   * owner's accounts. Naming one is naming debt, and debt is the one thing
   * this file refuses to turn into a row.
   */
  const people = reference.onBehalf ?? [];
  const creditNamed = (reference.credits ?? []).find(
    (name) => name.trim() !== "" && !people.some((p) => p.name === name) && namesCredit(text, name),
  );

  /**
   * Someone else's money, known from the ledger. "paid globe postpaid 599"
   * is Father's when his rows are the ones that name Globe Postpaid now,
   * and naming him alone ("papa gave me 1000 allowance") is still income.
   * See `behalfFor.ts`.
   */
  const forSomeone = behalfFor(text, transactions, people, asOf, amountIn(text), [
    ...reference.wallets,
    ...reference.savings,
  ]);

  /**
   * "Bank interest" is income, and it contains a debt word.
   *
   * `DEBT` matches "interest", correctly, because interest on a credit line
   * is a debt movement. But Bank interest is one of the owner's own revenue
   * categories, and "bank interest credited to maya 4.02" was being read as
   * borrowing on the strength of that one word. Their ledger has ten of those
   * rows, all of them income.
   *
   * Taken out before the test rather than excepted after it, so "I paid the
   * interest on maya credit" is still debt: only the exact phrase goes.
   */
  /*
   * Interest on one of the owner's savings accounts, or said to be income.
   * "Add the interest to my maya bank" and "its revenue interest" (27
   * September 2026) were read as debt on Maya Credit, the only credit line,
   * because "interest" is a debt word and nothing else was.
   */
  const namesSavings = walletIn(text, reference.savings) !== "";
  const earnsInterest =
    (INTEREST_EARNED.test(text) ||
      (/\binterest\b/i.test(text) && (namesSavings || /\b(?:revenue|income|added|earned|credited|kita)\b/i.test(text)))) &&
    !/\b(credit|loan|utang|debt|owe)\b/i.test(text);
  const withoutIncome = (earnsInterest ? text.replace(/\b(bank )?interest\b/gi, " ") : text).replace(/\bbank interest\b/gi, " ");

  /** Money passing through for someone else, which is debt in the ledger's terms. */
  const passing = readPassThrough(text);
  /** On someone's behalf, and what happened: advance, write off, held, released, retained. */
  const behalf = forSomeone
    ? { side: forSomeone.person.side, effect: forSomeone.effect }
    : readBehalf(text);

  const readsAsDebt =
    DEBT.test(withoutIncome) || creditNamed !== undefined || CREDITED_MYSELF.test(text) || passing !== null || behalf !== null;

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
    (itemFromHistory(text, transactions.filter((t) => t.type === "Spending")) !== null ||
      // A kind of spending from their own list and a price: "gas 250 cash", "school 150".
      (namesMoney(text) && reference.spendingTypes.some((t) => t.name.trim() !== "" && namesCredit(text, t.name))));

  const flow = readsAsDebt ? null : earnsInterest ? "Revenue" : (flowOf(text) ?? (verbless ? "Spending" : null));
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
    /**
     * The interest inside a payment, and the effect when the words leave no
     * doubt about it. See `debtSentence.ts`.
     */
    const debtSaid = readsAsDebt && !behalf ? readDebtSentence(text, amountIn, readMoney) : null;
    /*
     * The fee the app charged to send it ("25000 to tita from gcash with 10
     * fee"): the owner's own transfer fee, put on the movement once its
     * effect says money left a wallet. A lender's fee (service, late, stamp)
     * is a charge on the debt instead, and `readDebtSentence` has it.
     */
    const sent = LENDER_FEE.test(text) ? { fee: 0, rest: text } : feeIn(text);
    const filled: Draft = readsAsDebt
      ? {
          ...emptyDraft(dateIn(text, asOf).date),
          flow: "Debt",
          amount: debtSaid?.amount ?? amountIn(sent.rest),
          ...(debtSaid?.interest != null ? { interest: debtSaid.interest } : {}),
          ...(debtSaid?.charges != null ? { charges: debtSaid.charges } : {}),
          /*
           * For money sent for someone, how they pay it back is not where it
           * left from: "send 1000 from maya, she will pay me back in cash"
           * left Maya. The pay-back clause is set aside before the wallet is read.
           */
          fromWallet: walletIn(
            behalf?.effect === "lend"
              ? text.slice(0, payBackClauseAt(text)).replace(/[\s,;]*(?:and|but|so)?\s*(?:he|she|they)?\s*$/i, " ")
              : text,
            accounts,
          ),
          ...(behalf ? { behalf: behalf.side } : {}),
          /**
           * The credit line, when the sentence named one.
           *
           * The debt card asks two things nobody should guess at: which line,
           * and what the movement does. The second genuinely is not in a
           * sentence. The first often is, in so many words, and asking for it
           * anyway made the card look like it had not read the message.
           *
           * Only from an exact name on the owner's own list, so this cannot
           * invent a line or pick the wrong one of two. What the movement
           * does is a separate field and is still always chosen.
           */
          ...(creditNamed ? { debtId: makeDebtId(creditNamed) } : {}),
          /*
           * Theirs, and what it was: "Globe Postpaid" stays on the row, so
           * the next one is known as his too.
           */
          ...(forSomeone ? { debtId: forSomeone.person.id, description: thingIn(text, transactions, forSomeone.person.name) } : {}),
        }
      : emptyDraft(asOf);
    // The wallet goes on the side the effect moves money through.
    const effect = behalf?.effect ?? debtSaid?.effect;
    const moved = effect ? withDebtEffect(filled, effect) : filled;
    const partial =
      sent.fee > 0 && (moved.debtEffect === "repay" || moved.debtEffect === "lend") ? { ...moved, fee: sent.fee } : moved;

    return {
      draft: partial,
      because: forSomeone
        ? [forSomeone.because]
        : creditNamed
          ? [`Filed against ${creditNamed}, which the message named.`]
          : [],
      worthOffering: false,
      settled: [],
      readsAsDebt,
      interestUnstated: debtSaid?.interestUnstated ?? false,
      passThrough: passing,
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
  /*
   * "I spend 350 today to my maya food" paid from Maya. A purchase has no
   * destination wallet, so a wallet named after "to" is where it was paid
   * from, not where it went.
   */
  const source = stated || (flow === "Spending" ? destination || loose : destination ? "" : loose);

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

  /**
   * An item the sentence named outright beats any hint.
   *
   * "I paid 500 for food at shell" is Food. Shell sells fuel, but the owner
   * said what they bought, and a shop's name is only evidence when the
   * sentence is otherwise silent about it.
   */
  const itemsHere =
    flow === "Spending" || flow === "Revenue"
      ? itemsFor(flow, flow === "Revenue" ? "Revenue" : "Spending", reference)
      : [];
  const statesAnItem = itemsHere.some((name) => namesCredit(text, name));
  const hint = statesAnItem ? "" : itemHintIn(text);
  const filipinoItem =
    hint && (flow === "Spending" || flow === "Revenue")
      ? (itemsFor(flow, flow === "Revenue" ? "Revenue" : "Spending", reference).find(
          (name) => name.toLowerCase() === hint,
        ) ??
        reference.spendingTypes.find((t) => t.remark.toLowerCase().includes(hint))?.name ??
        "")
      : "";

  /*
   * Interest earned lands in the savings account the sentence means. "maya
   * savings" is not the wallet Maya: it is the savings account with Maya in
   * its name, when there is one. "credited to maya" names the wallet itself
   * and stays there.
   */
  const savingsNamed = earnsInterest && /\b(savings?|deposit)\b/i.test(text)
    ? reference.savings.find((name) => {
        const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && w !== "personal" && w !== "savings" && w !== "bank");
        return words.length > 0 && words.every((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
      }) ?? ""
    : "";
  const interestItem = earnsInterest ? (reference.revenueCategories.find((c) => /interest/i.test(c)) ?? "") : "";

  /*
   * Cash taken out goes into Cash. "i withdraw from maya 1000 16 fee" left
   * the destination blank, and a blank one means the money left the owner's
   * accounts; the owner, 29 September 2026: "since it's physical withdraw
   * means cash". A withdrawal that names where it went keeps that.
   */
  const cashIn = cashWallet(reference.wallets);
  const intoCash =
    flow === "Transfer" && WITHDRAWING.test(text) && !destination && !leftYourAccounts && cashIn !== "" && source !== cashIn;
  if (intoCash) because.push(`Taken out as cash, so into ${cashIn}.`);

  const base: Draft = {
    ...emptyDraft(date),
    flow,
    category: flow === "Revenue" ? "Revenue" : flow === "Transfer" ? "Transfer" : "Spending",
    fromWallet: flow === "Revenue" ? "" : source,
    toWallet:
      flow === "Revenue"
        ? savingsNamed || destination || loose
        : flow === "Transfer"
          ? intoCash
            ? cashIn
            : destination !== source
              ? destination
              : ""
          : "",
    amount,
    fee,
    status:
      flow === "Transfer" && WITHDRAWING.test(text)
        ? "Withdrawn"
        : flow === "Transfer" && DEPOSITING.test(text)
          ? "Done"
          : (STATUS_FOR[flow] ?? ""),
    /**
     * The thing bought, when it was named in Filipino.
     *
     * Every other route to an item reads English or looks the phrase up in
     * past rows, so "bumuli ako ng pagkain" had no item and no history to
     * find one in. The hint is matched against the owner's own list, so this
     * can only ever choose an item they already have: a word with no match
     * leaves the field blank exactly as before.
     */
    ...(filipinoItem ? { item: filipinoItem } : {}),
    ...(interestItem ? { item: interestItem, description: "Interest earned" } : {}),
    /**
     * The credit line, when the sentence named one.
     *
     * The debt card asks two things nobody should guess at: which line, and
     * what the movement does. The second genuinely is not in a sentence. The
     * first often is, in so many words, and asking for it anyway made the
     * card feel like it had not read the message at all.
     *
     * Only ever filled from an exact name on the owner's own list, so this
     * cannot invent a credit line or pick the wrong one of two. What it does
     * is a separate field and is still always chosen.
     */
    ...(creditNamed ? { debtId: makeDebtId(creditNamed) } : {}),
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
    named: {
      flow: flowOf(text) !== null || earnsInterest,
      fromWallet: base.fromWallet !== "",
      toWallet: base.toWallet !== "",
    },
  };
}

/**
 * A fee named in the sentence, and what is left once it is taken out.
 *
 * "sent 1000 to gcash with 15 fee" and "fee 15" both say the same thing, and
 * both would otherwise have their fee read as the amount. Removing the words
 * that named it is what keeps the two figures apart.
 */
/** Fees a lender adds to a debt, which are charges on it and never a fee for sending money. */
const LENDER_FEE = /\b(?:service|dst|stamp|documentary|interest|penalty|late|processing|finance charge)\b/i;

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
  /(?:\band also\b|\bthen also\b|\band then\b|\bthen\b|\balso add\b|\balso i\b|\bplus i\b|\bpagkatapos\b|\btapos\b|;|\band\b(?=\s*(?:₱|php\s*)?\d))/i;

/**
 * The verb at the front of the first clause, if it is short enough to lend.
 *
 * "I paid", "paid", "I spent", "I sent". Everything before the first figure,
 * capped at four words: past that it is not a verb phrase, it is the start of
 * a description, and prefixing later clauses with a description would invent
 * words the owner did not write.
 */
function leadingVerb(part: string): string {
  const match = /^([a-z' ]{2,40}?)\s*(?=(?:₱|php\s*)?\d)/i.exec(part.trim());
  const lead = match?.[1]?.trim();
  if (!lead) return "";
  const words = lead.split(/\s+/);
  return words.length <= 4 ? lead : "";
}

/** Starts with a figure, so it has no verb of its own to read. */
const startsWithFigure = (part: string): boolean => /^(?:₱|php\s*)?\d/i.test(part.trim());

/** A verb of paying, buying, eating, moving or taking money, with its subject: "I paid", "i withdraw". */
const VERB_PHRASE =
  /\b(?:(?:i|we|my\s+\w+)\s+)?(?:also\s+|then\s+|just\s+)?(?:paid|pay|payed|bought|buy|spent|spend|purchased|ordered|loaded|topped up|ate|eat|drank|sent|send|gave|give|withdrew|withdraw|withdrawn|transferred|transfer|received|got|earned|borrowed|lent|deposited|nagbayad|bumili|binili|kumain|nagpadala|nag-withdraw|nagwithdraw)\b/i;

/** The verb a clause opens with, to lend to a clause after it that has none. */
function verbPhrase(part: string): string {
  const m = VERB_PHRASE.exec(part);
  return m ? m[0].trim() : "";
}



/** A clause that is only a fee: "16 fee", "fee of 15", "with 10 charge". */
const FEE_ONLY = /^\s*(?:(?:with|a|the|plus)\s+)?(?:(?:₱|php\s*)?\d[\d,.]*\s*(?:pesos?\s*)?(?:fee|charge|service fee)|(?:fee|charge)\s*(?:of|is|:)?\s*(?:₱|php\s*)?\d[\d,.]*)\s*[.!?]?\s*$/i;

/**
 * "and" between two things, each with its own figure, is two entries.
 *
 * "I paid 150 for my school and honorarium 300" and "i ate lunch 95 and buy
 * water 25" are two each (29 September 2026). "and" before a figure was
 * already a split; before a word it was not, because "gas and food" is one
 * purchase. So only where both sides carry a figure of their own, and the
 * second opens with a verb or a few words and then its figure. Never before
 * a fee, which belongs to what it was charged on.
 */
function splitOnAnd(part: string): string[] {
  // "and", Tagalog "at", "tsaka" and "saka", and a comma between two things with their own figures.
  const pieces = part.split(/(\s+(?:and|at|tsaka|saka|&)\s+|,\s+)/i);
  if (pieces.length < 3) return [part];
  const out: string[] = [pieces[0] ?? ""];
  for (let k = 1; k < pieces.length; k += 2) {
    const joint = pieces[k] ?? " ";
    const piece = pieces[k + 1] ?? "";
    const before = out[out.length - 1] ?? "";
    const opensAsEntry =
      VERB_PHRASE.test(piece.split(/\s+/).slice(0, 3).join(" ")) ||
      /^\s*(?:[a-z][a-z'-]*\s+){1,3}(?:₱|php\s*)?\d/i.test(piece) ||
      /^\s*(?:₱|php\s*)?\d/i.test(piece);
    if (namesMoney(before) && namesMoney(piece) && opensAsEntry && !FEE_ONLY.test(piece)) {
      out.push(piece);
    } else {
      out[out.length - 1] = `${before}${joint}${piece}`;
    }
  }
  return out;
}

export function splitEntries(text: string): string[] {
  /*
   * A total and a sentence that only says it again are not entries: "I paid
   * 450, 300 for honorarium and 150 for my donation. All school category
   * basically 300 and 150 total of 450" is two payments (`entryTotals.ts`).
   */
  const lines = withoutTotals(text)
    .split(String.fromCharCode(10))
    .map((l) => l.trim())
    .filter(Boolean);

  /*
   * A full stop, a question mark or an exclamation ends an entry: "I paid
   * for gas using cash 250. I paid 150 for my school ..." is two payments,
   * and read as one sentence it was one card for ₱250.00 of School
   * (29 September 2026). A point inside a figure is followed by a digit,
   * not a space, so "1,000.50" is never cut.
   */
  const parts = lines.flatMap((line) =>
    line
      .split(/(?<=[.!?])\s+(?=\S)/)
      .flatMap((sentence) => sentence.split(JOINS))
      .map((part) => part.trim().replace(/^(?:and|also|plus)\s+/i, ""))
      .flatMap(splitOnAnd)
      .filter((part) => part.length > 2),
  );

  /**
   * ── A clause borrows the verb of the one before it ──────────────────────
   *
   * "I paid 500 for food from gcash, then 300 for gas from cash, then 250 for
   * fun from maya" is three payments in English and was one card in this app.
   * The split was right; the pieces were not readable. `readEntry` needs a
   * verb to decide whether money came in, went out or moved, and the second
   * and third clauses have none: English lets them borrow the first one's,
   * and the reader could not. So "300 for gas from cash" read as no flow, no
   * amount, no wallet, nothing at all, and the caller dropped it for not
   * being an entry. Two of the three payments vanished without a word.
   *
   * A clause that opens with a figure borrows the first clause's opening
   * words, as before. A clause with no verb of its own ("honorarium 300"
   * after "I paid 150 for my school and") borrows the verb of the nearest
   * clause before it that has one. "then paid 500 for food" and "then gave
   * 300 to my mom" have their own verbs and keep them, which is what keeps
   * a borrowed "I borrowed" off a row that was not borrowing.
   */
  const lead = parts.length > 1 ? leadingVerb(parts[0] ?? "") : "";
  let nearest = "";
  const withVerb = parts.map((part, i) => {
    const own = verbPhrase(part);
    if (own) {
      nearest = own;
      return part;
    }
    if (i === 0 || flowOf(part) !== null) return part;
    if (startsWithFigure(part) && lead) return `${lead} ${part}`;
    return nearest ? `${nearest} ${part}` : part;
  });

  /**
   * ── A wallet named once, at the end, belongs to all of them ────────────
   *
   * "I sent 500 to my mom's gcash and 500 to my own gcash, same day, from
   * maya" says where the money came from exactly once, in the last clause,
   * because saying it twice is how nobody talks. Split naively, the first
   * half has no source at all and the card has to ask for something the
   * sentence already answered.
   *
   * This is the same borrowing as the verb above, from the other end. Only
   * into parts that name no source of their own, so a sentence that does say
   * it twice, and says two different things, keeps both.
   */
  const tail = FROM_TAIL.exec(withVerb[withVerb.length - 1] ?? "");
  const source = tail?.[0]?.trim().replace(/^,\s*/, "");
  if (!source || withVerb.length < 2) return withVerb;

  return withVerb.map((part, i) =>
    i < withVerb.length - 1 && !FROM_WORD.test(part) ? `${part} ${source}` : part,
  );
}

/**
 * A credit line named in a sentence, punctuation and all.
 *
 * Matched on whole words with the punctuation flattened, the same way an
 * account is, so "Maya Credit", "maya credit" and "maya-credit" are one name.
 */
/** The item a sentence about someone else's money names, for the row's description: never the person. */
function thingIn(text: string, transactions: readonly Transaction[], person: string): string {
  const found = itemFromHistory(text, transactions.filter((t) => t.type === "Spending" && t.item.trim().toLowerCase() !== person.trim().toLowerCase()));
  return found?.how === "named" ? found.item : "";
}

function namesCredit(text: string, name: string): boolean {
  const flat = (v: string): string => ` ${v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  return flat(text).includes(flat(name));
}

/**
 * A source clause sitting at the very end of a message, with no figure in
 * it: "from maya 1000 16 fee" is the last entry's own wallet and amount, and
 * lent to the others it put a ₱16.00 fee and Maya on a lunch (29 September
 * 2026).
 */
const FROM_TAIL = /\b(?:from|out of|using|via|thru|through)\s+[a-z ()'-]{2,40}$/i;

/** Any mention of where money came from, so an inherited one is not doubled. */
const FROM_WORD = /\b(?:from|out of|using|used|via|thru|through|with)\b/i;
