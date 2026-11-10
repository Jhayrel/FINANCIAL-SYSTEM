/**
 * "How much do I owe?", "When is my Maya Credit due?", "How much does Father
 * owe me?": worked out by the app from the lines themselves, as safe to
 * spend is. All three fell to the month's summary when the model was away
 * (19 October 2026 audit), and with it they were left to the model's sums.
 */
import { debtDue, positionsOf, type Debt } from "./debt";
import { formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface DebtAsk {
  /** The line named, or null for all of them. */
  readonly debt: Debt | null;
  /** The words asked, for what to lead with. */
  readonly said?: string;
}

const ASKS =
  /\b(?:how much|magkano|ilan)\b[^?.!]*\b(?:owe|owes|owed|utang|debt|debts|due|hold(?:ing)?|held)\b|\bwho\s+(?:owes|still owes)\b|\bwhen\b[^?.!]*\b(?:due|pay|bayad)\b|\b(?:do|does|am)\s+(?:i|he|she|they|\w+)\s+(?:still\s+)?(?:owe|in debt)\b|\b(?:my|all my)\s+(?:debts?|utang|loans?)\b|\butang\s+ko\b|\bnext\s+(?:due|payment)\b/i;

/** A debt question, never an entry: no figure, and asked rather than told. */
// "What's my balance on Maya Credit?": a debt's balance, only when a debt is named (27 October 2026 sweep).
const BALANCE_ON = /\b(?:balance|outstanding|natitira)\b[^?.!]{0,12}\b(?:on|of|for|sa|ng)\b|\b(?:how\s+much\s+is\s+left|what'?s\s+left)\s+(?:on|of|to\s+pay\s+on)\b/i;

const HAS_LOAN = /\b(?:i\s+have|i've\s+got|i\s+got|i\s+still\s+have|may)\s+(?:a\s+|an\s+|some\s+|pa\s*(?:ng|akong)?\s+|akong\s+)?(?:loans?|debts?|utang|balance|credit)\s+(?:(?:ako|ko|pa)\s+)?(?:in|on|with|from|at|to|sa)\b/i;

export function readDebtAsk(said: string, debts: readonly Debt[]): DebtAsk | null {
  const t = said.trim();
  const byBalance = !ASKS.test(t) && BALANCE_ON.test(t);
  /*
   * "pay off my maya credit", with no figure and no later day: what is owed
   * on it, so the payment can be said or nothing is due. It got the month's
   * summary when Maya Credit was paid off (3 November 2026 replay). A later
   * day ("next month") is a plan, read elsewhere.
   */
  const payOff = /^\s*(?:please\s+|pls\s+)?(?:pay\s+off|settle)\s+(?:my\s+|the\s+)?/i.test(t) && !/\b(?:next|tomorrow|later|on|by|in|before|until|plan|will)\b/i.test(t);
  if ((!ASKS.test(t) && !byBalance && !HAS_LOAN.test(t) && !payOff) || /\d/.test(t)) return null;
  // "I owe Ana, she lent it to me" tells; a question asks.
  const asked = /\?\s*$/.test(t) || /^\s*(?:how|what|when|who|which|do|does|is|am|magkano|ilan|kailan|sino|may)\b/i.test(t);
  /*
   * "I have loan in maya credit", with no figure: told, but nothing to add,
   * and what it holds is what they want to see (owner's chat, 1 November
   * 2026: it got the month's summary). Only with a line named.
   */
  const hasOne = HAS_LOAN.test(t);
  if (!asked && !hasOne && !payOff) return null;
  const named = [...debts]
    .filter((d) => !d.archived || /\barchived\b/i.test(t))
    .sort((a, b) => b.name.length - a.name.length)
    .find((d) =>
      [d.name.trim(), d.counterparty.trim()]
        .filter((w) => w.length >= 3)
        .some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)),
    );
  if ((byBalance || (hasOne && !asked) || payOff) && !named) return null;
  return { debt: named ?? null, said: t };
}

export function debtAnswer(ask: DebtAsk, debts: readonly Debt[], transactions: readonly Transaction[], asOf: IsoDate): string {
  const money = (c: Centavos): string => formatMoney(c).replace(/^([−-]?)₱/, "$1PHP ");
  const lines = positionsOf(ask.debt ? [ask.debt] : debts.filter((d) => !d.archived), transactions, asOf);
  const who = (d: Debt): string => d.counterparty.trim() || d.name;
  const describe = (p: (typeof lines)[number]): string => {
    const d = p.debt;
    const owed = p.outstanding;
    if (d.form === "pass-through") {
      if (owed === 0) return `${who(d)}: nothing open, settled.`;
      if (d.kind === "receivable") return owed > 0 ? `${who(d)} owes you ${money(owed)} for what you paid for them.` : `${who(d)} gave you ${money(-owed)} more than you paid for them.`;
      return owed > 0 ? `You hold ${money(owed)} of ${who(d)}'s money, theirs to pass on.` : `You passed on ${money(-owed)} more than you held for ${who(d)}.`;
    }
    if (d.kind === "receivable") return owed > 0 ? `${who(d)} owes you ${money(owed)}.` : `${who(d)} owes you nothing.`;
    if (owed <= 0) return `${d.name}: you owe nothing, paid off.`;
    const due = debtDue(p, transactions, asOf);
    const when =
      due.nextDue && due.daysToDue !== undefined
        ? due.daysToDue < 0
          ? ` ${money(due.amountDue)} was due ${formatMedium(due.nextDue)}, ${-due.daysToDue} ${due.daysToDue === -1 ? "day" : "days"} late.`
          : due.daysToDue === 0
            ? ` ${money(due.amountDue)} is due today.`
            : ` Next due ${formatMedium(due.nextDue)}, in ${due.daysToDue} ${due.daysToDue === 1 ? "day" : "days"}: ${money(due.amountDue)}.`
        : " No due date is set for it.";
    const charged = p.charged > 0 ? ` That includes ${money(p.charged)} of fees and interest the lender added.` : "";
    return `You owe ${d.name} ${money(owed)}.${when}${charged}`;
  };
  /*
   * Money paid or held on someone's behalf, this year, movement by movement,
   * when that line is the one asked about. "How much of my own money went to
   * Globe Postpaid this year, and does my father still owe me anything?" was
   * handed "Father: nothing open, settled." alone, and the answer called
   * two of the payments the owner's own money, taking them for never paid
   * back, though he had paid back every one (10 November 2026).
   */
  const movements = (d: Debt): string => {
    if (d.form !== "pass-through") return "";
    const year = asOf.slice(0, 4);
    const rows = transactions.filter((t) => t.debtId === d.id && t.date.slice(0, 4) === year && t.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length === 0) return "";
    const out = rows.filter((t) => t.debtEffect === "lend" || t.debtEffect === "draw");
    const back = rows.filter((t) => t.debtEffect === "collect" || t.debtEffect === "repay");
    const sum = (rs: readonly Transaction[]): Centavos => rs.reduce((s, t) => s + t.total, 0);
    const list = (rs: readonly Transaction[]): string => (rs.length > 0 ? ` (${rs.map((t) => `${money(t.total)} on ${formatMedium(t.date)}`).join(", ")})` : "");
    const gone = sum(out) - sum(back);
    const notes = d.notes.trim() ? ` What the line is for: ${d.notes.trim()}` : "";
    return d.kind === "receivable"
      ? ` In ${year} you paid ${money(sum(out))} for ${who(d)}${list(out)}, and ${who(d)} gave back ${money(sum(back))}${list(back)}. ${gone <= 0 ? "So none of it was your own money in the end: everything you paid for them came back." : `So ${money(gone)} of your own money is still out, theirs to give back.`}${notes}`
      : ` In ${year} you received ${money(sum(out))} for ${who(d)}${list(out)}, and passed on ${money(sum(back))}${list(back)}.${notes}`;
  };
  if (ask.debt) return `${describe(lines[0]!)}${movements(ask.debt)}`;
  if (lines.length === 0) return "There are no debt or On behalf lines yet. The Debt screen adds one.";
  const youOwe = lines.filter((p) => p.debt.form !== "pass-through" && p.debt.kind === "payable").reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const owedYou = lines.filter((p) => p.debt.kind === "receivable").reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const held = lines.filter((p) => p.debt.form === "pass-through" && p.debt.kind === "payable").reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const open = lines.filter((p) => p.outstanding !== 0);
  // Led by what was asked: "how much do I hold for others" was answered "You owe PHP 0.00".
  const lead = /\b(?:hold|holding|held)\b/i.test(ask.said ?? "")
    ? `You hold **${money(held)}** for others${youOwe > 0 ? `; you owe ${money(youOwe)}` : ""}${owedYou > 0 ? `; owed to you: ${money(owedYou)}` : ""}.`
    : /\bowes?\s+me\b|\bowed\s+to\s+me\b|\bwho\s+owes\b/i.test(ask.said ?? "")
      ? `Owed to you: **${money(owedYou)}**${youOwe > 0 ? `; you owe ${money(youOwe)}` : ""}${held > 0 ? `; held for others: ${money(held)}` : ""}.`
      : `You owe **${money(youOwe)}** in all${owedYou > 0 ? `; owed to you: ${money(owedYou)}` : ""}${held > 0 ? `; held for others: ${money(held)}` : ""}.`;
  return [
    lead,
    ...(open.length > 0 ? open.map(describe) : ["Every debt is at PHP 0.00."]),
  ].join(" ");
}
