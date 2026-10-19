/**
 * "I expect 10k salary next month, but it comes on the 7th. Will I have money
 * the first week, should I loan? My loan is paid on the 6th": the money from
 * today to the day before the income arrives, worked out by the app.
 *
 * 19 October 2026: the model said "you have no cash on hand before the 7th"
 * beside wallets holding PHP 1,991.46, said a loan payment was due on the 6th
 * with nothing owed, then told the owner to cover the first week "using the
 * salary arriving on November 7". Today's safe to spend spreads the money to
 * the month's end only, so it never answered this; this does.
 */
import { budgetAdvice } from "./budgetAdvice";
import { monthBills } from "./budgetView";
import { debtDue, dueIfBorrowedOn, positionsOf, type Debt } from "./debt";
import { addDays, daysBetween, daysInMonth, formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { totalWalletBalance } from "./balances";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export interface BridgeAsk {
  /** The first money expected, and the day it arrives. */
  readonly arrives: IsoDate;
  readonly what: string;
  /** Any later money named: "allowance on the 15th". */
  readonly later: readonly { readonly what: string; readonly on: IsoDate }[];
  /** "should I loan", "borrow". */
  readonly asksLoan: boolean;
  /** The words asked, for the things they name. */
  readonly said?: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const INCOME = /\b(salary|sahod|sweldo|allowance|income|payday|pay day|padala|remittance|payout|pay)\b/i;
const WORRY =
  /\b(first week|until|before|worried|worry|no money|wala(?:ng)? pera|loan|borrow|utang|enough|cover|survive|tide|kulang|hanggang|bridge|last me|make it|short)\b/i;

/** The day an income word is tied to: "salary ... on the 7th", "allowance on the 15th of November". */
function daysNamed(text: string, asOf: IsoDate): { what: string; on: IsoDate }[] {
  const lower = text.toLowerCase();
  const out: { what: string; on: IsoDate }[] = [];
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const nextMonth = /\bnext month\b|\bsusunod na buwan\b/.test(lower);
  for (const m of lower.matchAll(new RegExp(INCOME.source, "gi"))) {
    const at = m.index ?? 0;
    const near = lower.slice(at, at + 90);
    const day = /\b(?:on\s+(?:the\s+)?|in\s+(?:the\s+)?|sa\s+)?(\d{1,2})(?:st|nd|rd|th)?\b(?:\s+day)?/.exec(near.slice(m[0].length));
    if (!day?.[1]) continue;
    const d = Number(day[1]);
    if (d < 1 || d > 31) continue;
    const named = new RegExp(String.raw`\b(${MONTHS.join("|")})[a-z]*\b`).exec(near);
    let y = year;
    let mo = named?.[1] ? MONTHS.indexOf(named[1]) + 1 : nextMonth ? month + 1 : d > Number(asOf.slice(8, 10)) ? month : month + 1;
    if (mo > 12) {
      mo -= 12;
      y += 1;
    }
    if (named?.[1] && mo < month) y += 1;
    const on = `${y}-${String(mo).padStart(2, "0")}-${String(Math.min(d, daysInMonth(y, mo))).padStart(2, "0")}`;
    if (on > asOf) out.push({ what: m[1]!.toLowerCase() === "pay" ? "pay" : m[1]!.toLowerCase(), on });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on));
}

export function readBridgeAsk(said: string, asOf: IsoDate): BridgeAsk | null {
  const t = said.trim();
  if (!INCOME.test(t) || !WORRY.test(t)) return null;
  // A record of money that came, not money expected.
  if (/\b(?:i\s+)?(?:received|got|natanggap)\b/i.test(t) && !/\b(?:expect|will|arriv|darating|coming|next)\b/i.test(t)) return null;
  const days = daysNamed(t, asOf);
  if (days.length === 0) return null;
  const [first, ...rest] = days;
  return { arrives: first!.on, what: first!.what, later: rest, asksLoan: /\b(loan|borrow|utang|mangutang|credit)\b/i.test(t), said: t };
}

export interface BridgeInput {
  readonly transactions: readonly Transaction[];
  readonly reference: ReferenceLists;
  readonly debts: readonly Debt[];
  readonly stopped?: readonly { readonly name: string; readonly since: IsoDate }[];
  readonly asOf: IsoDate;
}

export function bridgeAnswer(ask: BridgeAsk, input: BridgeInput): string {
  const { transactions, reference, debts, asOf } = input;
  const money = (c: Centavos): string => formatMoney(c).replace(/^([−-]?)₱/, "$1PHP ");
  const lastDay = addDays(ask.arrives, -1);
  const days = daysBetween(asOf, ask.arrives);
  if (days <= 0) return `The ${ask.what} is due today or already here, so there is nothing to bridge.`;
  const wallets = totalWalletBalance(transactions, reference.wallets);

  // Bills and subscriptions due before the money arrives, this month's still open and the next ones'.
  const due: { name: string; amount: Centavos; on: IsoDate }[] = [];
  const sameDay: { name: string; amount: Centavos }[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < 3; k += 1) {
    const at = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
    at.setUTCMonth(at.getUTCMonth() + k);
    const y = at.getUTCFullYear();
    const m = at.getUTCMonth() + 1;
    if (`${y}-${String(m).padStart(2, "0")}-01` > lastDay && k > 0) break;
    for (const b of monthBills(transactions, reference, y, m, asOf).bills) {
      if (b.state === "paid" || !b.dueOn || seen.has(`${b.item}|${b.dueOn}`)) continue;
      seen.add(`${b.item}|${b.dueOn}`);
      const on = b.dueOn < asOf ? asOf : b.dueOn;
      if (on <= lastDay) due.push({ name: b.item, amount: b.amount, on: b.dueOn });
      else if (on === ask.arrives) sameDay.push({ name: b.item, amount: b.amount });
    }
  }
  // Debt payments due before it.
  for (const p of positionsOf(debts.filter((d) => !d.archived && d.form !== "pass-through" && d.kind === "payable"), transactions, asOf)) {
    const d = debtDue(p, transactions, asOf);
    if (d.nextDue && d.nextDue <= lastDay && d.amountDue > 0) due.push({ name: p.debt.name, amount: d.amountDue, on: d.nextDue });
  }
  due.sort((a, b) => a.on.localeCompare(b.on));
  const dueTotal = due.reduce((s, d) => s + d.amount, 0);
  const free = Math.max(0, wallets - dueTotal);
  const perDay = Math.floor(free / days);

  // A usual day, from the usual month the budget recommendation reads.
  const y = Number(ask.arrives.slice(0, 4));
  const m = Number(ask.arrives.slice(5, 7));
  const usual = budgetAdvice({ transactions, year: y, month: m, asOf, stopped: input.stopped ?? [], debts, spendingTypes: reference.spendingTypes });
  const usualDay = Math.floor(usual.spending / daysInMonth(y, m));
  // The everyday things: the ones the message names first ("gas and other stuff"), then food and getting around.
  const asked = (ask.said ?? "").toLowerCase();
  const daily = usual.items.filter((l) => !(usual.wants ?? []).includes(l.name));
  const picked = [
    ...daily.filter((l) => asked.includes(l.name.toLowerCase())),
    ...daily.filter((l) => /food|gas|fare|transport|grocer|rice|load|commute/i.test(l.name)),
  ].filter((l, i, all) => all.findIndex((x) => x.name === l.name) === i);
  const essentials = picked.slice(0, 3).map((l) => `${l.name} about ${money(Math.round((l.amount * days) / daysInMonth(y, m)))}`);

  const out: string[] = [];
  out.push(
    `**From today to ${formatMedium(lastDay)}, the day before your ${ask.what} on ${formatMedium(ask.arrives)}: ${days} ${days === 1 ? "day" : "days"}.** Your spending wallets hold ${money(wallets)}.`,
  );
  out.push(
    due.length > 0
      ? `Due before then: ${due.map((d) => `${d.name} ${money(d.amount)} (${formatMedium(d.on)})`).join(", ")}, ${money(dueTotal)} in all. That leaves **${money(free)}, ${money(perDay)} a day** until the ${ask.what} comes.`
      : `Nothing falls due before then, so **${money(free)}, ${money(perDay)} a day**, has to last until the ${ask.what} comes.`,
  );
  if (sameDay.length > 0) out.push(`${sameDay.map((d) => `${d.name} ${money(d.amount)}`).join(" and ")} ${sameDay.length === 1 ? "is" : "are"} due on ${formatMedium(ask.arrives)} itself, the day the money comes: pay ${sameDay.length === 1 ? "it" : "them"} from it.`);
  out.push(
    `Today's safe to spend spreads your money to the end of this month only; keeping to it leaves nothing for the days after. To reach ${formatMedium(ask.arrives)}, spend ${money(perDay)} a day from today instead.`,
  );
  if (usualDay > 0) {
    out.push(
      perDay >= usualDay
        ? `That is at or above a usual ${money(usualDay)} a day, so the money lasts without a loan.`
        : `A usual day is about ${money(usualDay)}, so these days have to be lighter than usual${essentials.length > 0 ? `. Over ${days} days your usual ${essentials.join(", ")}` : ""}. ${perDay * 2 >= usualDay ? "Kept to those, it lasts without a loan." : `${money(perDay)} a day covers less than half of a usual day: only the essentials fit.`}`,
    );
  }
  if (ask.asksLoan) {
    const lines = debts.filter((d) => !d.archived && d.form !== "pass-through" && d.kind === "payable");
    const said = lines
      .map((d) => {
        const owed = positionsOf([d], transactions, asOf)[0]?.outstanding ?? 0;
        const dueFirst = dueIfBorrowedOn(d, asOf);
        const dueLast = dueIfBorrowedOn(d, lastDay);
        if (!dueFirst || !dueLast) return "";
        const now = owed > 0 ? `You owe ${d.name} ${money(owed)} now.` : `You owe ${d.name} nothing now, so nothing is due on its next due day.`;
        const when =
          dueFirst === dueLast
            ? `Borrowed from it between today and ${formatMedium(lastDay)}, it is due ${formatMedium(dueFirst)}`
            : `Borrowed from it now it is due ${formatMedium(dueFirst)}; borrowed on ${formatMedium(lastDay)}, ${formatMedium(dueLast)}`;
        const after = dueFirst >= ask.arrives ? `, after the ${ask.what} arrives` : `, before the ${ask.what} arrives`;
        return `${now} ${when}${after}, and its fees cost extra.`;
      })
      .filter(Boolean);
    out.push(
      said.length > 0
        ? `${perDay * 2 >= usualDay ? "A loan is not needed if you keep to that. " : ""}If you do borrow: ${said.join(" ")}`
        : `${perDay * 2 >= usualDay ? "A loan is not needed if you keep to that." : "If you borrow, check when its first payment falls: before or after the money arrives."}`,
    );
  }
  if (ask.later.length > 0) out.push(`Then ${ask.later.map((l) => `the ${l.what} on ${formatMedium(l.on)}`).join(" and ")}.`);
  return out.join(" ");
}
