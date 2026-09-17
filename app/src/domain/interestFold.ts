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
 */

import { formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { Proposal } from "./proposal";
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

export function foldInterest(
  proposals: readonly Proposal[],
  transactions: readonly Transaction[],
  reference: ReferenceLists,
): Proposal[] {
  const interestItem = reference.revenueCategories.find((c) => INTEREST.test(c)) ?? "";
  const byAccount = new Map<string, Proposal[]>();
  for (const p of proposals) {
    if (!isInterestCredit(p)) continue;
    byAccount.set(p.draft.toWallet, [...(byAccount.get(p.draft.toWallet) ?? []), p]);
  }

  let out = [...proposals];
  for (const [account, credits] of byAccount) {
    if (credits.length < 3) continue;

    const recordedTo = lastInterestInto(transactions, account);
    const fresh = recordedTo ? credits.filter((p) => p.draft.date > recordedTo) : credits;
    const skipped = credits.length - fresh.length;
    const at = out.indexOf(credits[0] as Proposal);
    out = out.filter((p) => !credits.includes(p));
    if (fresh.length === 0) continue;

    const dates = fresh.map((p) => p.draft.date).sort();
    const first = dates[0] as IsoDate;
    const last = dates[dates.length - 1] as IsoDate;
    const total: Centavos = fresh.reduce((sum, p) => sum + (p.draft.amount ?? 0), 0);
    const figures = fresh.map((p) => formatMoney(p.draft.amount ?? 0));
    const confidence = fresh.reduce<Proposal["confidence"]>((low, p) => (RANK[p.confidence] > RANK[low] ? p.confidence : low), "high");

    const combined: Proposal = {
      draft: {
        ...(fresh[fresh.length - 1] as Proposal).draft,
        date: last,
        amount: total,
        item: interestItem || (fresh[0] as Proposal).draft.item,
        description: first === last ? `Interest earned, ${formatMedium(last)}` : `Interest earned, ${formatMedium(first)} to ${formatMedium(last)}`,
        notes: `${fresh.length} credits: ${figures.slice(0, 16).join(" + ")}${figures.length > 16 ? ` and ${figures.length - 16} more` : ""}`,
      },
      confidence,
      sourceRef: (fresh[0] as Proposal).sourceRef,
      adjustments: [
        `${fresh.length} interest credits added together into one entry of ${formatMoney(total)}. The balance comes out the same as adding each one.`,
        ...(skipped > 0
          ? [
              `${skipped} ${skipped === 1 ? "credit" : "credits"} dated on or before ${formatMedium(recordedTo as IsoDate)} left out: the ledger already has interest into ${account} up to that day.`,
            ]
          : []),
      ],
    };
    out.splice(Math.max(0, Math.min(at, out.length)), 0, combined);
  }
  return out;
}
