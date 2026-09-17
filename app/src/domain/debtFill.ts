/**
 * What a debt sentence leaves out, filled from the owner's own debts.
 *
 * ── The sentences this is for ─────────────────────────────────────────────
 *
 * "I paid my credit" and "I paid my loan this month" came back as a debt card
 * with no line and no amount, when there is one credit line and its bill is
 * already worked out on the Debt screen. "I lent 500 to Juan from gcash" came
 * back with a list of credit lines to pick from, none of them Juan.
 *
 *   "I paid my credit"             the one credit line, and what is due on it
 *   "I paid my loan this month"    the one loan, and this month's payment
 *   "Juan paid me back 200"        Juan, when Juan is on the list
 *   "I lent 500 to Juan"           Juan, or an offer to add Juan
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * Pick one of two. A line is chosen only when exactly one fits, and an amount
 * only when the Debt screen itself has a figure due. Anything filled is said
 * in the reply, and the card shows it before anything is saved.
 */

import { debtDue, makeDebtId, positionOf, type Debt, type DebtEffect } from "./debt";
import { withDebtEffect, type Draft } from "./entry";
import { formatMoney } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface DebtFill {
  readonly draft: Draft;
  /** A person the sentence names who is not on the list yet, offered as a button. */
  readonly newPerson?: string | undefined;
  /** What was filled and from where, for the reply. */
  readonly notes: readonly string[];
}

/** Words that sit where a name would and are not one. */
const NOT_A_NAME = new Set([
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his", "she", "her", "they", "them", "their",
  "it", "this", "that", "the", "a", "an", "and", "or", "for", "from", "to", "in", "on", "at", "with", "of", "by",
  "cash", "wallet", "account", "bank", "savings", "saving", "credit", "card", "loan", "debt", "utang", "money",
  "pesos", "peso", "php", "today", "yesterday", "tomorrow", "back", "someone", "somebody", "friend", "last",
  "this", "next", "week", "month", "already", "just", "also", "all", "half", "full", "rest", "interest", "fee",
  "fees", "lent", "lend", "paid", "pay", "borrowed", "borrow", "gave", "sent", "returned", "collected", "owe",
  "owes", "owed", "will", "going", "later", "sa", "ng", "ang", "ko", "kay", "ni", "mga", "po",
]);

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * A person's name in the sentence, as typed.
 *
 * Read from the places a name goes: after "to", "from", "kay" or "ni", as the
 * one doing the paying back ("Juan paid me back"), or after "owe". Wallet and
 * credit line names are not people, so the caller's accounts are excluded.
 */
