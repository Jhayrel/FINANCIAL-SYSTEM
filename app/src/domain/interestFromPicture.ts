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
import { accountIn } from "./interestAsk";

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
  return balanceFromPicture(note, proposals, balances, accounts, balanceOf);
}

/**
 * The same sum for a balance sent with no question: a savings screen alone
 * came back "No transaction was readable" (19 October 2026), though the
 * model had read its balance.
 */
export function balanceFromPicture(
  note: string,
  proposals: readonly Proposal[],
  balances: readonly ReadBalance[],
  accounts: readonly string[],
  balanceOf: (account: string) => Centavos,
): InterestFromPicture | null {
  /*
   * The screen's own name for the account ("My Savings", "Maya Savings") is
   * matched to theirs, the message helping: "my new maya bank balance" with
   * a Maya savings screen is Maya Bank (Personal savings) (20 October 2026).
   */
  const resolve = (b: ReadBalance): ReadBalance | undefined => {
    if (accounts.includes(b.account)) return b;
    const both = `${b.account} ${note}`;
    const saving = /\bsav(?:e|ing|ings)\b|\bbank\b/i.test(both);
    const named = accountIn(both, accounts) || accountIn(b.account, accounts);
    const pick = named && saving && !/sav|bank|reserve|fund/i.test(named) ? accounts.find((a) => /sav|bank/i.test(a) && a.toLowerCase().includes(named.toLowerCase().split(/\s+/)[0] ?? "")) ?? named : named;
    return pick ? { ...b, account: pick } : undefined;
  };
  const balance = accounts
    .map((a) => balances.map(resolve).find((b) => b?.account === a))
    .find((b): b is ReadBalance => b !== undefined);
  if (!balance) return null;
  const ledger = balanceOf(balance.account);
  // A balance, not a credit: about what the ledger holds, never a few pesos read as one.
  if (ledger <= 0 || balance.amount < ledger / 2) return null;
  const others = proposals.filter((p) => !(p.draft.flow === "Revenue" && p.draft.toWallet === balance.account && /interest|tubo/i.test(`${p.draft.item} ${p.draft.description}`)));
  return { account: balance.account, told: balance.amount, ledger, gap: balance.amount - ledger, date: balance.date, others };
}
