/**
 * "This is now my new balance in Maya Bank. Let me know how much interest I
 * earn", with a screenshot: the interest is the balance on screen less what
 * the ledger has for the account, never a total the screen also shows.
 *
 * 13 October 2026: the screenshot showed the balance and the month's interest
 * so far; the card was the month's total, ₱5.27, though most of it was in the
 * ledger already. The balance less the ledger was ₱0.77. (`interestAsk.ts` is
 * the same sum for a balance typed in words.)
 */
import type { Centavos } from "./money";
import type { Proposal, ReadBalance } from "./proposal";

export interface InterestFromPicture {
  readonly account: string;
  readonly told: Centavos;
  readonly ledger: Centavos;
  /** Told less ledger: the interest to add when it is above nothing. */
  readonly gap: Centavos;
  readonly date: string;
  /** The cards read, less the interest readings for this account the gap replaces. */
  readonly others: readonly Proposal[];
}

const ASKS = /\b(?:interest|interests|tubo|earn(?:ed|ing)?|kita)\b/i;

export function interestFromPicture(
  note: string,
  proposals: readonly Proposal[],
  balances: readonly ReadBalance[],
  /** Savings first: interest is paid there. */
  accounts: readonly string[],
  balanceOf: (account: string) => Centavos,
): InterestFromPicture | null {
  if (!ASKS.test(note)) return null;
  const balance = accounts.map((a) => balances.find((b) => b.account === a)).find((b) => b !== undefined);
  if (!balance) return null;
  const ledger = balanceOf(balance.account);
  // A balance, not a credit: about what the ledger holds, never a few pesos read as one.
  if (ledger <= 0 || balance.amount < ledger / 2) return null;
  const others = proposals.filter((p) => !(p.draft.flow === "Revenue" && p.draft.toWallet === balance.account && /interest|tubo/i.test(`${p.draft.item} ${p.draft.description}`)));
  return { account: balance.account, told: balance.amount, ledger, gap: balance.amount - ledger, date: balance.date, others };
}
