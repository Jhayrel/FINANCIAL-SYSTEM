/**
 * "Set my Maya Credit limit to 15000", "my Maya Credit is due on the 5th",
 * "the billing day is the 6th": a line's details, changed from the chat the
 * way the Debt screen's Details form changes them.
 *
 * The owner, 26 October 2026: "make sure ai can do it all like everything".
 * These were the Debt screen's and nobody else's, and worse than missing:
 * "set my maya credit limit to 15000" offered to set October's budget to
 * PHP 15,000.00, and "change my maya credit billing day to 6" offered to
 * change a PHP 0.10 interest entry to PHP 6.00. A line's limit, due day and
 * billing day are read here first, so neither reader sees them.
 *
 * The interest rate is not on the Debt screen: it is set with the line, in
 * Settings, which stays the owner's (17 September 2026). Asked here, it is
 * said so, with the tab to open.
 */
import { formatMedium } from "./dates";
import { ordinalDay } from "./debtWords";
import { creditRoom, limitSteps, roomWords, takesLimit, withLimit } from "./creditLimit";
import type { Debt } from "./debt";
import { formatMoney, parseAmount, type Centavos } from "./money";
import type { IsoDate, Transaction } from "./types";

export type DebtDetail = "limit" | "dueDay" | "billingDay" | "rate";

