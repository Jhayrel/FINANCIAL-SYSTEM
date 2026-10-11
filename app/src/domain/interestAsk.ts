/**
 * "My Maya Bank is 3,500.42 now, I earned interest": the interest is what
 * the account holds less what the ledger has for it, never the balance.
 *
 * 7 October 2026: a sentence like that made a card for the whole balance as
 * Bank interest; the owner discarded it, then "look how much balance I have
 * in the system and compare" was asked which account it was. The interest
 * was under a peso. (Figures here invented.)
 */

import { sharedWord } from "./investigateAsk";
import { parseAmount, type Centavos } from "./money";

export interface InterestFromBalance {
  readonly account: string;
  /** What the owner says the account holds. */
  readonly told: Centavos;
  /** What the ledger has for it. */
  readonly ledger: Centavos;
  /** told less ledger: the interest when it is above nothing. */
  readonly gap: Centavos;
}

const EARNS = /\b(?:interest|interests|tubo|earn(?:ed|ing|s)?|kita)\b/i;

/** The account a sentence names, the longest name first, a name's words before any part in brackets counting too ("maya bank"). */
export function accountIn(text: string, accounts: readonly string[]): string {
  const said = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const words = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ranked = accounts
    .flatMap((a) => [
      { a, w: words(a) },
      { a, w: words(a.replace(/\(.*\)/, "")) },
    ])
    .filter((x) => x.w.length > 0)
    .sort((x, y) => y.w.length - x.w.length);
  return ranked.find((x) => said.includes(` ${x.w} `))?.a ?? "";
}

export function interestFromBalance(
  text: string,
  accounts: readonly string[],
  balanceOf: (account: string) => Centavos,
  /** The account the last few messages were about. */
  inContext?: string,
): InterestFromBalance | null {
  if (!EARNS.test(text)) return null;
  const named = accountIn(text, accounts);
  if (!named) return null;
  // The balance said: a figure with centavos, or the biggest figure in the sentence.
  const figures = [...text.matchAll(/(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi)]
    .map((m) => parseAmount(m[1] ?? ""))
    .filter((v): v is Centavos => v !== null && v > 0);
  if (figures.length === 0) return null;
  const told = Math.max(...figures);
  // "interest in my maya": Maya or Maya Bank, whichever the conversation or the figure points at.
  const account = sharedWord(named, accounts, told, balanceOf, inContext);
  const ledger = balanceOf(account);
  // A balance, not a credit: about what the ledger holds, not a few pesos.
  if (ledger <= 0 || told < ledger / 2) return null;
  return { account, told, ledger, gap: told - ledger };
}
