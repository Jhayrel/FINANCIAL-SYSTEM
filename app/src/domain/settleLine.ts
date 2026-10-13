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
 * They gave back more than they owed (owes you below zero): the latest
 * reimbursement is edited down by the extra, and the extra is added as
 * income into the same wallet. The wallet does not move; the line reads
 * zero; the peso counts as theirs given to you.
 *
 * They still owe a little, and the owner lets it go: written off. Money paid
 * on someone's behalf and written off is spending (spec 5.6.1); an ordinary
 * loan written off is neither.
 *
 * Money still held for someone, and they let the owner keep it: retained,
 * which is income.
 *
 * More given back than was held (you hold below zero): the latest hand-over
 * is edited down by the extra, and the extra is added as money sent to them,
 * which is spending. The wallet does not move.
 *
 * Nothing is saved here. The caller shows the words and saves on the
 * owner's press, as one change.
 */
import { owedChange, type Debt } from "./debt";
import { formatMoney, type Centavos } from "./money";
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
const number = (t: Transaction): string => `#${String(t.recordNumber).padStart(4, "0")}`;

export function settleLine(debt: Debt, transactions: readonly Transaction[], reference: Pick<ReferenceLists, "revenueCategories">, asOf: IsoDate): Settlement | null {
  const rows = transactions.filter((t) => t.debtId === debt.id && !(t as Transaction & { deletedAt?: string }).deletedAt);
  const owed = rows.reduce((sum, t) => sum + owedChange(t), 0);
  if (owed === 0) return null;
  const who = name(debt);
  const behalf = debt.form === "pass-through";
  const base = { fee: 0, notes: "Cleared from the line's remainder.", item: "" };
  const latest = (effect: string, at: Centavos): Transaction | undefined =>
    [...rows].filter((t) => t.debtEffect === effect && t.amount > at).sort((a, b) => b.date.localeCompare(a.date) || b.recordNumber - a.recordNumber)[0];
  const income = reference.revenueCategories.find((c) => /random|other|gift|misc/i.test(c)) ?? reference.revenueCategories[0] ?? "Revenue";

  if (debt.kind === "receivable" && owed < 0) {
    const extra = -owed;
    const back = latest("collect", extra);
    if (!back) return null;
    return {
      debtId: debt.id,
      action: `Keep the ${formatMoney(extra)} as yours`,
      words: `${who} gave back ${formatMoney(extra)} more than you paid for them. Keep it as yours: ${number(back)} becomes ${formatMoney(back.amount - extra)}, and ${formatMoney(extra)} is added as income in ${back.toWallet || "the same wallet"}. Your wallets do not move, and ${who} reads ${formatMoney(0)}.`,
      update: { ...back, amount: back.amount - extra, total: back.amount - extra + back.fee },
      add: {
        ...base,
        date: back.date,
        type: "Revenue",
        category: "Revenue",
        item: income,
        fromWallet: "",
        toWallet: back.toWallet,
        description: `The ${formatMoney(extra)} extra ${who} gave back, kept`,
        amount: extra,
        total: extra,
        status: "Received",
      },
    };
  }

  if (debt.kind === "payable" && owed < 0) {
    const extra = -owed;
    const out = latest("repay", extra);
    if (!out) return null;
    return {
      debtId: debt.id,
      action: `Count the ${formatMoney(extra)} as given`,
      words: `You gave ${who} ${formatMoney(extra)} more than you ${behalf ? "held for them" : "owed"}. Count it as money given to them: ${number(out)} becomes ${formatMoney(out.amount - extra)}, and ${formatMoney(extra)} is added as money sent, which is spending. Your wallets do not move.`,
      update: { ...out, amount: out.amount - extra, total: out.amount - extra + out.fee },
      add: {
        ...base,
        date: out.date,
        type: "Transfer",
        category: "Transfer",
        fromWallet: out.fromWallet,
        toWallet: "",
        description: `The ${formatMoney(extra)} more given to ${who}`,
        amount: extra,
        total: extra,
        status: "Transferred",
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

export function readSettleAsk(text: string, debts: readonly Debt[]): Debt | null {
  const t = text.trim();
  if (!CLEAR.test(t) || /\?\s*$/.test(t)) return null;
  const named = debts
    .filter((d) => !d.archived)
    .map((d) => ({ d, words: [d.counterparty.trim(), d.name.trim()].filter((w) => w.length >= 3) }))
    .filter(({ words }) => words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)));
  return named.length === 1 ? named[0]!.d : null;
}