export interface DebtDetailAsk {
  readonly debtId: string;
  readonly detail: DebtDetail;
  /** Centavos for a limit, a day of the month for the two days, basis points for a rate. */
  readonly value: number;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The line a sentence names, by its name or who it is with; the only open credit line when "my credit" names none. */
export function debtNamed(text: string, debts: readonly Debt[]): Debt | null {
  const lower = text.toLowerCase();
  const open = debts.filter((d) => !d.archived);
  const named = [...open]
    .flatMap((d) => [d.name, d.counterparty].filter((n) => n && n.trim().length > 2).map((n) => ({ d, n: n.trim().toLowerCase() })))
    .sort((a, b) => b.n.length - a.n.length)
    .find(({ n }) => new RegExp(`\\b${esc(n)}\\b`).test(lower));
  if (named) return named.d;
  const lines = open.filter(takesLimit);
  return lines.length === 1 && /\b(?:my\s+)?credit(?:\s+line|\s+card)?\b/i.test(text) ? (lines[0] ?? null) : null;
}

/** A day of the month said: "the 5th", "5", "every 6th", "day 6". */
function dayIn(text: string): number | null {
  const m = /\b(?:the\s+|day\s+|every\s+)?(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:k|%|percent|pesos?|php|months?|days?))/i.exec(text);
  const n = m?.[1] ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

/** A sum said: "15000", "15k", "PHP 15,000". */
function sumIn(text: string): Centavos | null {
  const m = /(?:₱|php\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\b(?!\s*(?:%|percent|st|nd|rd|th))/i.exec(text);
  if (!m?.[1]) return null;
  const base = parseAmount(m[1]);
  if (base === null || base <= 0) return null;
  return m[2] ? base * 1000 : base;
}

/**
 * What detail of which line a sentence sets, or null. It sets one only when
 * it gives the new value: "when is my Maya Credit due?" is a question, and
 * the debt reader answers it.
 */
export function readDebtDetailAsk(text: string, debts: readonly Debt[]): DebtDetailAsk | null {
  const t = text.trim();
  if (!/\d/.test(t) || t.split(/\s+/).length > 22) return null;
  // Money that moved is an entry: "paid my maya credit 500", "borrowed 1000".
  if (/\b(?:paid|pay|borrow\w*|lent|lend|repaid|sent|spent|bought|received|got)\b/i.test(t) && !/\b(?:pay\s+by|payment\s+(?:is\s+)?due|due)\b/i.test(t)) return null;
  const debt = debtNamed(t, debts);
  if (!debt) return null;
  const rest = t.replace(new RegExp(esc(debt.name), "ig"), " ");

  if (/\b(?:credit\s+)?limit\b/i.test(t)) {
    const value = sumIn(rest);
    return value === null ? null : { debtId: debt.id, detail: "limit", value };
  }
  if (/\b(?:billing\s+(?:day|date|cycle)|bill(?:ing)?\s+(?:closes|close|cut-?off)|statement\s+(?:day|date)|cut-?off(?:\s+(?:day|date))?|closing\s+(?:day|date))\b/i.test(t)) {
    const value = dayIn(rest);
    return value === null ? null : { debtId: debt.id, detail: "billingDay", value };
  }
  if (/\b(?:due(?:\s+(?:day|date|on|every))?|payment\s+(?:day|date)|pay\s+by|deadline)\b/i.test(t)) {
    const value = dayIn(rest);
    return value === null ? null : { debtId: debt.id, detail: "dueDay", value };
  }
  if (/\binterest(?:\s+rate)?\b|\brate\b/i.test(t) && /%|percent/i.test(t)) {
    const m = /(\d+(?:\.\d{1,2})?)\s*(?:%|percent)/i.exec(rest);
    return m?.[1] ? { debtId: debt.id, detail: "rate", value: Math.round(Number(m[1]) * 100) } : null;
  }
  return null;
}

export interface DebtDetailChange {
  readonly debt: Debt;
  readonly next: Debt;
  /** What the card shows: the detail, as it is and as it would be. */
  readonly label: string;
  readonly now: string;
  readonly then: string;
  /** One sentence above the card. */
  readonly words: string;
}

const dayWords = (day: number | undefined): string => (day ? `the ${ordinalDay(day)} of each month` : "not set");

/**
 * The line with the detail changed, as the Details form saves it, or the
 * reason it cannot be: a detail the line does not have, or the rate, which
 * is Settings'.
 */
export function debtDetailChange(ask: DebtDetailAsk, debts: readonly Debt[], asOf: IsoDate): DebtDetailChange | { readonly refused: string } {
  const debt = debts.find((d) => d.id === ask.debtId);
  if (!debt) return { refused: "That line is no longer on your debt list." };
  const form = debt.form ?? "credit-line";
  const billed = debt.kind === "payable" && form !== "pass-through" && form !== "informal";

  if (ask.detail === "rate") {
    return {
      refused: `${debt.name}'s interest rate is set with the line itself, in Settings, under Credit and loans, which stays yours to change. It is ${debt.interestRate > 0 ? `${(debt.interestRate / 100).toFixed(2).replace(/\.?0+$/, "")}% now` : "not set now"}. Interest you actually pay is entered as it happens, inside a payment, and that I can do here.`,
    };
  }
  if (ask.detail === "limit") {
    if (!takesLimit(debt)) return { refused: `${debt.name} is not a lender's credit line, so it has no limit to set.` };
    const steps = limitSteps(debt);
    const was = steps.length > 0 ? (steps[steps.length - 1]?.amount ?? null) : (debt.creditLimit ?? null);
    if (was === ask.value) return { refused: `${debt.name}'s limit is already ${formatMoney(ask.value)}.` };
    // A first limit counts from the day the line opened; a change counts from today (the Details form's own rule).
    const from = steps.length > 0 ? asOf : debt.openedDate || asOf;
    const changed = withLimit(debt, ask.value, from);
    const next = changed.creditLimit ? { ...changed, limitCounts: debt.limitCounts ?? "owed" } : changed;
    return {
      debt,
      next,
      label: "Credit limit",
      now: was ? formatMoney(was) : "not set",
      then: formatMoney(ask.value),
      words:
        steps.length > 0
          ? `${debt.name}'s limit from ${formatMoney(was ?? 0)} to ${formatMoney(ask.value)}, from today. The old limit stays on the days it applied to.`
          : `${debt.name}'s limit set to ${formatMoney(ask.value)}, counted from ${formatMedium(from)}, when the line opened.`,
    };
  }
  if (ask.detail === "billingDay") {
    if (!billed) return { refused: `${debt.name} has no bill from a lender, so it has no billing day.` };
    if (debt.billingDay === ask.value) return { refused: `${debt.name}'s bill already closes on the ${ordinalDay(ask.value)}.` };
    return {
      debt,
      next: { ...debt, billingDay: ask.value },
      label: "The bill closes on",
      now: dayWords(debt.billingDay),
      then: dayWords(ask.value),
      words: `${debt.name}'s bill closing on the ${ordinalDay(ask.value)}: what you borrow after that day goes on the next bill.`,
    };
  }
  if (debt.dueDay === ask.value) return { refused: `${debt.name} is already due on the ${ordinalDay(ask.value)}.` };
  return {
    debt,
    next: { ...debt, dueDay: ask.value },
    label: debt.kind === "payable" ? "Payment due on" : "They pay back on",
    now: dayWords(debt.dueDay),
    then: dayWords(ask.value),
    words: `${debt.name} due on the ${ordinalDay(ask.value)} of each month${ask.value > 28 ? `, or the month's last day when it is shorter` : ""}. The Dashboard and the bell count down to it.`,
  };
}

/**
 * "How much is left on my Maya Credit limit?", "how much can I still
 * borrow?": the line's room today, or null when the question is not this.
 * It was answered "No kind of spending has a limit in October" (26 October
 * 2026), the reading for a category's limit.
 */
export function creditRoomAnswer(text: string, debts: readonly Debt[], rows: readonly Transaction[], asOf: IsoDate, kinds: readonly string[] = []): string | null {
  const t = text.trim();
  if (/\d/.test(t)) return null;
  const asks =
    (/\blimit\b/i.test(t) && /\b(?:left|remaining|room|available|how much|used|what(?:'s| is))\b/i.test(t)) ||
    /\bhow much (?:can|could) i (?:still )?borrow\b|\b(?:available|remaining) credit\b|\bcredit (?:left|available|remaining)\b/i.test(t);
  if (!asks) return null;
  const named = debtNamed(t, debts);
  /*
   * A limit on a kind of spending is the Budget's, not a credit line's: "how
   * much is left of my food limit?" was answered about Maya Credit, the only
   * line with a limit (27 October 2026). Without a line named, a kind named,
   * or spending, or no word of credit at all with a kind limited, leaves it
   * to the kind's answer (`limitAsk.ts`).
   */
  if (!named) {
    const flat = ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    const kindSaid = kinds.some((k) => {
      const w = k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return w.length > 0 && (flat.includes(` ${w} `) || flat.includes(` ${w}s `));
    });
    if (kindSaid || /\b(?:spending|budget)\b/i.test(t)) return null;
  }
  const debt = named ?? (debts.filter((d) => !d.archived && takesLimit(d)).length === 1 ? (debts.find((d) => !d.archived && takesLimit(d)) ?? null) : null);
  if (!debt) {
    const lines = debts.filter((d) => !d.archived && takesLimit(d));
    if (lines.length === 0) return null;
    const each = lines.map((d) => {
      const room = creditRoom(d, rows, asOf);
      return `- ${d.name}: ${room ? roomWords(room) : "no limit set"}`;
    });
    return ["Each credit line today:", ...each].join("\n");
  }
  if (!takesLimit(debt)) return null;
  const room = creditRoom(debt, rows, asOf);
  if (!room) return `${debt.name} has no limit set. Say "set my ${debt.name} limit to 15000", or set it on the Debt screen.`;
  const counts = room.counts === "borrowed" ? "counting only what was borrowed" : "counting everything owed, fees too";
  return `**${debt.name}: ${roomWords(room)}.** ${formatMoney(room.used)} is used, ${counts}.${room.lastChange ? ` The limit went from ${formatMoney(room.lastChange.before)} to ${formatMoney(room.lastChange.amount)} on ${formatMedium(room.lastChange.from)}.` : ""}`;
}
