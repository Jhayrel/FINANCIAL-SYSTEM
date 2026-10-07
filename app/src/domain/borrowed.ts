/**
 * How much of the money in the owner's accounts is borrowed, followed through
 * every transfer and withdrawal, and how much of each purchase it paid for.
 *
 * ── What the owner asked for ───────────────────────────────────────────────
 *
 * 7 October 2026: "I'm 0 then I loan or credit then the AI or system or
 * notification knows how much money I have that is not from loan or credit,
 * then it warns me, like you're using that money from credit and you spend
 * it on a treat. Even if I transfer it, like a withdrawal: I have 500 in
 * cash, then withdraw 1000 from Maya, which received 5000 of credit, then
 * cash is 1500, and the 1000 is credit money and the rest is owned. What if
 * I loan and have revenue at the same time? What if I loan and pay it back
 * later the same day?"
 *
 * ── The rules ──────────────────────────────────────────────────────────────
 *
 * Every balance is still `walletDelta`'s, to the centavo: this only says
 * which part of each balance is borrowed. Nothing here changes a row.
 *
 *   B1  Money drawn on a loan or credit line (a Debt row, Draw, on a debt the
 *       owner owes that is not money held for someone) is borrowed money in
 *       the account it arrived in, labelled with whose it is.
 *   B2  Money leaving an account is the owner's own first. Borrowed money is
 *       used only once the account's own money is gone: spending is not on
 *       credit while the owner could have paid it themselves.
 *   B3  A transfer between the owner's own accounts carries its borrowed part
 *       with it: 1000 withdrawn from Maya, all of it credit, is 1000 of
 *       credit in Cash. A fee is paid from own money first, like spending.
 *   B4  Borrowed money in hand is never more than is still owed on that
 *       debt. A repayment, from any account, lowers it: borrowing 5000 and
 *       paying it back the same day leaves none in hand. What a repayment
 *       frees is taken from the paying account first, then from the account
 *       holding the most.
 *   B5  Within a day, money coming in is counted before money going out, so
 *       income and a loan on the same day both arrive before anything is
 *       spent, and the spending is the owner's own first (B2).
 *
 *   B6  Money held for someone (On behalf, held) is followed the same way
 *       and kept apart: it is never the owner's own, and it is the last money
 *       used, after their own and after what they borrowed.
 */

import { owedChange, type Debt } from "./debt";
import type { Centavos } from "./money";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

/** Borrowed money by whose it is: debt id to amount. */
type Lenders = Map<string, Centavos>;

export interface BorrowedUse {
  /** The borrowed part of the row's money out. */
  readonly amount: Centavos;
  /** Whose money it was, debt id to amount. */
  readonly from: ReadonlyMap<string, Centavos>;
}

export interface BorrowedMoney {
  /** Borrowed money still in the accounts counted, in all. */
  readonly inHand: Centavos;
  /** Money held for someone still in the accounts counted (B6). */
  readonly heldForOthers: Centavos;
  /** By account. Only accounts holding some. */
  readonly byAccount: ReadonlyMap<string, Centavos>;
  /** By account, what is not the owner's own: borrowed and held for others together. */
  readonly notOwnByAccount: ReadonlyMap<string, Centavos>;
  /** By debt: whose money it is, held money included. */
  readonly byLender: ReadonlyMap<string, Centavos>;
  /** What the accounts counted hold in all, own and borrowed. */
  readonly held: Centavos;
  /** The owner's own money in those accounts: what they hold less what is borrowed or held for others, never below 0. */
  readonly own: Centavos;
  /**
   * For each row that cost something, the part paid with borrowed money.
   * Only rows that used some are listed.
   */
  readonly spent: ReadonlyMap<string, BorrowedUse>;
  /** For each row that cost something, the part paid with money held for someone. */
  readonly spentHeld: ReadonlyMap<string, BorrowedUse>;
}

/** A debt the owner owes that is a loan or a credit line: not money held for someone. */
export const isBorrowing = (d: Debt): boolean => d.kind === "payable" && d.form !== "pass-through";

const comesIn = (t: Transaction): boolean =>
  t.type === "Revenue" || (t.type === "Debt" && (t.debtEffect === "draw" || t.debtEffect === "collect"));

