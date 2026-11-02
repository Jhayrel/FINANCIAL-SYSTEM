/**
 * Interest credits off a savings screen, as one entry.
 *
 * ── The screen this is for ────────────────────────────────────────────────
 *
 * The owner's savings app pays interest every day, twice: "Net base interest
 * ₱0.10" and "Net boosted interest ₱0.12", a line each. A week of that is
 * fourteen cards of ten centavos, and a month is sixty. Nobody checks sixty
 * cards, and nobody should have to.
 *
 * Three or more interest credits into the same account become one entry for
 * their total, dated the last day, with every figure listed in its notes. The
 * balance comes out the same to the centavo as adding each, because the total
 * is summed here in centavos and never by a model.
 *
 * ── Days already in the ledger ────────────────────────────────────────────
 *
 * A second screenshot of the same list overlaps the first. Credits dated on
 * or before the last interest the ledger already has for that account are
 * left out, and the card says so, so the same ten centavos are not counted
 * twice. The figure stays editable on the card for the one day that was only
 * half recorded.
 *
 * ── The balance settles it ────────────────────────────────────────────────
 *
 * The owner records interest both ways: a line at a time, and as one entry
 * worked out from the balance ("Interest earned, October 24", PHP 2.00 for
 * several days). A list of daily credits cannot tell which of its days such
 * an entry already holds. The balance can. When the same pictures show what
 * the account holds, the card adds what the balance is short of, not the
 * list's sum, and says both (owner, 1 November 2026: "train it better in
 * duplication like in maya bank interest"). A balance that already matches
 * means every credit is counted, and nothing is offered.
 */

