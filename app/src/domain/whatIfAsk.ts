/**
 * What-if questions the device answers from the Dashboard's own figures
 * (owner, 9 November 2026: "do what if this scenario happen"). Each was
 * answered wrongly or not at all on the owner's data:
 *
 * - "what if I get 5000 allowance" was read as spending ₱5,000.00: "No."
 * - "what if I don't spend anything for 3 days" was answered for one day.
 * - "if I pay globe today what happens to safe to spend" got the summary,
 *   never that a bill still to pay is set aside already.
 * - "what if I skip the gym this month" went to a model that was not there.
 *
 * Pure: readers take the words, answers take the figures. Money is integer
 * centavos and formatted only in the words.
 */
import { addDays, formatMedium } from "./dates";
import { formatMoney, withoutYears, type Centavos } from "./money";
import { dayFigures } from "./monthPlan";
import type { AllocationStatus, MonthAllocations } from "./monthAllocation";
import type { IsoDate } from "./types";

const money = formatMoney;
const IF = /\b(?:what\s+if|if|kung|what\s+happens?\s+if|suppose)\b/i;
const INCOME = /\b(?:allowance|salary|sahod|income|pay\s*check|payday|bonus|refund|earn\w*|receiv\w*|get\s+paid|comes?\s+in|coming\s+in|padala|remittance|baon)\b/i;
const SPENDS = /\b(?:buy|bought|spend|spent|afford|pay\s+for|purchase|order|gastos)\b/i;

/** The figure in a sentence, in centavos: "5000", "5k", "₱1,250.50". Never a year or a count of days. */
export function amountIn(text: string): Centavos | null {
  const m = /(?:₱|php|p)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*(k)\b)?(?!\s*(?:days?|weeks?|months?|years?|times?|am|pm|th|st|nd|rd)\b)/i.exec(withoutYears(text));
  if (!m) return null;
  const whole = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(whole) || whole <= 0) return null;
  const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return m[3] ? (whole * 100 + cents) * 1000 : whole * 100 + cents;
}

/** "what if I get 5000 allowance", "if my salary of 8k comes in": money coming, not spent. */
export function readIncomeIf(text: string): Centavos | null {
  if (!IF.test(text) || !INCOME.test(text) || SPENDS.test(text)) return null;
  return amountIn(text);
}

const WORD_NUMBERS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, isang: 1, dalawang: 2, tatlong: 3 };

/** "what if I don't spend anything for 3 days", "3 days without spending": how many days, from today. */
export function readNoSpendDays(text: string): number | null {
  const m =
    /\b(?:don'?t|do\s+not|won'?t|will\s+not|not|no|never|wala(?:ng)?|hindi)\s+(?:spend|spending|gastos|gumastos|use\s+(?:any\s+)?money)\b[^?.!]{0,30}?\bfor\s+(\d{1,2}|a|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:more\s+)?days?\b/i.exec(text) ??
    /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+days?\s+(?:without|of\s+no|with\s+no)\s+(?:spending|gastos)\b/i.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : WORD_NUMBERS[m[1]!.toLowerCase()] ?? null;
  return n !== null && n >= 1 && n <= 31 ? n : null;
}

/** "if I pay globe today", "what happens if I pay my wifi": a bill or subscription still to pay, named by a word of its own. */
export function readBillPayIf(text: string, open: readonly { readonly item: string }[]): string | null {
  if (!IF.test(text) || !/\b(?:pay|paid|settle|magbayad|bayaran)\b/i.test(text)) return null;
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  const found = open.find((b) =>
    b.item
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !/^(?:home|bill|bills|prepaid|postpaid|plan|monthly)$/.test(w))
      .some((w) => t.includes(` ${w} `)),
  );
  return found?.item ?? null;
}

