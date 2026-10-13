/**
 * Clearing what is left on a debt or On behalf line, in one step.
 *
 * The owner, 13 October 2026: "my father asked me to pay 599 on his Globe
 * Postpaid, then he gave me 600, then I have 1 peso negative, I want to clear
 * it like it's mine." Held, Released, Retained, Advance, Reimbursed and Write
 * off each mean something exact, and picking the one that clears a remainder
 * was left to the owner. This picks it.
 *
 * ── The cases ─────────────────────────────────────────────────────────────
 *
 * They gave back more than they owed, or you gave more than you held: one
 * "Cleared" row on the line brings it to zero. The extra is already in, or
 * already out of, a wallet, so it moves no money and counts as neither
 * income nor spending (owner, 13 October 2026).
 *
 * They still owe a little, and the owner lets it go: written off. Money paid
 * on someone's behalf and written off is spending (spec 5.6.1); an ordinary
 * loan written off is neither.
 *
 * Money still held for someone, and they let the owner keep it: retained,
 * which is income.
 *
 *
 * Nothing is saved here. The caller shows the words and saves on the
 * owner's press, as one change.
 */
import { owedChange, type Debt } from "./debt";
import { formatMoney } from "./money";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export interface Settlement {
  readonly debtId: string;
  /** What the button says: "Keep the PHP 1.00 as yours". */
  readonly action: string;
  /** What happens, in a sentence, before the press. */
  readonly words: string;
  /** A saved row edited, when the remainder sits inside one. */
  readonly update?: Transaction | undefined;
  /** The row added, without its id and record number (the caller gives them). */
  readonly add: Omit<Transaction, "id" | "recordNumber">;
}

const name = (d: Debt): string => d.counterparty.trim() || d.name;

/** The note on a clearing row, which is how it is told apart from a real movement. */
export const CLEARED = "Cleared: no money moved.";

/** A row that only brings a line to zero: no wallet, no income, no spending. Shown as "Cleared". */
export function isClearing(t: Pick<Transaction, "type" | "fromWallet" | "toWallet" | "notes">): boolean {
  return t.type === "Debt" && !t.fromWallet && !t.toWallet && t.notes === CLEARED;
}

