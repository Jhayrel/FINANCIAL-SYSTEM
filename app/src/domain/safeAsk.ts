/**
 * "How much can I spend today?", answered with the Dashboard's own figures.
 *
 * ── The conversation this exists for ──────────────────────────────────────
 *
 * The owner, 5 and 6 October 2026:
 *
 *   Make me a breakdown of how much i can spend today
 *     -> "There is nothing in that period to draw."              (x3)
 *   Actually 200 per day is the safe to spend like look. You need to remove
 *   the subscription and bill to the equation then only whats left is use.
 *     -> "Settings are yours to change: accounts, categories, bills ..."
 *   How much i can spend today since i already spend too much yesterday
 *     -> "PHP 297.95 a day left to spend under your budget"
 *   Thats wrong check my balance again
 *   What is my safe spending? Like the actual safe spending based remove
 *   the subscription and bills
 *     -> "Settings are yours to change ..."                       (x2)
 *
 * "breakdown" read as a chart, "remove the subscription" read as a change to
 * Settings, and the one answer that came was the budget's pace, which is the
 * plan and not the money. The question is always the same one: what the
 * spending wallets hold, less the bills, subscriptions and debt payments
 * still to pay this month, and what of that is today's (`monthPlan.ts`).
 */

import { formatMoney as money } from "./money";
import { ifNothingMoreToday, isOpenBill, weekAhead, type MonthBrief } from "./monthPlan";
import { addDays, dayOfWeek, formatMedium, MONTH_NAMES } from "./dates";
import { daysIn } from "./readEntry";
import type { IsoDate } from "./types";

/**
 * Asking what is safe, free or left to spend, in the owner's words.
 *
 * Anything that only names the bills and subscriptions to take them out of
 * a sum ("remove the subscription and bill to the equation") is this
 * question too, never a change to Settings.
 */
