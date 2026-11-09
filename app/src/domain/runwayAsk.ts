/**
 * "How long will my money last": the money the wallets hold after what is
 * still due (bills, debt payments, plans), at the pace of the last thirty
 * days. It went to the model with nothing worked out (9 November 2026
 * sweep), where it could only guess.
 */
import { addDays, formatMedium } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { SafeToSpend } from "./monthPlan";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

const RUNWAY =
  /\bhow\s+long\b[^?]{0,40}\b(?:money|cash|wallets?|it|funds?|pera|savings|budget)\b[^?]{0,20}\b(?:last|go|stretch|enough|survive)\b|\bhow\s+long\s+(?:can|could)\s+i\s+(?:last|survive|go)\b|\bwhen\s+will\s+i\s+(?:run\s+out|be\s+broke|have\s+nothing)\b|\buntil\s+when\b[^?]{0,30}\b(?:money|pera)\b|\bhanggang\s+kailan\b|\bhow\s+many\s+days\b[^?]{0,30}\b(?:money|cash|wallets?|left|last)\b/i;

export const asksRunway = (text: string): boolean => RUNWAY.test(text);

/** What a day of spending has come to over the thirty days to today, bills and subscriptions apart (they are set aside on their own). */
export function recentPace(rows: readonly Transaction[], asOf: IsoDate): Centavos {
  const from = addDays(asOf, -29);
  const spent = rows
    .filter((t) => t.date >= from && t.date <= asOf && !(t as Transaction & { deletedAt?: string }).deletedAt && t.type === "Spending" && t.category !== "Bills" && t.category !== "Subscriptions")
    .reduce((sum, t) => sum + Math.max(0, costOf(t)), 0);
  return Math.round(spent / 30);
}

export function runwayWords(safe: Pick<SafeToSpend, "wallets" | "reservedBills" | "reservedDebt" | "reservedPlans" | "reservedAllocations" | "safe" | "perDay" | "daysLeft">, pace: Centavos, asOf: IsoDate): string {
  const due = safe.reservedBills + safe.reservedDebt + safe.reservedPlans;
  const dayToDay = Math.max(0, safe.wallets - due);
  const monthEnd = addDays(asOf, safe.daysLeft - 1);
  const out: string[] = [];
  out.push(`Your spending wallets hold ${formatMoney(safe.wallets)}; ${formatMoney(due)} of it is still due for bills${safe.reservedDebt > 0 ? ", debt payments" : ""}${safe.reservedPlans > 0 ? " and plans" : ""}, which leaves ${formatMoney(dayToDay)} for day-to-day spending${(safe.reservedAllocations ?? 0) > 0 ? `, your allocations included` : ""}.`);
  if (pace <= 0) {
    out.push(`Nothing was spent day to day in the last 30 days, so there is no pace to measure it by.`);
  } else {
    const days = Math.floor(dayToDay / pace);
    const until = addDays(asOf, Math.max(0, days - 1));
    out.push(
      `At your pace of the last 30 days, ${formatMoney(pace)} a day, that lasts about ${days} ${days === 1 ? "day" : "days"}, to ${formatMedium(until)}. ${
        days >= safe.daysLeft
          ? `That is past the month's end on ${formatMedium(monthEnd)}, ${safe.daysLeft} ${safe.daysLeft === 1 ? "day" : "days"} from today.`
          : `That is ${safe.daysLeft - days} ${safe.daysLeft - days === 1 ? "day" : "days"} short of the month's end on ${formatMedium(monthEnd)}, unless money comes in or the pace slows.`
      }`,
    );
    const slower = Math.floor(dayToDay / Math.max(1, safe.daysLeft));
    if (days < safe.daysLeft) out.push(`To reach ${formatMedium(monthEnd)}, day-to-day spending would have to be ${formatMoney(slower)} a day.`);
  }
  out.push(`Safe to spend, after the allocations too, is ${formatMoney(Math.max(0, safe.safe))}: ${formatMoney(Math.max(0, safe.perDay))} a day for the ${safe.daysLeft} ${safe.daysLeft === 1 ? "day" : "days"} left.`);
  return out.join(" ");
}
