/**
 * "If I have 1 million in Maya Bank, how much interest will it gain based on
 * your data?" (owner, 20 November 2026), worked out from what the account
 * actually earned.
 *
 * The model answered with a "daily rate" it made by dividing one interest
 * credit by the balance, when that credit covered two days. The account was earning several times that.
 *
 * ── How ──────────────────────────────────────────────────────────────────
 *
 * The rate is the interest credited over the last days, against the balance
 * the account actually held on each of those days: interest / (average daily
 * balance x days). It is the rate as credited, so it is after whatever the
 * bank takes off before crediting it. The figure asked about is then held at
 * that rate: a day, a 30-day month, a year. Simple interest, said as "about",
 * since a bank's rate and its compounding can change.
 *
 * Money is integer centavos; the rate is a plain fraction and every money
 * result is rounded to a whole centavo at the end.
 */

import { walletDelta } from "./balances";
import { addDays } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { centavosInWords } from "./numberWords";
import type { IsoDate, Transaction } from "./types";

export interface InterestIf {
  /** The figure asked about, in centavos. */
  readonly amount: Centavos;
  /** The account named, or empty to take the one that earns interest. */
  readonly account: string;
}

const MONEY = /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k|m|million|thousand|libo)?\b/i;

/** The what-if, or null when the message is not one. */
export function readInterestIf(text: string, accounts: readonly string[]): InterestIf | null {
  const t = text.trim();
  if (!/\binterest\b|\btubo\b/i.test(t)) return null;
  if (!/\b(?:if\s+i\s+(?:have|had|put|save|saved|deposit|keep)|what\s+if|with|kung)\b/i.test(t) && !/\bhow\s+much\b[^.?]*\b(?:would|will|could)\b/i.test(t)) return null;
  const words = centavosInWords(t);
  const m = MONEY.exec(t.replace(/\b(?:19|20)\d{2}\b/g, " "));
  let amount: Centavos | null = null;
  if (m?.[1]) {
    const whole = m[1].replace(/,/g, "");
    const [w, f = ""] = whole.split(".");
    const base = Number(w) * 100 + Number(f.padEnd(2, "0").slice(0, 2));
    const unit = (m[2] ?? "").toLowerCase();
    amount = unit === "k" || unit === "thousand" || unit === "libo" ? base * 1000 : unit === "m" || unit === "million" ? base * 1_000_000 : base;
  } else if (words !== null) amount = words;
  if (amount === null || amount <= 0) return null;
  const flat = ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const account =
    [...accounts]
      .sort((a, b) => b.length - a.length)
      .find((a) => flat.includes(` ${a.toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `)) ?? "";
  return { amount, account };
}

export interface InterestRate {
  readonly account: string;
  /** Days looked over. */
  readonly days: number;
  /** Interest credited in those days. */
  readonly interest: Centavos;
  /** The average balance held over those days. */
  readonly average: Centavos;
  /** Interest per peso per day, as credited. */
  readonly daily: number;
}

const isInterest = (t: Transaction): boolean => t.type === "Revenue" && /\binterest\b/i.test(`${t.item} ${t.description}`);

/**
 * The rate an account earned over the last `days` days: its interest
 * credits against the balance it held each day. Null when it earned none.
 */
export function earnedRate(transactions: readonly Transaction[], account: string, asOf: IsoDate, days = 30): InterestRate | null {
  const into = (w: string): boolean => w === account;
  const from = addDays(asOf, -days + 1);
  const credits = transactions.filter((t) => isInterest(t) && t.toWallet === account && t.date >= from && t.date <= asOf);
  const interest = credits.reduce((s, t) => s + t.total, 0);
  if (interest <= 0) return null;
  // The balance at the end of each day in the window.
  const rows = transactions.filter((t) => t.date <= asOf).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let balance = 0;
  let i = 0;
  for (; i < rows.length && (rows[i]?.date ?? "") < from; i++) balance += walletDelta(rows[i]!, into);
  let sum = 0;
  for (let d = 0; d < days; d++) {
    const day = addDays(from, d);
    for (; i < rows.length && (rows[i]?.date ?? "") <= day; i++) balance += walletDelta(rows[i]!, into);
    sum += Math.max(0, balance);
  }
  const average = Math.round(sum / days);
  if (average <= 0) return null;
  return { account, days, interest, average, daily: interest / (average * days) };
}

/** The account that earns interest: the one with the most interest credited lately. */
export function interestAccount(transactions: readonly Transaction[], asOf: IsoDate): string {
  const from = addDays(asOf, -90);
  const by = new Map<string, Centavos>();
  for (const t of transactions) if (isInterest(t) && t.toWallet && t.date >= from && t.date <= asOf) by.set(t.toWallet, (by.get(t.toWallet) ?? 0) + t.total);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** The figures, worked out, for the answer. */
export function interestIfWords(ask: InterestIf, transactions: readonly Transaction[], asOf: IsoDate): string {
  const account = ask.account || interestAccount(transactions, asOf);
  const rate = account ? earnedRate(transactions, account, asOf) : null;
  if (!rate) {
    return `No interest has been credited${account ? ` to ${account}` : ""} in the last 30 days, so there is no rate of your own to work it out from.`;
  }
  const perDay = Math.round(ask.amount * rate.daily);
  const perMonth = Math.round(ask.amount * rate.daily * 30);
  const perYear = Math.round(ask.amount * rate.daily * 365);
  const yearly = rate.daily * 365 * 100;
  return [
    `${account} earned ${formatMoney(rate.interest)} of interest in the last ${rate.days} days on an average balance of ${formatMoney(rate.average)}: about ${yearly.toFixed(2)}% a year, as credited.`,
    `At that rate, ${formatMoney(ask.amount)} would earn about ${formatMoney(perDay)} a day, ${formatMoney(perMonth)} in 30 days and ${formatMoney(perYear)} in a year.`,
    "Simple interest at the rate your account has been earning; the bank's own rate and how it adds interest can change, and a larger balance may sit in a different rate tier.",
  ].join(" ");
}
