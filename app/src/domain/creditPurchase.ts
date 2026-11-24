/**
 * A purchase paid with a credit line, read off a picture as two cards: the
 * borrowing and the spend.
 *
 * The owner's 20 November 2026 receipt came back as a Maya Credit borrowing
 * dated the 21st into Maya, and a spend of the same amount dated the
 * 19th from Cash with no kind. Added as they were, Maya would have gained
 * money it never held and Cash lost money it never paid. The two
 * are one purchase: the spend is from the wallet the borrowing lands in, on
 * the borrowing's day, and the owner then said so ("if i pay using credit add
 * it like paying using credit").
 *
 * Only when exactly one borrowing and one spend of the same amount are among
 * the cards, within three days of each other: anything less certain is left
 * as read.
 */

import type { Proposal } from "./proposal";

const DAY = 86_400_000;
const apart = (a: string, b: string): number => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;

export function pairCreditPurchases(proposals: readonly Proposal[]): Proposal[] {
  const out = [...proposals];
  const draws = out.filter((p) => p.draft.flow === "Debt" && p.draft.debtEffect === "draw" && (p.draft.amount ?? 0) > 0 && p.draft.toWallet.trim() !== "");
  for (const draw of draws) {
    const amount = draw.draft.amount;
    const spends = out.filter((p) => p.draft.flow === "Spending" && p.draft.amount === amount && apart(p.draft.date, draw.draft.date) <= 3);
    if (spends.length !== 1 || draws.filter((d) => d.draft.amount === amount).length !== 1) continue;
    const spend = spends[0];
    if (!spend) continue;
    if (spend.draft.fromWallet === draw.draft.toWallet && spend.draft.date === draw.draft.date) continue;
    const i = out.indexOf(spend);
    out[i] = {
      ...spend,
      draft: { ...spend.draft, date: draw.draft.date, fromWallet: draw.draft.toWallet },
      adjustments: [
        ...spend.adjustments,
        `Paid with ${draw.draft.item || "the credit line"}: from ${draw.draft.toWallet}, where the borrowing beside it lands, on its day. Add both.`,
      ],
    };
  }
  return out;
}