export function settleLine(debt: Debt, transactions: readonly Transaction[], reference: Pick<ReferenceLists, "revenueCategories">, asOf: IsoDate): Settlement | null {
  const rows = transactions.filter((t) => t.debtId === debt.id && !(t as Transaction & { deletedAt?: string }).deletedAt);
  const owed = rows.reduce((sum, t) => sum + owedChange(t), 0);
  if (owed === 0) return null;
  const who = name(debt);
  const behalf = debt.form === "pass-through";
  const base = { fee: 0, notes: "Cleared from the line's remainder.", item: "" };
  const income = reference.revenueCategories.find((c) => /random|other|gift|misc/i.test(c)) ?? reference.revenueCategories[0] ?? "Revenue";

  /*
   * Past zero: the extra is already in (or already out of) a wallet, so the
   * clear moves no money and counts as neither income nor spending. One row
   * on the line itself brings it to zero. The first version edited the
   * reimbursement down and added the extra as income into the wallet: the
   * wallets did not move, but a "+PHP 1.00 Revenue into Cash" row read as a
   * peso that was not there, and binning it took a real peso out
   * (owner, 13 October 2026).
   */
  if (owed < 0) {
    const extra = -owed;
    const back = debt.kind === "receivable";
    return {
      debtId: debt.id,
      action: `Clear the ${formatMoney(extra)} extra`,
      words: back
        ? `${who} gave back ${formatMoney(extra)} more than you paid for them. It is already in your wallet, so clearing it moves no money and adds no income: ${who} reads ${formatMoney(0)}.`
        : `You gave ${who} ${formatMoney(extra)} more than you ${behalf ? "held for them" : "owed"}. It already left your wallet, so clearing it moves no money and adds no spending: ${who} reads ${formatMoney(0)}.`,
      add: {
        ...base,
        date: asOf,
        type: "Debt",
        debtId: debt.id,
        debtEffect: back ? "lend" : "draw",
        category: "",
        fromWallet: "",
        toWallet: "",
        description: back ? `Cleared: the ${formatMoney(extra)} extra ${who} gave back` : `Cleared: the ${formatMoney(extra)} more given to ${who}`,
        notes: CLEARED,
        amount: extra,
        total: extra,
        status: "",
      },
    };
  }

  if (debt.kind === "payable" && behalf) {
    return {
      debtId: debt.id,
      action: `Keep the ${formatMoney(owed)} as yours`,
      words: `You still hold ${formatMoney(owed)} of ${who}'s money. If they let you keep it, it is retained: what you hold for them is cleared, and ${formatMoney(owed)} counts as income today.`,
      add: { ...base, date: asOf, type: "Debt", debtId: debt.id, debtEffect: "writeoff", category: "Revenue", item: income, fromWallet: "", toWallet: "", description: `Kept: what was left of ${who}'s money`, amount: owed, total: owed, status: "" },
    };
  }

  if (debt.kind === "receivable") {
    return {
      debtId: debt.id,
      action: `Let the ${formatMoney(owed)} go`,
      words: `${who} still owes you ${formatMoney(owed)}. If you let it go, it is written off: the line is cleared${behalf ? `, and ${formatMoney(owed)} counts as spending today, since you paid it for them` : ", and it counts as neither income nor spending"}.`,
      add: { ...base, date: asOf, type: "Debt", debtId: debt.id, debtEffect: "writeoff", category: behalf ? "Spending" : "", item: "", fromWallet: "", toWallet: "", description: `Written off: what ${who} still owed`, amount: owed, total: owed, status: "" },
    };
  }

  // What you owe a lender is cleared only by paying it, or by the lender forgiving it.
  return {
    debtId: debt.id,
    action: `Mark the ${formatMoney(owed)} forgiven`,
    words: `You still owe ${who} ${formatMoney(owed)}. Only if they forgave it: it is written off, the line is cleared, and it counts as neither income nor spending. If you paid it, record the payment instead.`,
    add: { ...base, date: asOf, type: "Debt", debtId: debt.id, debtEffect: "writeoff", category: "", item: "", fromWallet: "", toWallet: "", description: `Forgiven by ${who}`, amount: owed, total: owed, status: "" },
  };
}

/**
 * "Clear Father", "keep the 1 peso from Father", "Father gave 600 for his
 * 599 bill, I keep the extra": a line named in the chat, to settle. A name
 * alone, or a question about what someone owes, is not this.
 */
const CLEAR =
  /\b(clear|settle|zero|close|keep (?:the|it|that)|keep (?:the )?(?:extra|sukli|change|remainder|rest)|let (?:it|the [\w₱. ]+) go|write (?:it )?off|forgive|forgiven|sa (?:akin|kin) na|akin na lang|kunin ko na)\b/i;

export function readSettleAsk(text: string, debts: readonly Debt[], leftOf?: (debt: Debt) => number): Debt | null {
  const t = text.trim();
  if (!CLEAR.test(t) || /\?\s*$/.test(t)) return null;
  const named = debts
    .filter((d) => !d.archived)
    .map((d) => ({ d, words: [d.counterparty.trim(), d.name.trim()].filter((w) => w.length >= 3) }))
    .filter(({ words }) => words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)))
    .map(({ d }) => d);
  if (named.length <= 1) return named[0] ?? null;
  /*
   * One name, two lines: money paid for Dad and money held for him. The
   * words say which ("he owes", "gave back", "extra"; "holding", "his
   * money"), or else the only one with something left on it.
   */
  const owedWords = /\b(owe|owes|owed|gave (?:me )?back|paid (?:me )?back|extra|advance|paid for)\b/i.test(t);
  const heldWords = /\b(hold|holding|held|his money|her money|their money|keep the rest)\b/i.test(t);
  const bySide = named.filter((d) => (owedWords && !heldWords ? d.kind === "receivable" : heldWords && !owedWords ? d.kind === "payable" : true));
  if (bySide.length === 1) return bySide[0]!;
  const open = leftOf ? bySide.filter((d) => leftOf(d) !== 0) : [];
  return open.length === 1 ? open[0]! : null;
}
