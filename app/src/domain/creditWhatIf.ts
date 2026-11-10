/**
 * "If I put [an amount] on Maya Credit on November 20, how much will I
 * actually pay back, when, and which month's money pays it?"
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026. The answer said the same amount back
 * on December 6. Every draw on that line had been charged on the day it was
 * made, so what is paid back is more than what is borrowed, and nothing
 * worked that out.
 *
 * So the device does: what is owed now and the limit; the charge, at the
 * rate the line's last draw was charged, said as an estimate because the
 * lender sets it; the day it falls due, from the line's billing and due
 * days (`dueIfBorrowedOn`); which month's money pays it; and what counts as
 * spending (the purchase on its day, the charge on the day it is added,
 * never the repayment), as spec rule 5.6.2 has it since 17 September 2026.
 */
import { dueIfBorrowedOn, positionsOf, type Debt } from "./debt";
import { limitOn } from "./creditLimit";
import { daysInMonth, formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export interface CreditWhatIf {
  readonly debt: Debt;
  readonly amount: Centavos;
  readonly on: IsoDate;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** Supposing, and putting it on the line rather than paying it from a wallet. */
const SUPPOSE = /\b(?:if\s+i|what\s+if|suppose|kung|pag)\b/i;
const ON_CREDIT = /\b(?:put|puts|putting|charge|charged|use|using|borrow|borrowing|draw|swipe|pay\s+(?:it\s+|for\s+it\s+)?(?:with|using|via|through)|gamit(?:in)?|i-?charge|utang)\b/i;

/** The day said ("on November 20", "20 Nov", "today", "tomorrow"), else today. */
function daySaid(text: string, asOf: IsoDate): IsoDate {
  const t = text.toLowerCase();
  const year = Number(asOf.slice(0, 4));
  const at = (m: number, d: number): IsoDate => {
    const y = `${year}-${String(m).padStart(2, "0")}-01` < asOf.slice(0, 8) + "01" ? year + 1 : year;
    return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, "0")}`;
  };
  const md = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  if (md?.[1] && md[2]) return at(MONTHS.findIndex((m) => m.startsWith(md[1]!.slice(0, 3))) + 1, Number(md[2]));
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`).exec(t);
  if (dm?.[1] && dm[2]) return at(MONTHS.findIndex((m) => m.startsWith(dm[2]!.slice(0, 3))) + 1, Number(dm[1]));
  if (/\btomorrow\b|\bbukas\b/.test(t)) {
    const d = new Date(`${asOf}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return asOf;
}

/** The amount said, never a day: the amount in "[amount] ... on November 20", never the 20. */
function amountSaid(text: string): Centavos | null {
  for (const m of text.matchAll(/(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\b(?!\s*(?:st|nd|rd|th)\b)/gi)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0).toLowerCase();
    if (new RegExp(`${MONTH_RE}\\.?\\s*$`).test(before)) continue;
    const whole = Number((m[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(whole) || whole <= 0) continue;
    // A bare one- or two-digit number is a day or a count, not an amount.
    if (whole < 100 && !/₱|php/i.test(m[0])) continue;
    return whole * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  }
  return null;
}

/** Putting an amount on a credit line, supposed: the line, the amount, the day. */
export function readCreditWhatIf(text: string, debts: readonly Debt[], asOf: IsoDate): CreditWhatIf | null {
  if (!SUPPOSE.test(text) || !ON_CREDIT.test(text)) return null;
  const lines = debts.filter((d) => !d.archived && d.kind === "payable" && d.form !== "pass-through" && d.billingDay !== undefined);
  const debt =
    [...lines]
      .sort((a, b) => b.name.length - a.name.length)
      .find((d) => [d.name, d.counterparty].map((w) => w.trim()).filter((w) => w.length >= 4).some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text) && (w !== d.counterparty.trim() || /\bcredit\b/i.test(text)))) ?? null;
  if (!debt) return null;
  const amount = amountSaid(text);
  if (amount === null) return null;
  return { debt, amount, on: daySaid(text, asOf) };
}

export interface CreditOutcome {
  readonly ask: CreditWhatIf;
  readonly owedNow: Centavos;
  readonly limit: Centavos | null;
  /** The line's last draw and the charge it was given, the rate this one is estimated at. */
  readonly lastPair: { readonly on: IsoDate; readonly draw: Centavos; readonly charge: Centavos } | null;
  readonly charge: Centavos;
  readonly repay: Centavos;
  readonly due: IsoDate | null;
}

export function creditWhatIf(ask: CreditWhatIf, transactions: readonly Transaction[], asOf: IsoDate): CreditOutcome {
  const { debt } = ask;
  const owedNow = Math.max(0, positionsOf([debt], transactions, asOf)[0]?.outstanding ?? 0);
  const limit = limitOn(debt, ask.on) ?? debt.creditLimit ?? null;
  const mine = transactions.filter((t) => t.debtId === debt.id && t.date <= asOf);
  const charges = mine.filter((t) => t.debtEffect === "charge").sort((a, b) => b.date.localeCompare(a.date));
  let lastPair: CreditOutcome["lastPair"] = null;
  for (const c of charges) {
    const draw = mine.filter((t) => t.debtEffect === "draw" && t.date === c.date).reduce((s, t) => s + t.amount, 0);
    if (draw > 0) {
      lastPair = { on: c.date, draw, charge: c.total };
      break;
    }
  }
  const charge = lastPair ? Math.round((ask.amount * lastPair.charge) / lastPair.draw) : 0;
  return { ask, owedNow, limit, lastPair, charge, repay: ask.amount + charge, due: dueIfBorrowedOn(debt, ask.on) };
}

const MONTH_NAMES = MONTHS.map((m) => m.charAt(0).toUpperCase() + m.slice(1));
const monthName = (d: IsoDate): string => `${MONTH_NAMES[Number(d.slice(5, 7)) - 1] ?? ""} ${d.slice(0, 4)}`;

export function creditWhatIfWords(o: CreditOutcome): string {
  const { ask, owedNow, limit, lastPair, charge, repay, due } = o;
  const name = ask.debt.name;
  const percent = lastPair ? `${((lastPair.charge * 10000) / lastPair.draw / 100).toFixed(2)}%` : "";
  const head = due
    ? `**If ${formatMoney(ask.amount)} goes on ${name} on ${formatMedium(ask.on)}, you pay back about ${formatMoney(repay + owedNow)}, due ${formatMedium(due)}: ${monthName(due)}'s money pays it.**`
    : `**If ${formatMoney(ask.amount)} goes on ${name} on ${formatMedium(ask.on)}, you pay back about ${formatMoney(repay + owedNow)}.** No billing day is set for ${name}, so its due day cannot be worked out: set it on the Debt screen.`;
  const lines = [
    head,
    owedNow > 0 ? `- You owe ${name} ${formatMoney(owedNow)} already, and that is in the same bill.` : `- You owe ${name} nothing now.`,
    limit !== null
      ? owedNow + repay <= limit
        ? `- Its limit is ${formatMoney(limit)}, so ${formatMoney(limit - owedNow - repay)} of it stays free after this.`
        : `- Its limit is ${formatMoney(limit)}: this would go ${formatMoney(owedNow + repay - limit)} over it, so the lender may refuse it.`
      : "",
    lastPair
      ? `- The charge: your last draw, ${formatMoney(lastPair.draw)} on ${formatMedium(lastPair.on)}, was charged ${formatMoney(lastPair.charge)} (${percent}), so ${formatMoney(ask.amount)} would be charged about ${formatMoney(charge)}. The lender sets the real figure.`
      : `- No charge has been recorded on ${name} before, so none is counted here; if the lender adds one, it is paid back too.`,
    `- What counts as spending: the ${formatMoney(ask.amount)} is ${monthName(ask.on)}'s spending, on ${formatMedium(ask.on)}${charge > 0 ? `, and the ${formatMoney(charge)} charge is spending the day it is added` : ""}. Paying it back${due ? ` in ${monthName(due)}` : ""} moves money to the lender; it is not spending again.`,
    due ? `- ${monthName(due)} then has ${formatMoney(repay + owedNow)} to pay out on ${formatMedium(due)}, before anything else that month.` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