export function personIn(text: string, accounts: readonly string[]): string | null {
  const taken = new Set(
    accounts.flatMap((a) => a.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length > 1),
  );
  const fits = (raw: string | undefined): string | null => {
    const w = (raw ?? "").toLowerCase();
    if (w.length < 2 || NOT_A_NAME.has(w) || taken.has(w) || /\d/.test(w)) return null;
    return cap(raw ?? "");
  };

  const subject = /^\s*([a-z][a-z'-]*)\s+(?:has\s+|already\s+|just\s+)?(?:paid|gave|returned|sent|owes|borrowed|lent|nagbayad|ibinalik)\b/i.exec(text);
  const bySubject = fits(subject?.[1]);
  if (bySubject) return bySubject;

  const owe = /\bowe\s+([a-z][a-z'-]*)/i.exec(text);
  const byOwe = fits(owe?.[1]);
  if (byOwe) return byOwe;

  for (const m of text.matchAll(/\b(?:to|from|kay|ni|for)\s+(?:my\s+|ate\s+|kuya\s+|tita\s+|tito\s+)?([a-z][a-z'-]*)/gi)) {
    const found = fits(m[1]);
    if (found) {
      // "kuya", "ate", "tita" are how a person is named here, and are kept as the name.
      const title = /\b(?:to|from|kay|ni|for)\s+(ate|kuya|tita|tito)\s+/i.exec(m[0]);
      return title?.[1] ? `${cap(title[1])} ${found}` : found;
    }
  }
  const titled = /\b(kuya|ate|tita|tito|lola|lolo|mama|papa|nanay|tatay|mom|dad|mother|father)\b/i.exec(text);
  return titled?.[1] ? cap(titled[1]) : null;
}

const RECEIVABLE_EFFECTS: readonly DebtEffect[] = ["lend", "collect"];

/**
 * Fill the line and the amount a debt sentence leaves out, where only one
 * answer fits.
 */
export function fillDebt(
  draft: Draft,
  text: string,
  debts: readonly Debt[],
  transactions: readonly Transaction[],
  accounts: readonly string[],
  asOf: IsoDate,
): DebtFill {
  const notes: string[] = [];
  const live = debts.filter((d) => !d.archived);
  let next = draft;
  let newPerson: string | undefined;

  if (!next.debtId) {
    const person = personIn(text, [...accounts, ...live.filter((d) => d.counterpartyType !== "person").map((d) => d.name)]);
    const byName = person
      ? live.find((d) => {
          const name = d.name.trim().toLowerCase();
          const said = person.toLowerCase();
          return name === said || name.split(/[^a-z0-9]+/).includes(said) || said.split(" ").includes(name);
        })
      : undefined;

    if (byName) {
      next = { ...next, debtId: byName.id };
    } else if (person && (next.debtEffect === undefined || RECEIVABLE_EFFECTS.includes(next.debtEffect) || /\b(borrow|borrowed|utang|owe)\b/i.test(text))) {
      newPerson = person;
    } else {
      const receivable = next.debtEffect !== undefined && RECEIVABLE_EFFECTS.includes(next.debtEffect);
      const pool = live.filter((d) => (receivable ? d.kind === "receivable" : d.kind === "payable") && d.form !== "pass-through");
      const saysCredit = /\b(credit|card)\b/i.test(text);
      const saysLoan = /\b(loan|loans|installment|instalment|hulog)\b/i.test(text);
      const narrowed = saysCredit
        ? pool.filter((d) => (d.form ?? "credit-line") === "credit-line")
        : saysLoan
          ? pool.filter((d) => d.form === "term-loan" || d.form === "informal")
          : pool.filter((d) => d.counterpartyType !== "person");
      const only = narrowed.length === 1 ? narrowed[0] : undefined;
      if (only) {
        next = { ...next, debtId: only.id };
        notes.push(`Filed against **${only.name}**, your only ${saysLoan ? "loan" : receivable ? "receivable" : "credit line"}.`);
      }
    }
  }

  // The amount, when a payment was said without one and the Debt screen has a figure due.
  const debt = live.find((d) => d.id === next.debtId);
  if (debt && next.amount === null && (next.debtEffect === "repay" || next.debtEffect === "collect")) {
    const position = positionOf(debt, transactions, asOf);
    const due = debtDue(position, transactions, asOf);
    const whole = /\b(full|fully|all of it|paid off|pay off|whole|everything|settled?)\b/i.test(text);
    const figure = whole ? position.outstanding : due.amountDue;
    if (figure > 0) {
      next = { ...next, amount: figure };
      notes.push(
        whole
          ? `The amount is everything still owed on it, **${formatMoney(figure)}**. Change it if you paid a different figure.`
          : `The amount is what is due on it, **${formatMoney(figure)}**. Change it if you paid a different figure.`,
      );
    }
  }

  // The chosen line decides which way round the effect reads.
  if (debt && next.debtEffect) {
    const flipped =
      debt.kind === "receivable" && (next.debtEffect === "draw" || next.debtEffect === "repay")
        ? next.debtEffect === "draw" ? "lend" : "collect"
        : debt.kind === "payable" && (next.debtEffect === "lend" || next.debtEffect === "collect")
          ? next.debtEffect === "lend" ? "draw" : "repay"
          : null;
    if (flipped) next = withDebtEffect(next, flipped);
  }

  return { draft: next, newPerson, notes };
}

/**
 * A new person, as the Add form makes one, for the button on the card.
 *
 * Lent to or paid back by: they owe you. Borrowed from: you owe them.
 */
export function personDebt(name: string, draft: Draft, debts: readonly Debt[], fallbackWallet: string): Debt {
  const kind: Debt["kind"] =
    draft.debtEffect === "lend" || draft.debtEffect === "collect" ? "receivable" : "payable";
  const base = makeDebtId(name);
  let id = base;
  for (let n = 2; debts.some((d) => d.id === id); n += 1) id = `${base}-${n}`;
  return {
    id,
    name: name.trim(),
    kind,
    form: "informal",
    counterparty: name.trim(),
    counterpartyType: "person",
    openedDate: draft.date,
    wallet: draft.fromWallet || draft.toWallet || fallbackWallet,
    interestType: "none",
    interestRate: 0,
    notes: "",
    archived: false,
  };
}