/**
 * The borrowed part of the money in `accounts`, as of the end of `asOf`
 * (every row when no day is given).
 */
export function borrowedMoney(
  transactions: readonly Transaction[],
  debts: readonly Debt[],
  accounts: readonly string[],
  asOf?: IsoDate,
): BorrowedMoney {
  const ours = new Set(accounts.map((a) => a.trim()).filter(Boolean));
  const loans = new Set(debts.filter(isBorrowing).map((d) => d.id));
  const heldIds = new Set(debts.filter((d) => d.kind === "payable" && d.form === "pass-through").map((d) => d.id));
  const tracked = (id: string | undefined): id is string => id !== undefined && (loans.has(id) || heldIds.has(id));

  // B5: by day, money in before money out, otherwise in the ledger's own order.
  const rows = transactions
    .filter((t) => asOf === undefined || t.date <= asOf)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : Number(comesIn(b.t)) - Number(comesIn(a.t)) || a.i - b.i))
    .map(({ t }) => t);

  const balance = new Map<string, Centavos>();
  const borrowed = new Map<string, Lenders>();
  const owed = new Map<string, Centavos>();
  const spent = new Map<string, BorrowedUse>();
  const spentHeld = new Map<string, BorrowedUse>();

  const bal = (a: string): Centavos => balance.get(a) ?? 0;
  const lendersIn = (a: string): Lenders => {
    let l = borrowed.get(a);
    if (!l) {
      l = new Map();
      borrowed.set(a, l);
    }
    return l;
  };
  const sum = (l: ReadonlyMap<string, Centavos> | undefined): Centavos => {
    let s = 0;
    for (const v of l?.values() ?? []) s += v;
    return s;
  };
  const add = (l: Lenders, id: string, amount: Centavos): void => {
    if (amount <= 0) return;
    l.set(id, (l.get(id) ?? 0) + amount);
  };
  /**
   * Takes up to `amount` out of an account's borrowed and held money; returns
   * what was taken, by lender. A repayment takes its own lender's money
   * first; then what was borrowed, oldest first; money held for someone last
   * (B6). With `only`, nothing but that lender's.
   */
  const take = (a: string, amount: Centavos, first?: string, only = false): Lenders => {
    const out: Lenders = new Map();
    const l = borrowed.get(a);
    if (!l || amount <= 0) return out;
    const order = [...l.keys()].sort((x, y) => Number(y === first) - Number(x === first) || Number(heldIds.has(x)) - Number(heldIds.has(y)));
    let left = amount;
    for (const id of order) {
      if (left <= 0) break;
      if (only && id !== first) continue;
      const v = l.get(id) ?? 0;
      const part = Math.min(v, left);
      if (v - part > 0) l.set(id, v - part);
      else l.delete(id);
      out.set(id, part);
      left -= part;
    }
    return out;
  };

  for (const t of rows) {
    const from = t.fromWallet.trim();
    const to = t.toWallet.trim();

    // ── Money out of one of the owner's accounts (B2, B3) ─────────────────
    if (t.type !== "Revenue" && from && ours.has(from) && t.total > 0) {
      const own = Math.max(0, bal(from) - sum(borrowed.get(from)));
      const fromOwn = Math.min(t.total, own);
      const taken = take(from, t.total - fromOwn, t.type === "Debt" ? t.debtId : undefined);
      const takenAll = sum(taken);

      if (takenAll > 0) {
        // A transfer to another of the owner's accounts carries its borrowed part; the fee is paid from own money first.
        const fee = Math.max(0, t.total - t.amount);
        const feeBorrowed = Math.max(0, fee - fromOwn);
        const moving = t.type === "Transfer" && to && ours.has(to) ? Math.max(0, takenAll - feeBorrowed) : 0;
        let carry = moving;
        const left: Lenders = new Map();
        for (const [id, v] of taken) {
          const part = Math.min(v, carry);
          if (part > 0) add(lendersIn(to), id, part);
          carry -= part;
          if (v - part > 0) left.set(id, v - part);
        }
        // What left the accounts as a cost: what a purchase, money sent away, or a fee used of borrowed or held money.
        const cost = costOf(t);
        if (cost > 0 && sum(left) > 0) {
          const lent = new Map([...left].filter(([id]) => !heldIds.has(id)));
          const held = new Map([...left].filter(([id]) => heldIds.has(id)));
          const fromLent = Math.min(sum(lent), cost);
          if (fromLent > 0) spent.set(t.id, { amount: fromLent, from: lent });
          const fromHeld = Math.min(sum(held), cost - fromLent);
          if (fromHeld > 0) spentHeld.set(t.id, { amount: fromHeld, from: held });
        }
      }
    }

    // ── The balances, by the one balance rule (`balances.ts`) ─────────────
    if (t.type === "Revenue" && from) balance.set(from, bal(from) + t.total);
    if (to) balance.set(to, bal(to) + t.amount);
    if (from && t.type !== "Revenue") balance.set(from, bal(from) - t.total);

    // ── Money borrowed into one of the owner's accounts (B1) ──────────────
    if (t.type === "Debt" && tracked(t.debtId)) {
      const id = t.debtId;
      owed.set(id, (owed.get(id) ?? 0) + owedChange(t));
      if (t.debtEffect === "draw" && to && ours.has(to)) add(lendersIn(to), id, t.amount);

      // B4: never more in hand than is still owed; a repayment frees its own account first.
      const still = Math.max(0, owed.get(id) ?? 0);
      let over = [...borrowed.values()].reduce((s, l) => s + (l.get(id) ?? 0), 0) - still;
      if (over > 0) {
        const order = [...borrowed.keys()].sort((a, b) => (a === from ? -1 : b === from ? 1 : (borrowed.get(b)?.get(id) ?? 0) - (borrowed.get(a)?.get(id) ?? 0)));
        for (const a of order) {
          if (over <= 0) break;
          over -= sum(take(a, over, id, true));
        }
      }
    }

    // Never more borrowed in an account than it holds: an overdrawn account holds no one's money.
    for (const a of [from, to]) {
      if (!a || !borrowed.has(a)) continue;
      const extra = sum(borrowed.get(a)) - Math.max(0, bal(a));
      if (extra > 0) {
        // Newest first: what came in last is what is not there.
        const l = borrowed.get(a)!;
        let left = extra;
        for (const id of [...l.keys()].reverse()) {
          if (left <= 0) break;
          const v = l.get(id) ?? 0;
          const part = Math.min(v, left);
          if (v - part > 0) l.set(id, v - part);
          else l.delete(id);
          left -= part;
        }
      }
    }
  }

  const byAccount = new Map<string, Centavos>();
  const notOwnByAccount = new Map<string, Centavos>();
  const byLender = new Map<string, Centavos>();
  let inHand = 0;
  let heldForOthers = 0;
  for (const [a, l] of borrowed) {
    if (!ours.has(a)) continue;
    let lentHere = 0;
    for (const [id, v] of l) {
      if (v <= 0) continue;
      byLender.set(id, (byLender.get(id) ?? 0) + v);
      if (heldIds.has(id)) heldForOthers += v;
      else lentHere += v;
    }
    if (lentHere > 0) byAccount.set(a, lentHere);
    if (sum(l) > 0) notOwnByAccount.set(a, sum(l));
    inHand += lentHere;
  }
  let held = 0;
  for (const a of ours) held += bal(a);
  return { inHand, heldForOthers, byAccount, notOwnByAccount, byLender, held, own: Math.max(0, held - inHand - heldForOthers), spent, spentHeld };
}

/** "Maya Credit", or "Maya Credit and Home loan": whose borrowed money it is. */
export function lenderNames(from: ReadonlyMap<string, Centavos>, debts: readonly Debt[]): string {
  const names = [...from.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => debts.find((d) => d.id === id)?.name ?? "a loan");
  const unique = [...new Set(names)];
  return unique.length <= 1 ? (unique[0] ?? "a loan") : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/** The owner's own money in some of the accounts: what they hold less what is borrowed or held there. */
export function ownIn(b: BorrowedMoney, accounts: readonly string[], balanceOf: (account: string) => Centavos): Centavos {
  let own = 0;
  for (const a of new Set(accounts)) own += Math.max(0, balanceOf(a) - (b.notOwnByAccount.get(a) ?? 0));
  return own;
}
