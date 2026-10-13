/**
 * "518 is what's left of my cash, all used on travel. Check how much I spent
 * and add it" (owner, 12 October 2026).
 *
 * The money that went is what the ledger holds less what is left in hand.
 * The model was asked this and said it could not work it out; the app can,
 * from the wallet's own balance, and offers it as an entry to confirm. A
 * sentence that only says what is left, with no word of spending, is a
 * balance, not this, and is left to the other readers.
 */
import { accountIn } from "./interestAsk";
import { parseAmount, type Centavos } from "./money";
import type { ReferenceLists } from "./types";

export interface SpentFromLeft {
  readonly account: string;
  /** What is left in hand, as said. */
  readonly left: Centavos;
  /** What the ledger holds in that account now. */
  readonly ledger: Centavos;
  /** What went: the ledger less what is left. Zero or less when nothing is missing. */
  readonly spent: Centavos;
  /** The kind of spending named, if one was. */
  readonly item: string;
}

const NUM = String.raw`(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const LEFT_AFTER = new RegExp(
  String.raw`${NUM}\s*(?:pesos?|php)?\s*(?:is|na\s+lang|nalang|lang)?\s*(?:what'?s|whats|what\s+is|the)?\s*(?:left|remaining|natira|natitira|ang\s+natira)\b`,
  "i",
);
const LEFT_BEFORE = new RegExp(String.raw`\b(?:left|remaining|natira|natitira)\s*(?:is|ay|na)?\s*(?:only\s+)?${NUM}`, "i");
const SPENT = /\b(?:spent|spend|spending|used?|all\s+use|gastos|ginastos|nagastos|naubos|expenses?|paid|bought)\b/i;

export function spentFromLeft(
  text: string,
  reference: Pick<ReferenceLists, "wallets" | "savings" | "spendingTypes">,
  balanceOf: (account: string) => Centavos,
): SpentFromLeft | null {
  const t = text.trim();
  if (!SPENT.test(t)) return null;
  const m = LEFT_AFTER.exec(t) ?? LEFT_BEFORE.exec(t);
  if (!m || !m[1]) return null;
  const left = parseAmount(m[1]);
  if (left === null || left < 0) return null;
  const accounts = [...reference.wallets, ...reference.savings];
  const account = accountIn(t, accounts) || (/\bcash\b/i.test(t) ? (accounts.find((a) => /^cash$/i.test(a.trim())) ?? "") : "");
  if (!account) return null;
  const ledger = balanceOf(account);
  const kinds = reference.spendingTypes.map((k) => (typeof k === "string" ? k : k.name));
  const item = kinds.find((k) => k.trim().length >= 3 && new RegExp(`\\b${k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) ?? "";
  return { account, left, ledger, spent: ledger - left, item };
}