const SAFE_ASK =
  /\bsafe(?:ly)?(?:\s+to)?\s+spend(?:ing)?\b|\bspend(?:ing)?\s+safely\b|\bsafe\s+(?:amount|figure|limit)\b|\bhow\s+much\s+(?:money\s+|cash\s+)?(?:can|could|should|do|may|am)\s+i\s+(?:spend|use|spare|allowed\s+to\s+spend)\b|\bhow\s+much\s+(?:money\s+|cash\s+)?i\s+(?:can|could|should|may)\s+(?:spend|use|spare)\b|\bhow\s+much\s+(?:is\s+)?(?:left|free|available)\s+(?:to|for)\s+(?:spend|use|today)\b|\bwhat\s+can\s+i\s+(?:spend|use)\b|\b(?:free|left|available)\s+to\s+(?:spend|use)\b|\bspendable\b|\b(?:my\s+)?(?:daily|today'?s)\s+(?:allowance|limit)\b|\bmagkano\s+(?:ang\s+)?(?:pwede|puwede|kaya|pede)\s+(?:ko\s+)?(?:gastusin|gamitin|i-?spend|gastos)\b/i;

const TAKES_OUT_BILLS =
  /\b(?:remove|removing|minus|take\s+out|taking\s+out|less|without|exclude|excluding|subtract|deduct|set\s+aside|alis(?:in)?|bawas(?:an)?)\b[^.?!]{0,30}\b(?:bills?|subscriptions?|subs)\b/i;
const ABOUT_A_SUM = /\b(?:spend(?:ing)?|left|use|usable|safe|equation|computation|calculation|compute|total|figure|formula|balance|money|wallets?|budget|per\s+day|a\s+day|daily|today|whats?\s+left|what'?s\s+left)\b/i;

/** "minus the bills": arithmetic on its own, never a request to delete one. */
const ARITHMETIC = /\b(?:minus|subtract|deduct|less|bawas(?:an)?)\b/i;

/** "remove the subscription and bills": both named at once is the sum, not deleting one of them (owner, 5 October 2026). */
const BOTH_KINDS = /\bbills?\b[^.?!]{0,30}\bsubscriptions?\b|\bsubscriptions?\b[^.?!]{0,30}\bbills?\b/i;

/** "how much is left after paying the bills", "what do I have after bills and subscriptions". */
const AFTER_BILLS =
  /\b(?:left|have|remain\w*|natira|matitira|free|usable)\b[^.?!]{0,40}\bafter\s+(?:paying\s+|i\s+pay\s+)?(?:the\s+|my\s+|all\s+)?(?:bills?|subscriptions?|subs)\b/i;

/** "how much can I spend on food": one kind of spending, which the affordability answer knows the usual cost of. */
const ON_ONE_THING = /\bspend(?:ing)?\s+(?:on|for)\s+(?!today\b|tomorrow\b|the\s+rest\b|this\b|now\b|the\s+day\b|the\s+week(?:end)?\b|the\s+month\b|ngayon\b|(?:the\s+)?next\b|the\s+coming\b|the\s+whole\b|(?:the\s+)?weekend\b|\d+\s+days?\b|a\s+few\s+days\b|[a-z]+\s+days?\b)[a-z]/i;

/**
 * What happens to money not spent: "I didn't spend yesterday", "should it be
 * 72, I have not spent yesterday", "if I don't spend today does it add
 * tomorrow", "does it carry over". 15 October 2026: the second was taken as
 * the answer to a card's question from the night before.
 */
export function asksCarryOver(text: string): boolean {
  const t = text.trim();
  return (
    /\b(?:didn'?t|did\s+not|don'?t|do\s+not|won'?t|will\s+not|haven'?t|have\s+not|hadn'?t|had\s+not|not|never|no|wala(?:ng)?|hindi)\s+(?:(?:yet|even|really)\s+)?(?:spen[dt]|spending|gastos|gumastos|nagastos|used?\s+(?:it|the\s+money))\b[^.?!]{0,40}\b(?:yesterday|today|kahapon|ngayon|this\s+week|for\s+\d+\s+days)\b/i.test(t) ||
    /\b(?:yesterday|kahapon)\b[^.?!]{0,30}\b(?:didn'?t|did\s+not|haven'?t|have\s+not|not|never|no|hindi)\s+(?:spen[dt]|gumastos)\b/i.test(t) ||
    /\b(?:carr(?:y|ies|ied)\s+over|roll(?:s|ed)?\s+over|add(?:s|ed)?\s+(?:it\s+|up\s+)?(?:(?:to|on|into)\s+)?(?:tomorrow|the\s+next\s+day|bukas)|(?:unspent|unused|leftover|left\s+over|natira)\b[^.?!]{0,30}\b(?:tomorrow|bukas|next\s+day|go|goes|happen))/i.test(t)
  );
}

export function asksSafeToSpend(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (ON_ONE_THING.test(t)) return false;
  if (asksCarryOver(t)) return true;
  if (SAFE_ASK.test(t)) return true;
  if (AFTER_BILLS.test(t)) return true;
  // "what if I didn't spend yesterday", "if I don't spend today": what carries over (12 October 2026 audit, A9).
  if (/\b(?:what\s+if|if)\s+i\s+(?:didn'?t|did\s+not|hadn'?t|had\s+not|don'?t|do\s+not|won'?t|will\s+not|never)\s+spen[dt]\b/i.test(t)) return true;
  return TAKES_OUT_BILLS.test(t) && (ABOUT_A_SUM.test(t) || ARITHMETIC.test(t) || BOTH_KINDS.test(t));
}

/**
 * The answer, from the brief the Dashboard shows, in the order the owner
 * asked for it: today, then the month, then from tomorrow, then the plan.
 */
/**
 * A figure a day the message proposes: "200 per day", "₱150 a day", "250
 * daily". In centavos, or null.
 */
export function rateIn(text: string): number | null {
  const m = /(?:₱|php\s*|p)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(?:pesos?\s+)?(?:per\s+day|a\s+day|each\s+day|every\s+day|daily|\/\s*day|kada\s+araw|isang\s+araw)\b/i.exec(text);
  if (!m) return null;
  const whole = Number((m[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return whole * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
}

export function safeWords(
  brief: MonthBrief,
  rate: number | null = null,
  /**
   * The owner's own money in the spending wallets beside what is borrowed
   * there (`borrowed.ts`): safe to spend counts every peso in the wallets,
   * and part of it may be a credit line's (7 October 2026).
   */
  own: { readonly own: number; readonly borrowed: number; readonly from: string } | null = null,
): string {
  const safe = brief.safe;
  const name = MONTH_NAMES[brief.month - 1] ?? "the month";
  if (!safe) return `Safe to spend is worked out for the month running only.`;
  if (safe.wallets < 0) return `Nothing is safe to spend: your wallets are ${money(-safe.wallets)} below zero.`;

  /*
   * The sum as the Dashboard lays it out, one line each, then what it means
   * for today and the plan in a sentence or two.
   */
  const due = brief.bills.bills.filter(isOpenBill);
  const named = due.map((b) => `${b.item} ${money(b.amount)}`);
  const sum = [
    `- In your wallets: ${money(safe.wallets)}`,
    `- Bills and subscriptions still to pay: ${safe.reservedBills > 0 ? `\u2212${money(safe.reservedBills)}${named.length > 0 ? ` (${named.join(", ")})` : ""}` : "none"}`,
    ...(safe.reservedDebt > 0 ? [`- Debt payments due: \u2212${money(safe.reservedDebt)}`] : []),
    `- Safe until ${name} ends: **${money(safe.safe)}**`,
    /*
     * How today's figure comes from it: the model twice called it the wallets
     * less the bills, which is the line above (backup of 7 October 2026).
     */
    ...(safe.daysLeft > 0
      ? [
          `- Today's share: ${money(Math.max(0, safe.safe) + safe.spentToday)} over the ${safe.daysLeft} ${safe.daysLeft === 1 ? "day" : "days"} left, today included: ${money(safe.todayShare)}${safe.spentToday > 0 ? `, less ${money(safe.spentToday)} spent today: ${money(safe.perDay)}` : ""}`,
        ]
      : []),
    ...(safe.daysLeft > 1 ? [`- From tomorrow: ${money(safe.perDayAfter)} a day for ${safe.daysLeft - 1} ${safe.daysLeft === 2 ? "day" : "days"}`] : []),
    // Unspent money carries over: the days after rise by what today leaves (`ifNothingMoreToday`).
    ...(safe.daysLeft > 1 && ifNothingMoreToday(safe) > safe.perDayAfter
      ? [`- If nothing more is spent today: ${money(ifNothingMoreToday(safe))} a day from tomorrow, since what is not spent carries over`]
      : []),
    ...(() => {
      const week = weekAhead(safe);
      return week.days > 1 ? [`- The next ${week.days} days, today included: ${money(week.amount)}${week.days < 7 ? `, to the end of ${name}` : ""}`] : [];
    })(),
  ];

  const after: string[] = [];
  if (safe.free < 0) {
    after.push(`What is still to pay is ${money(-safe.free)} more than your wallets hold, so nothing is safe to spend until more comes in.`);
  } else if (safe.spentToday > 0) {
    after.push(
      safe.overToday > 0
        ? `Today's share was ${money(safe.todayShare)} and ${money(safe.spentToday)} went out today, ${money(safe.overToday)} past it.`
        : `Today's share is ${money(safe.todayShare)}, and ${money(safe.spentToday)} of it is spent.`,
    );
  }
  if (rate !== null && safe.daysLeft > 0) {
    /*
     * Counted from before today's spending, with today at whichever is more,
     * the rate or what today already spent: a day already past the rate
     * cannot be spent at it. Counting today at the rate said PHP 150.00 a day
     * fits with PHP 3,219.00 gone today and PHP 80.42 a day left from
     * tomorrow (6 October 2026 audit).
     */
    const days = safe.daysLeft;
    const need = Math.max(rate, safe.spentToday) + rate * (days - 1);
    const room = safe.safe + safe.spentToday;
    const pastToday = safe.spentToday > rate;
    const what = pastToday
      ? `Today already spent ${money(safe.spentToday)}, so ${money(rate)} a day from tomorrow for ${days - 1} ${days - 1 === 1 ? "day" : "days"} comes to ${money(need)} with today`
      : `${money(rate)} a day for the ${days} ${days === 1 ? "day" : "days"} left, today included, is ${money(need)}`;
    const fits = safe.overToday > 0 ? `${money(safe.perDayAfter)} a day from tomorrow fits.` : `${money(safe.todayShare)} a day fits.`;
    after.push(need <= room ? `${what}: it fits, with ${money(room - need)} to spare.` : `${what}: ${money(need - room)} more than is safe. ${fits}`);
  }
  if (own && own.borrowed > 0 && own.own < safe.safe) {
    after.push(
      `Of what is safe, ${money(own.own)} is your own money; ${money(Math.min(own.borrowed, safe.safe - own.own))} of it is borrowed, from ${own.from}, so spending past ${money(own.own)} spends what you borrowed.`,
    );
  }
  if (safe.budgetLeft !== null) {
    after.push(
      safe.budgetLeft <= 0
        ? "Your spending budget is used up, so this is past the plan even with the money there."
        : safe.limitedBy === "budget"
          ? `Your spending budget has less left, ${money(safe.budgetLeft)}: ${money(safe.budgetPerDay ?? 0)} a day keeps to it.`
          : `Your spending budget still has ${money(safe.budgetLeft)}, so the money is the limit, not the plan.`,
    );
  }
  // The plan promising more than the money, said as the Dashboard says it (`monthPlan.ts` notes).
  const beyond = (brief.warnings ?? []).find((w) => /promises .* more than your money/.test(w)) ?? "";
  return [`**Safe to spend today: ${money(safe.perDay)}**`, sum.join("\n"), after.join(" "), beyond].filter(Boolean).join("\n\n");
}

/**
 * The days ahead a safe-to-spend question asks about: "from oct 15 to oct
 * 20", "next week", "this week", "the next 5 days", "this weekend". The
 * chart reader looks back ("this week" is the last seven days); money to
 * spend looks forward. Null when it names none.
 */
export function daysAskedAbout(text: string, asOf: IsoDate): { from: IsoDate; to: IsoDate; name: string } | null {
  const span = daysIn(text, asOf);
  if (span) return { from: span.from, to: span.to, name: `${formatMedium(span.from)} to ${formatMedium(span.to)}` };
  const dow = dayOfWeek(asOf); // 0 Sunday
  const toSunday = (7 - dow) % 7;
  if (/\bnext week\b|\bsusunod na linggo\b/i.test(text)) {
    const monday = addDays(asOf, toSunday + 1);
    return { from: monday, to: addDays(monday, 6), name: "next week" };
  }
  if (/\bthis week\b|\bngayong linggo\b/i.test(text)) return { from: asOf, to: addDays(asOf, toSunday), name: "the rest of this week" };
  if (/\b(?:this )?weekend\b/i.test(text)) {
    const saturday = addDays(asOf, (6 - dow + 7) % 7);
    return { from: saturday < asOf ? asOf : saturday, to: addDays(saturday, 1), name: "the weekend" };
  }
  const next = /\b(?:next|coming)\s+(\d{1,2})\s+days?\b/i.exec(text);
  if (next?.[1]) return { from: addDays(asOf, 1), to: addDays(asOf, Number(next[1])), name: `the next ${next[1]} days` };
  return null;
}

