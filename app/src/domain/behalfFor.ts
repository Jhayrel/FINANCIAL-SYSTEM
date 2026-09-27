/**
 * Money that is someone else's, known from the ledger rather than the words.
 *
 * The owner, 27 September 2026: "the globe postpaid thats my fathers
 * personal phone subscription but I am the one that paying but he gives
 * money so means its not technically my spending". Their payments for it
 * were filed On behalf of Father, and the next one would still have been
 * read as their own bill: "paid globe postpaid 599 gcash" came back as
 * Bills, "paid my father's globe postpaid" as paying back a debt they owe
 * him, and "papa gave me 600 for his globe postpaid" as their income.
 *
 * Nothing in those sentences says "on behalf". What says it is the ledger:
 * the latest rows about Globe Postpaid are movements with Father. So a
 * sentence about a thing is read as that person's when their rows are the
 * ones that name it now.
 *
 * Naming the person is not enough on its own. "papa gave me 1000 allowance"
 * is income, and so is every "Cash given by my father" already in the
 * ledger. Only the words ("he will pay me back", "not mine") or their own
 * thing make it theirs.
 */

import { readBehalf } from "./debtSentence";
import type { Centavos } from "./money";
import type { BehalfPerson, DebtEffect, IsoDate, Transaction } from "./types";

export type { BehalfPerson };

/**
 * What the family calls each other, in English and Tagalog.
 *
 * Their Father is "papa" in half their sentences. "ate" is left out: it is
 * also the English past of eat, and "ate 200 lunch" names nobody.
 */
const KIN: readonly (readonly string[])[] = [
  ["father", "papa", "dad", "daddy", "tatay", "itay", "papi"],
  ["mother", "mama", "mom", "mommy", "mum", "nanay", "inay", "mami"],
  ["grandmother", "grandma", "lola"],
  ["grandfather", "grandpa", "lolo"],
  ["aunt", "auntie", "tita"],
  ["uncle", "tito"],
  ["brother", "kuya"],
];

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Every word that names this person: their name, and what the family calls them. */
function callsFor(name: string): Set<string> {
  const own = wordsOf(name);
  const kin = KIN.find((group) => own.some((w) => group.includes(w)));
  return new Set([...own, ...(kin ?? [])]);
}

/** Whether the sentence names them. "my father's", "fathers", "papa" and "Father" all do. */
export function namesPerson(text: string, name: string): boolean {
  const calls = callsFor(name);
  const said = wordsOf(text);
  const own = wordsOf(name);
  // A name of several words is named whole; a family word on its own is enough.
  if (own.length > 1 && said.join(" ").includes(own.join(" "))) return true;
  return said.some((w) => calls.has(w) || (w.endsWith("s") && calls.has(w.slice(0, -1))));
}

/** Words that say nothing about what the money was for. */
const PLAIN = new Set([
  "paid", "pay", "pays", "paying", "payment", "payed", "bayad", "sent", "send", "gave", "give", "given", "gives",
  "bought", "buy", "transfer", "transferred", "received", "receive", "money", "cash", "from", "with", "this",
  "that", "their", "them", "they", "your", "mine", "month", "monthly", "today", "yesterday", "kanina", "para",
  "bill", "bills", "fee", "fees", "wallet", "balance", "amount", "account", "plan",
]);

/** Money coming to the owner: "papa gave me", "received from", "binigyan ako". */
const TOWARD_YOU =
  /\b(?:gave me|give me|gives me|given me|sent me|send me|sends me|paid me|pays me|transferred me|received|receive|got|natanggap|binigyan ako|nagbigay|bigay ni|padala ni|nagpadala sa akin)\b/i;
/** Money leaving the owner. */
const AWAY_FROM_YOU =
  /\b(?:paid|pay|payed|paying|sent|send|bought|buy|gave|give|transferred|transfer|loaded|bayad|nagbayad|binayaran|binili|pinadala)\b/i;

/** Which way the money went, from the owner's side, or null when the words do not say. */
export function directionOf(text: string): "in" | "out" | null {
  if (TOWARD_YOU.test(text)) return "in";
  if (AWAY_FROM_YOU.test(text)) return "out";
  return null;
}

/** The effect a movement has on their side, from which way the money went. */
function effectFor(side: BehalfPerson["side"], direction: "in" | "out" | null): DebtEffect | undefined {
  if (direction === null) return undefined;
  if (side === "owed") return direction === "out" ? "lend" : "collect";
  return direction === "in" ? "draw" : "repay";
}

export interface BehalfRead {
  readonly person: BehalfPerson;
  /** Undefined when the words do not say which way the money went: the card asks. */
  readonly effect: DebtEffect | undefined;
  /** Why: shown on the card, so a wrong guess is visible. */
  readonly because: string;
}

/**
 * The person a sentence is about, and what happened, or null when it is the
 * owner's own money.
 *
 * `transactions` decide whose a thing is: a word from the sentence belongs
 * to a person when the latest row naming it is theirs, and at least half of
 * the year's rows naming it are. "load" bought once for Father yesterday
 * does not make every load his. And the amount has to be like theirs: a
 * postpaid plan of your own at twice his price is yours.
 */
export function behalfFor(
  text: string,
  transactions: readonly Transaction[],
  people: readonly BehalfPerson[],
  asOf: IsoDate,
  amount: Centavos | null,
  /** Wallet names and the like, which never say whose a thing is. */
  ignore: readonly string[] = [],
): BehalfRead | null {
  if (people.length === 0) return null;
  const named = people.find((p) => namesPerson(text, p.name));
  const said = readBehalf(text);
  const direction = directionOf(text);

  if (named && said) {
    return {
      person: named,
      effect: said.side === named.side ? said.effect : effectFor(named.side, direction),
      because: `${named.name} is on your On behalf list.`,
    };
  }

  const skip = new Set([...PLAIN, ...ignore.flatMap(wordsOf), ...people.flatMap((p) => [...callsFor(p.name)])]);
  const words = [...new Set(wordsOf(text))].filter((w) => w.length >= 4 && !/^\d/.test(w) && !skip.has(w));
  if (words.length === 0) return null;

  const yearAgo = `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`;
  const byPerson = new Map(people.map((p) => [p.id, p]));
  const rowWords = (t: Transaction): Set<string> => new Set(wordsOf(`${t.item} ${t.description}`));

  for (const word of words) {
    const naming = transactions.filter((t) => t.date <= asOf && rowWords(t).has(word));
    if (naming.length === 0) continue;
    const latest = naming.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.recordNumber > a.recordNumber) ? b : a));
    const owner = latest.debtId ? byPerson.get(latest.debtId) : undefined;
    if (!owner) continue;
    if (named && named.id !== owner.id) continue;
    const recent = naming.filter((t) => t.date >= yearAgo);
    const theirs = recent.filter((t) => t.debtId === owner.id);
    if (theirs.length * 2 < recent.length) continue;
    if (amount !== null && theirs.length > 0) {
      const sorted = theirs.map((t) => t.amount).sort((a, b) => a - b);
      const usual = sorted[Math.floor(sorted.length / 2)] ?? 0;
      if (amount * 2 < usual || amount > usual * 2) continue;
    }
    return {
      person: owner,
      effect: effectFor(owner.side, direction),
      because: `Your latest rows about "${word}" were with ${owner.name}, On behalf.`,
    };
  }
  return null;
}
