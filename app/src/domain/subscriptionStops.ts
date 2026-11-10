/**
 * "Since I stopped Netflix and Spotify, how much have I saved?": what each
 * named bill or subscription really did, from the ledger.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026: "Since I stopped Netflix and Spotify in
 * September, how much have I saved so far? And how much more would I save
 * by the end of the year if I also stop Office 365 today?" The answer
 * counted both as saved, Netflix at Office's price. Spotify was never
 * stopped (paid again in November), and Netflix's last payment was well
 * over a year before, so stopping it saved nothing this year.
 * The question said something untrue, and the answer went along with it.
 *
 * So each one named is looked up: stopped or not, and since when; the last
 * payment and what it usually costs; what stopping it has saved, counted
 * as the monthly payments missed since, and only when it was still being
 * paid when it was stopped; and what stopping it today would save to the
 * end of the year, counted as the payments still to come. The words say
 * plainly where the question was wrong.
 */
import { addDays, daysBetween, daysInMonth, formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

/** Stopping, cancelling, or having stopped. */
const STOP = /\b(?:stop|stopped|stopping|cancel\w*|unsubscrib\w*|quit|drop(?:ped)?|end(?:ed)?\s+my|tinigil|itigil|hinto)\b/i;
/** And what it saves or costs. */
const MONEY = /\b(?:sav(?:e|ed|es|ing)|how\s+much|cost|costs|spend|spent|paid|pay|tipid|natipid|makatipid)\b/i;

const IGNORED = /^(?:home|bill|bills|plan|plans|monthly|service|payment|subscription|account|prepaid|postpaid|other|online|payments)$/;

/** Every bill or subscription the message names, by its whole name or a word only it has. */
export function subscriptionsNamed(text: string, names: readonly string[]): string[] {
  const lower = text.toLowerCase();
  const own = (n: string): string[] => n.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !IGNORED.test(w));
  const counts = new Map<string, number>();
  for (const n of names) for (const w of new Set(own(n))) counts.set(w, (counts.get(w) ?? 0) + 1);
  const found = names.filter((n) => {
    const full = n.trim().toLowerCase();
    if (full.length > 2 && new RegExp(`(?<![a-z0-9])${full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(lower)) return true;
    return own(n).some((w) => counts.get(w) === 1 && new RegExp(`\\b${w}\\b`).test(lower));
  });
  // In the order the message says them.
  const at = (n: string): number => {
    const words = [n.trim().toLowerCase(), ...own(n)];
    const hits = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
    return hits.length > 0 ? Math.min(...hits) : Number.MAX_SAFE_INTEGER;
  };
  return [...new Set(found)].sort((a, b) => at(a) - at(b));
}

/** A question about stopping bills or subscriptions and what it saves, naming at least one. */
export function asksSubscriptionStops(text: string, names: readonly string[]): boolean {
  return STOP.test(text) && MONEY.test(text) && subscriptionsNamed(text, names).length > 0;
}

export interface SubscriptionStop {
  readonly name: string;
  readonly stoppedSince: IsoDate | null;
  readonly last: { readonly on: IsoDate; readonly amount: Centavos } | null;
  /** Months with a payment in the year before the last one, so "every month" can be said. */
  readonly paidMonths: number;
  /** Payments missed since it was stopped, and what they come to: only when it was being paid then. */
  readonly missed: number;
  readonly saved: Centavos;
  /** Payments still to come this year if it is stopped today, and what they come to. */
  readonly toCome: number;
  readonly wouldSave: Centavos;
  /** Paid after the day it was marked stopped. */
  readonly paidSince: Centavos;
}

const monthsBetween = (from: IsoDate, to: IsoDate): number =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));

/** The same day of the month, `n` months on, never past the month's end. */
function monthsOn(day: IsoDate, n: number): IsoDate {
  const y0 = Number(day.slice(0, 4));
  const m0 = Number(day.slice(5, 7)) - 1 + n;
  const y = y0 + Math.floor(m0 / 12);
  const m = (m0 % 12) + 1;
  const d = Math.min(Number(day.slice(8, 10)), daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function subscriptionStops(
  names: readonly string[],
  transactions: readonly Transaction[],
  stopped: readonly { readonly name: string; readonly since: IsoDate }[],
  asOf: IsoDate,
): SubscriptionStop[] {
  const yearEnd = `${asOf.slice(0, 4)}-12-31`;
  return names.map((name) => {
    const rows = transactions
      .filter((t) => t.type === "Spending" && t.item.trim().toLowerCase() === name.trim().toLowerCase() && t.date <= asOf)
      .sort((a, b) => a.date.localeCompare(b.date));
    const lastRow = rows[rows.length - 1];
    const last = lastRow ? { on: lastRow.date, amount: lastRow.total } : null;
    const since = stopped.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase())?.since ?? null;
    const paidMonths = last ? new Set(rows.filter((t) => t.date > addDays(last.on, -365)).map((t) => t.date.slice(0, 7))).size : 0;
    let missed = 0;
    let paidSince = 0;
    if (since && last) {
      paidSince = rows.filter((t) => t.date > since).reduce((s, t) => s + t.total, 0);
      // Being paid when it was stopped: its last payment within about a month and a half of the stop.
      if (paidSince === 0 && daysBetween(last.on, since) <= 45) {
        for (let k = 1; monthsOn(last.on, k) <= asOf; k += 1) if (monthsOn(last.on, k) > since) missed += 1;
      }
    }
    let toCome = 0;
    if (!since && last && monthsBetween(last.on, asOf) <= 1) {
      for (let k = 1; monthsOn(last.on, k) <= yearEnd; k += 1) if (monthsOn(last.on, k) >= asOf) toCome += 1;
    }
    const amount = last?.amount ?? 0;
    return { name, stoppedSince: since, last, paidMonths, missed, saved: missed * amount, toCome, wouldSave: toCome * amount, paidSince };
  });
}

/** Said plainly, each one on its own line, what the ledger shows first. */
export function subscriptionStopWords(stops: readonly SubscriptionStop[], asOf: IsoDate): string {
  const year = asOf.slice(0, 4);
  const lines = stops.map((s) => {
    const last = s.last ? `last paid ${formatMoney(s.last.amount)} on ${formatMedium(s.last.on)}` : "never paid in the ledger";
    if (s.stoppedSince) {
      if (s.paidSince > 0) return `- **${s.name}**: marked stopped on ${formatMedium(s.stoppedSince)}, but ${formatMoney(s.paidSince)} was paid after that (${last}). Nothing was saved.`;
      if (s.missed > 0) return `- **${s.name}**: stopped on ${formatMedium(s.stoppedSince)}, ${last}. ${s.missed} monthly ${s.missed === 1 ? "payment" : "payments"} not made since: **${formatMoney(s.saved)} saved** so far.`;
      return s.last
        ? `- **${s.name}**: stopped on ${formatMedium(s.stoppedSince)}, but its last payment, ${formatMoney(s.last.amount)} on ${formatMedium(s.last.on)}, was long before that. It was not being paid, so stopping it saved **nothing**.`
        : `- **${s.name}**: stopped on ${formatMedium(s.stoppedSince)}, and never paid in the ledger, so stopping it saved **nothing**.`;
    }
    const note = s.last ? `${last}${s.paidMonths >= 3 ? `, paid in ${s.paidMonths} of the last 12 months` : ""}` : last;
    const would =
      s.toCome > 0
        ? ` Stopped today, the ${s.toCome} ${s.toCome === 1 ? "payment" : "payments"} still to come this year would not be made: **${formatMoney(s.wouldSave)} saved by the end of ${year}**.`
        : s.last
          ? ` No payment of it is still to come this year, so stopping it today saves nothing before the end of ${year}.`
          : "";
    return `- **${s.name} is not stopped**: ${note}.${would}`;
  });
  const savedSoFar = stops.reduce((t, s) => t + s.saved, 0);
  const wouldSave = stops.reduce((t, s) => t + s.wouldSave, 0);
  const sums = [
    stops.some((s) => s.stoppedSince) ? `Saved so far by what is stopped: ${formatMoney(savedSoFar)}.` : "",
    stops.some((s) => s.toCome > 0) ? `Saved by the end of ${year} if what is still running is stopped today: ${formatMoney(wouldSave)}.` : "",
  ].filter(Boolean);
  return [`What the ledger shows for each, as of ${formatMedium(asOf)}:`, ...lines, ...sums].join("\n");
}
