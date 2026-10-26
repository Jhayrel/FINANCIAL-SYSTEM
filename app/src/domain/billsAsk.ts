/**
 * "What bills are due?", "anything to pay this week?", "did I pay Globe this
 * month?", answered by the app from the Budget screen's own list.
 *
 * The owner, 26 October 2026: "fix more the ai capabilities like I want it to
 * do more". "What bills are due?" went to the model, which had the list but
 * not always the dates, and with the model off it got the month's headline
 * instead. The bills of a month are `monthBills` (what the Budget screen and
 * safe to spend set aside), and a bill's last payment is `billStatuses`.
 */
import { billStatuses } from "./bills";
import { monthBills } from "./budgetView";
import { addDays, dayInWords } from "./dates";
import type { Centavos } from "./money";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export interface BillsAsk {
  /** A bill or subscription named ("did I pay Globe"), as the owner's list names it. */
  readonly name: string | null;
  /** Only what falls due within seven days. */
  readonly week: boolean;
}

const DUE =
  /\b(?:what|which|any|anything|are there|is there|list|show)\b[^?.!]*\b(?:bills?|subscriptions?|subs|payments?)\b[^?.!]*\b(?:due|to pay|left|upcoming|coming|pending|unpaid|still|next)\b|\b(?:anything|something|what)\s+(?:else\s+)?(?:to pay|due)\b|\b(?:upcoming|unpaid|pending)\s+(?:bills?|subscriptions?|payments?)\b|\bbills?\s+(?:due|this (?:week|month))\b/i;
const PAID = /\b(?:did|have)\s+i\s+(?:already\s+)?(?:pay|paid)\b|\bis\s+[a-z ]+\s+paid\b|\balready\s+paid\b/i;

/** The question, or null. `names` is every bill and subscription on the owner's lists. */
export function readBillsAsk(text: string, names: readonly string[]): BillsAsk | null {
  const t = text.trim();
  if (!t || /\d/.test(t.replace(/\b20\d{2}\b/g, ""))) return null;
  // Setting or changing a budget is not this question ("set my bills budget").
  if (/\b(?:set|change|budget|limit|lower|raise|move|delete|remove|add)\b/i.test(t)) return null;
  const lower = t.toLowerCase();
  const name =
    [...names]
      .filter((n) => n.trim().length > 2)
      .sort((a, b) => b.length - a.length)
      .find((n) => {
        const full = n.trim().toLowerCase();
        const first = full.split(/\s+/)[0] ?? full;
        return lower.includes(full) || (first.length >= 4 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower));
      }) ?? null;
  if (name && PAID.test(t)) return { name, week: false };
  if (!DUE.test(t)) return null;
  return { name: null, week: /\b(?:this|next)\s+week\b|\bwithin\s+(?:a|the)\s+week\b|\b7\s+days\b/i.test(t) };
}

/** 999 or 85.50, the way it would be typed. */
const typed = (c: Centavos): string => `${Math.floor(c / 100)}${c % 100 ? `.${String(c % 100).padStart(2, "0")}` : ""}`;

export function billsAnswer(
  ask: BillsAsk,
  input: { readonly transactions: readonly Transaction[]; readonly reference: ReferenceLists; readonly asOf: IsoDate },
  money: (c: Centavos) => string,
): string {
  const { transactions, reference, asOf } = input;
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const when = (d: IsoDate | undefined): string => (d ? (d === asOf ? "today" : d === addDays(asOf, 1) ? "tomorrow" : dayInWords(d)) : "");

  if (ask.name) {
    const status = billStatuses(transactions, reference, asOf).find((b) => b.item === ask.name);
    if (!status || status.timesPaid === 0) return `${ask.name} has no payment in your entries yet, so the app has no date or amount for it.`;
    if (status.paidThisMonth) {
      const paidOn = transactions
        .filter((t) => t.type === "Spending" && t.item === ask.name && t.date.startsWith(asOf.slice(0, 7)))
        .map((t) => t.date)
        .sort()
        .at(-1);
      return `Yes: ${ask.name} is paid this month, ${money(status.paidThisMonthAmount)}${paidOn ? ` on ${when(paidOn)}` : ""}.`;
    }
    const late = status.daysToDue !== undefined && status.daysToDue < 0;
    return `Not yet this month. ${ask.name} was last paid ${when(status.lastPaid)}, ${money(status.lastAmount)}, so the next one is ${late ? "late since" : "due about"} ${when(status.nextDue)}${late ? ` (${-(status.daysToDue ?? 0)} days)` : ""}. Say "paid ${ask.name} ${typed(status.lastAmount)}" and the card is ready to add.`;
  }

  const bills = monthBills(transactions, reference, year, month, asOf);
  const open = bills.bills.filter((b) => b.state === "late" || b.state === "soon" || b.state === "due");
  const due = ask.week ? open.filter((b) => b.daysToDue === undefined || b.daysToDue <= 7) : open;
  const paid = bills.bills.filter((b) => b.state === "paid");
  const line = (b: (typeof open)[number]): string =>
    `- ${b.item}: ${money(b.amount)}, ${b.daysToDue !== undefined && b.daysToDue < 0 ? `late since ${when(b.dueOn)}` : `due ${when(b.dueOn)}`}`;

  const out: string[] = [];
  if (due.length === 0) {
    out.push(ask.week ? "Nothing falls due in the next seven days." : "Nothing is left to pay this month.");
  } else {
    out.push(`**Still to pay${ask.week ? " in the next seven days" : " this month"}: ${money(due.reduce((s, b) => s + b.amount, 0))}**`);
    out.push(...due.map(line));
  }
  if (paid.length > 0) {
    out.push(`Paid this month: ${paid.map((b) => `${b.item} ${money(b.amount)}${b.paidOn ? ` (${when(b.paidOn)})` : ""}`).join(", ")}, ${money(paid.reduce((s, b) => s + b.amount, 0))} in all.`);
  }
  if (bills.neverPaid.length > 0) {
    out.push(`${bills.neverPaid.join(", ")} ${bills.neverPaid.length === 1 ? "has" : "have"} no payment in your entries yet, so nothing is set aside for ${bills.neverPaid.length === 1 ? "it" : "them"}.`);
  }
  return out.join("\n");
}