import { walletBalance } from "./balances";
import { formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { Proposal, ReadBalance } from "./proposal";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

const INTEREST = /\binterest\b/i;

const isInterestCredit = (p: Proposal): boolean =>
  p.draft.flow === "Revenue" &&
  p.draft.amount !== null &&
  p.draft.amount > 0 &&
  p.draft.toWallet !== "" &&
  (INTEREST.test(p.draft.item) || INTEREST.test(p.draft.description));

const RANK = { high: 0, medium: 1, low: 2 } as const;

/** The last day the ledger holds interest into an account, or null when it holds none. */
export function lastInterestInto(transactions: readonly Transaction[], account: string): IsoDate | null {
  let last: IsoDate | null = null;
  for (const t of transactions) {
    if (t.type !== "Revenue" || t.toWallet !== account) continue;
    if (!INTEREST.test(t.item) && !INTEREST.test(t.description)) continue;
    if (last === null || t.date > last) last = t.date;
  }
  return last;
}

export interface FoldedInterest {
  readonly proposals: Proposal[];
  /** What is said beside the cards: a list that is counted already, or a balance too far off to be interest. */
  readonly notes: string[];
}

export function foldInterest(
  proposals: readonly Proposal[],
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  balances: readonly ReadBalance[] = [],
): Proposal[] {
  return foldInterestWith(proposals, transactions, reference, balances).proposals;
}

/** The latest day's credits, as a rate: "₱0.50 a day (₱0.27 + ₱0.23), about ₱15.00 a month". Null for one day. */
function rateOf(credits: readonly Proposal[]): string | null {
  const days = [...new Set(credits.map((p) => p.draft.date))].sort();
  if (days.length < 2) return null;
  const last = days[days.length - 1] as IsoDate;
  const that = credits.filter((p) => p.draft.date === last);
  const daily = that.reduce((n, p) => n + (p.draft.amount ?? 0), 0);
  if (daily <= 0) return null;
  const parts = that.length > 1 ? ` (${that.map((p) => `${formatMoney(p.draft.amount ?? 0)} ${p.draft.description.replace(/^net\s+/i, "").replace(/\s*interest$/i, "").trim().toLowerCase() || "interest"}`).join(", ")})` : "";
  return `At ${formatMedium(last)}'s ${formatMoney(daily)} a day${parts}, it earns about ${formatMoney(daily * 30)} a month, if the balance and rate stay as they are.`;
}

export function foldInterestWith(
  proposals: readonly Proposal[],
  transactions: readonly Transaction[],
  reference: ReferenceLists,
  balances: readonly ReadBalance[] = [],
): FoldedInterest {
  const notes: string[] = [];
  const interestItem = reference.revenueCategories.find((c) => INTEREST.test(c)) ?? "";
  const byAccount = new Map<string, Proposal[]>();
  for (const p of proposals) {
    if (!isInterestCredit(p)) continue;
    byAccount.set(p.draft.toWallet, [...(byAccount.get(p.draft.toWallet) ?? []), p]);
  }

  let out = [...proposals];
  for (const [account, credits] of byAccount) {
    if (credits.length < 2) continue;
    const recordedTo = lastInterestInto(transactions, account);
    const fresh = recordedTo ? credits.filter((p) => p.draft.date > recordedTo) : credits;
    const skipped = credits.length - fresh.length;
    const leftOut =
      skipped > 0
        ? `${skipped} ${skipped === 1 ? "credit" : "credits"} dated on or before ${formatMedium(recordedTo as IsoDate)} left out: the ledger already has interest into ${account} up to that day.`
        : "";
    const shown = balances.find((b) => b.account === account);
    const ledger = shown ? walletBalance(transactions, account) : 0;
    const gap = shown ? shown.amount - ledger : 0;
    const listed: Centavos = fresh.reduce((sum, p) => sum + (p.draft.amount ?? 0), 0);
    const rate = rateOf(credits);

    // Two credits: one day's pair, kept as they are unless the ledger has them already.
    if (credits.length < 3 && !shown) {
      if (skipped === 0) continue;
      out = out.filter((p) => !credits.includes(p) || fresh.includes(p));
      if (fresh.length === 0) notes.push(`The interest in the picture is in the ledger already: ${leftOut.replace(/ left out:.*$/, "")} are counted in ${account}'s entries up to ${formatMedium(recordedTo as IsoDate)}.`);
      else out = out.map((p) => (fresh.includes(p) ? { ...p, adjustments: [...p.adjustments, leftOut] } : p));
      continue;
    }

    const at = out.indexOf(credits[0] as Proposal);
    out = out.filter((p) => !credits.includes(p));

    // The balance in the same pictures decides what is missing.
    let amount = listed;
    const byBalance: string[] = [];
    if (shown) {
      const cap = Math.max(10_000, listed * 3);
      if (gap <= 0) {
        notes.push(
          `${account} shows ${formatMoney(shown.amount)} and the ledger has ${formatMoney(ledger)}${gap < 0 ? `, ${formatMoney(-gap)} more than the picture` : ", the same"}, so the interest in the list is counted already and nothing is added.${gap < 0 ? ' Say "find the difference" and I will look for why.' : ""}${rate ? ` ${rate}` : ""}`,
        );
        continue;
      }
      if (gap <= cap) {
        amount = gap;
        byBalance.push(
          gap === listed
            ? `The balance agrees: ${account} shows ${formatMoney(shown.amount)}, ${formatMoney(gap)} above the ledger's ${formatMoney(ledger)}.`
            : `By the balance: ${account} shows ${formatMoney(shown.amount)} and the ledger has ${formatMoney(ledger)}, so ${formatMoney(gap)} is missing, where the list after the last recorded day adds up to ${formatMoney(listed)}. ${gap > listed ? `The ${formatMoney(gap - listed)} more is interest an earlier entry did not hold.` : `The other ${formatMoney(listed - gap)} of the list is in earlier entries already.`} The card adds ${formatMoney(gap)}, so the ledger matches the bank.`,
        );
      } else {
        notes.push(`${account} shows ${formatMoney(shown.amount)} and the ledger has ${formatMoney(ledger)}: ${formatMoney(gap)} more, too much to be interest alone. The interest card is the list's own ${formatMoney(listed)}; say "find the difference" for the rest.`);
      }
    }
    if (fresh.length === 0 && amount === listed) {
      notes.push(`The interest in the picture is in the ledger already: all ${credits.length} credits are dated on or before ${formatMedium(recordedTo as IsoDate)}, the last day ${account} has interest recorded.${rate ? ` ${rate}` : ""}`);
      continue;
    }

    const counted = fresh.length > 0 ? fresh : credits;
    const dates = counted.map((p) => p.draft.date).sort();
    const first = dates[0] as IsoDate;
    const last = (shown && amount !== listed ? [...dates, shown.date].sort().pop() : dates[dates.length - 1]) as IsoDate;
    const figures = fresh.map((p) => formatMoney(p.draft.amount ?? 0));
    const confidence = counted.reduce<Proposal["confidence"]>((low, p) => (RANK[p.confidence] > RANK[low] ? p.confidence : low), "high");

    const combined: Proposal = {
      draft: {
        ...(counted[counted.length - 1] as Proposal).draft,
        date: last,
        amount,
        item: interestItem || (counted[0] as Proposal).draft.item,
        description: first === last ? `Interest earned, ${formatMedium(last)}` : `Interest earned, ${formatMedium(first)} to ${formatMedium(last)}`,
        notes:
          fresh.length > 0
            ? `${fresh.length} credits: ${figures.slice(0, 16).join(" + ")}${figures.length > 16 ? ` and ${figures.length - 16} more` : ""}${amount !== listed && shown ? `; by the balance ${formatMoney(shown.amount)} less the ledger's ${formatMoney(ledger)}` : ""}`
            : `By the balance ${formatMoney(shown?.amount ?? 0)} less the ledger's ${formatMoney(ledger)}`,
      },
      confidence,
      sourceRef: (counted[0] as Proposal).sourceRef,
      adjustments: [
        ...(fresh.length > 1 ? [`${fresh.length} interest credits added together into one entry of ${formatMoney(listed)}. The balance comes out the same as adding each one.`] : []),
        ...(leftOut ? [leftOut] : []),
        ...byBalance,
        ...(rate ? [rate] : []),
      ],
    };
    out.splice(Math.max(0, Math.min(at, out.length)), 0, combined);
  }
  return { proposals: out, notes };
}
