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
}

const ASKS =
  /\b(?:how much|magkano|ilan)\b[^?.!]*\b(?:owe|owes|owed|utang|debt|debts|due|hold(?:ing)?|held)\b|\bwho\s+(?:owes|still owes)\b|\bwhen\b[^?.!]*\b(?:due|pay|bayad)\b|\b(?:do|does|am)\s+(?:i|he|she|they|\w+)\s+(?:still\s+)?(?:owe|in debt)\b|\b(?:my|all my)\s+(?:debts?|utang|loans?)\b|\butang\s+ko\b|\bnext\s+(?:due|payment)\b/i;

/** A debt question, never an entry: no figure, and asked rather than told. */
export function readDebtAsk(said: string, debts: readonly Debt[]): DebtAsk | null {
  const t = said.trim();
  if (!ASKS.test(t) || /\d/.test(t)) return null;
  // "I owe Ana, she lent it to me" tells; a question asks.
  const asked = /\?\s*$/.test(t) || /^\s*(?:how|what|when|who|which|do|does|is|am|magkano|ilan|kailan|sino|may)\b/i.test(t);
  if (!asked) return null;
  const named = [...debts]
    .filter((d) => !d.archived || /\barchived\b/i.test(t))
    .sort((a, b) => b.name.length - a.name.length)
    .find((d) =>
      [d.name.trim(), d.counterparty.trim()]
        .filter((w) => w.length >= 3)
        .some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)),
    );
  return { debt: named ?? null };
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
  if (ask.debt) return describe(lines[0]!);
  if (lines.length === 0) return "There are no debt or On behalf lines yet. The Debt screen adds one.";
  const youOwe = lines.filter((p) => p.debt.form !== "pass-through" && p.debt.kind === "payable").reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const owedYou = lines.filter((p) => p.debt.kind === "receivable").reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const held = lines.filter((p) => p.debt.form === "pass-through" && p.debt.kind === "payable").reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const open = lines.filter((p) => p.outstanding !== 0);
  return [
    `You owe **${money(youOwe)}** in all${owedYou > 0 ? `; owed to you: ${money(owedYou)}` : ""}${held > 0 ? `; held for others: ${money(held)}` : ""}.`,
    ...(open.length > 0 ? open.map(describe) : ["Every line is at PHP 0.00."]),
  ].join(" ");
}