/** "what if I skip the gym this month", "if I won't use parking": the allocation it would leave unused. */
export function readSkipIf(text: string, month: MonthAllocations): AllocationStatus | null {
  // Removing it or marking it done, asked as a what-if, frees the same money: answered the same way, never done (9 November 2026).
  const asIf = IF.test(text) && /\b(?:remove|delete|end|stop|mark\s+.{0,30}?done|done\s+with|finish)\b/i.test(text);
  if (!asIf && !/\b(?:skip|skipping|won'?t\s+(?:go|use|need)|not\s+(?:go|use|need)|don'?t\s+(?:go|use|need)|cancel|stop\s+going|no\s+more)\b/i.test(text)) return null;
  const t = text.toLowerCase();
  const says = (w: string): boolean => w.trim().length >= 2 && new RegExp(`(?<![a-z0-9])${w.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t);
  return (
    month.lines.find((s) => !s.twinOf && says(s.name)) ??
    month.lines.find((s) => !s.twinOf && s.line.words.split(/[,;]+/).some(says)) ??
    month.lines.find((s) => !s.twinOf && !s.line.words.trim() && says(s.line.kind)) ??
    null
  );
}

/** The figures these answers start from: the Dashboard's safe to spend. */
export interface SafeNow {
  readonly safe: Centavos;
  readonly perDay: Centavos;
  readonly perDayAfter: Centavos;
  readonly spentToday: Centavos;
  readonly daysLeft: number;
  readonly wallets: Centavos;
}

const until = (monthName: string): string => monthName.split(" ")[0] ?? "the month";

/** Money coming in: what is safe, today and from tomorrow, with it. The budget is not changed by it. */
export function incomeIfWords(amount: Centavos, s: SafeNow, monthName: string): string {
  const next = dayFigures(s.safe + amount, s.spentToday, s.daysLeft);
  return [
    `If ${money(amount)} comes in today, safe to spend goes from ${money(Math.max(0, s.safe))} to ${money(Math.max(0, s.safe) + amount)} until ${until(monthName)} ends: ${money(next.perDay)} today instead of ${money(s.perDay)}${s.daysLeft > 1 ? `, and ${money(next.perDayAfter)} a day from tomorrow` : ""}.`,
    "Nothing changes until it is in: these are the figures once it is added as income. The bills, plans and allocations still to pay are set aside first, so they are already taken off.",
    "It does not raise the budget by itself. To do that, say \"add the money that came in to my budget\".",
  ].join(" ");
}

/** No spending for some days from today: the same money over fewer days after them. */
export function noSpendWords(days: number, s: SafeNow, asOf: IsoDate, monthName: string): string {
  if (days >= s.daysLeft) {
    return `Spend nothing until ${until(monthName)} ends and the ${money(Math.max(0, s.safe))} safe to spend now is still there on the 1st, carried over into next month.`;
  }
  const from = addDays(asOf, days);
  const rest = s.daysLeft - days;
  const perDay = Math.floor(Math.max(0, s.safe) / rest);
  return `Spend nothing for ${days} ${days === 1 ? "day" : "days"}, today to ${formatMedium(addDays(asOf, days - 1))}, and the ${money(Math.max(0, s.safe))} safe to spend is still there on ${formatMedium(from)}: ${money(perDay)} a day for the ${rest} days left, instead of ${money(s.perDay)} today. Unspent money is never lost; it is spread over the days after.`;
}

/** Paying a bill still to pay: it is set aside already, so only the wallet moves. */
export function billPayWords(bill: { readonly item: string; readonly amount: Centavos }, s: SafeNow): string {
  return `${bill.item}, ${money(bill.amount)}, is already set aside as a bill still to pay, so paying it today leaves safe to spend at ${money(Math.max(0, s.safe))} and today's figure at ${money(s.perDay)}. Your spending wallets go from ${money(s.wallets)} to ${money(s.wallets - bill.amount)}. Paid for more than ${money(bill.amount)}, the extra comes out of safe to spend.`;
}

/** Skipping what an allocation is for: what it holds stays held until the month ends, unless it is removed. */
export function skipWords(a: AllocationStatus, s: SafeNow, monthName: string): string {
  if (a.held <= 0) return `${a.name} holds nothing more this month (${a.over > 0 ? `${money(a.over)} over` : "all of it used"}), so skipping it changes no figure.`;
  const freed = dayFigures(s.safe + a.held, s.spentToday, s.daysLeft);
  return [
    `Skip it and the ${money(a.held)} left in the ${a.name} allocation stays set aside until ${until(monthName)} ends; then it is free money in the new month.`,
    `To free it now, remove the allocation on Budget, under Allocations: safe to spend would go from ${money(Math.max(0, s.safe))} to ${money(Math.max(0, s.safe) + a.held)}, ${money(freed.perDay)} today instead of ${money(s.perDay)}. It can be put back.`,
  ].join(" ");
}
