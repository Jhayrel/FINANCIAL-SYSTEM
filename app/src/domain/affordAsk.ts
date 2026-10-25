/**
 * "Can I afford it?", answered from what is held, with the budget said apart.
 *
 * ── The conversation this exists for ──────────────────────────────────────
 *
 * The owner, 27 September 2026, over fifteen minutes:
 *
 *   how much I can spare tommorrow for my school? can I afford gas and food?
 *     -> "No, you have PHP 0.00 spare ... the month's budget is over"
 *   so with my current balance, what can I afford
 *     -> "I could not find an entry in that." / "How much was it?"   (x6)
 *   I am asking not adding ledger
 *     -> "I could not find an entry in that."
 *   I need gas for tommorrow can I affored it? with my current balance
 *   not with the budget. I cannot travel if I dont have gas
 *     -> "I could not find an entry in that."
 *   i spend 100 cash can i?          -> "Yes ... Cash holds PHP 1,075.00"
 *   but can I afford gas?            -> "No ... your budget is already exceeded"
 *   why say yes if then say no       -> "It could be a change in the conditions"
 *
 * Two faults. The sentences were not recognised as questions, because the
 * question words were in the middle ("so with my current balance, what can I
 * afford"), so they went to the entry reader and came back empty. And when
 * they were answered, "can I afford it" was answered from the budget, which
 * is a different question: whether the money is there, and whether it was
 * planned for, can have different answers, and saying one as the other gave
 * a yes and a no a minute apart.
 *
 * So the device answers it, the same way every time, from the figures the
 * Dashboard shows: what the spending wallets hold, less the bills and debt
 * payments still due this month, against what the thing usually costs going
 * by the ledger. The budget is said on its own line, as the budget.
 */

import { walletBalance } from "./balances";
import { borrowedMoney, lenderNames, ownIn } from "./borrowed";
import { addDays, getMonth, getYear, MONTH_NAMES } from "./dates";
import type { Debt } from "./debt";
import { formatMoney, withoutYears, type Centavos } from "./money";
import { monthBrief, safeAfter } from "./monthPlan";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "./types";

/** Asking whether there is money for something, anywhere in the sentence. */
const AFFORD =
  /\b(?:afford|affored|aford|afort|affort|kaya ko ba|kaya ba|can i (?:buy|spend|get|pay for|use)|could i (?:buy|spend|get)|do i have enough|have i got enough|enough (?:money|cash|balance|for|to)|what can i (?:buy|get|spend|afford)|how much (?:can|could|should) i (?:spend|spare|use)|can i spare|spare (?:for|tomorrow|tommorrow|today))\b|\bcan i\s*\??\s*$/i;

/** Saying it is a question, or which figure to go by, after a question like that. */
const GO_BY =
  /\b(?:based on (?:my )?(?:current )?balance|with my (?:current )?balance|on my balance|balance not (?:the )?budget|not (?:with |on )?(?:the |my )?budget|not the budget|i am asking|i'?m asking|just asking|not adding|not an entry|not a transaction|it'?s a question|this is a question)\b/i;

export const isAffordQuestion = (text: string): boolean => AFFORD.test(text);

/**
 * "so is it an option or not?", "yes or no?", "but I'm over budget right?"
 * straight after an affordability answer: the same decision, asked again.
 *
 * 28 September 2026: the device said yes from the wallets, the next two went
 * to the model, and it answered "No, it is not an option" to the same
 * question. The call is the device's, so the device makes it again, the same
 * way, with the budget said apart as before.
 */
const DECISION =
  /^\s*(?:so|but|then|ok(?:ay)?|and|wait)?[\s,]*(?:is (?:it|that) (?:an? )?(?:option|ok(?:ay)?|possible|fine|good|a yes|a no)|yes or no|can i or not|so can i|or not|what'?s the (?:answer|verdict|call)|should i or not|(?:but )?i'?m over (?:the |my )?budget|(?:but )?what about (?:the |my )?budget|is it yes|is it no|so yes|so no|based on (?:my |the )?(?:current )?(?:budget|balance)|(?:give me )?(?:a )?realistic cost\w*|how much (?:would|will) it (?:cost|be))\b[^.]{0,40}\??\s*$/i;
export const followsUpDecision = (text: string): boolean => DECISION.test(text.trim()) && text.trim().split(/\s+/).length <= 12;

/** A follow-up that only makes sense with an affordability question before it. */
export const goesByBalance = (text: string): boolean => GO_BY.test(text);

export interface AffordAsk {
  /** The things named, as the ledger names them: "Gas", "Food". */
  readonly items: readonly string[];
  /** A figure the sentence gives, when it gives one. */
  readonly amount: Centavos | null;
  /** A wallet the sentence names, when it names one. */
  readonly wallet: string | null;
  /** "tomorrow", "today", or nothing said. */
  readonly when: "tomorrow" | "today" | null;
  /**
   * Asked as yes or no ("can I", "should I buy"), as against "how much
   * should I use". A "Yes," before an answer to how much read as answering
   * something else (4 October 2026: "How much should I use? The fare is 300").
   */
  readonly yesNo?: boolean | undefined;
}

const words = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");

/** The figure in a sentence, in centavos: "100", "₱1,500", "250.50". Not a date or a count of days. */
function figureIn(text: string): Centavos | null {
  const m = /(?:₱|php|p)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\s*(?:days?|weeks?|months?|years?|am|pm|th|st|nd|rd)\b)/i.exec(text);
  if (!m) return null;
  const whole = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(whole) || whole <= 0) return null;
  const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return whole * 100 + cents;
}

/**
 * What the sentence asks about.
 *
 * The items are the ones the ledger already uses, matched as whole words,
 * so "gas" finds Gas and "school" finds School, and a word the ledger has
 * never used is not guessed at.
 */
export function readAffordAsk(
  text: string,
  transactions: readonly Transaction[],
  reference: Pick<ReferenceLists, "wallets" | "savings" | "spendingTypes">,
  asOf: IsoDate,
): AffordAsk {
  const said = ` ${words(text)} `;
  const since = addDays(asOf, -180);
  const names = new Set<string>(reference.spendingTypes.map((t) => t.name));
  for (const t of transactions) {
    if (t.type === "Spending" && t.date >= since && t.item.trim()) names.add(t.item.trim());
  }
  const items = [...names].filter((n) => {
    const w = words(n).trim();
    return w.length >= 3 && said.includes(` ${w} `);
  });
  /*
   * A word their descriptions use when no item matches: "can I go to gym?"
   * is Self Care described "Gym", and the answer had no gym in it at all
   * (12 October 2026, replayed 20 October). At least two rows in a year.
   */
  if (items.length === 0) {
    const yearAgo = addDays(asOf, -365);
    const described = transactions.filter((t) => t.type === "Spending" && t.date >= yearAgo && t.date <= asOf && t.description.trim());
    for (const w of new Set(words(text).trim().split(/\s+/))) {
      if (w.length < 3 || NOT_A_THING.has(w)) continue;
      const hits = described.filter((t) => ` ${words(t.description)} `.includes(` ${w} `)).length;
      if (hits >= 2) items.push(w.charAt(0).toUpperCase() + w.slice(1));
    }
  }
  const wallet =
    [...reference.wallets, ...reference.savings].find((w) => said.includes(` ${words(w).trim()} `)) ?? null;
  const when = /\b(?:tomorrow|tommorrow|tomorow|tmrw|bukas)\b/i.test(text) ? "tomorrow" : /\b(?:today|now|ngayon)\b/i.test(text) ? "today" : null;
  const yesNo = !/\bhow (?:much|many)\b|\bmagkano\b|\bilan\b/i.test(text);
  // A date's day is never money: "on oct 20", "the 20th" (12 October 2026 audit, A9).
  const undated = withoutYears(text).replace(/\b(?:the\s+)?(?:[12]\d|3[01]|0?[1-9])(?:st|nd|rd|th)\b/gi, " ");
  return { items, amount: figureIn(undated), wallet, when, yesNo };
}

/** Words of a question that are never the thing bought. */
const NOT_A_THING = new Set(
  "can could should would will the and for but with from into look usual usually expense expenses cost costs much how what when where today tomorrow tommorrow now this that these those you your mine afford buy get pay paid spend spent money cash balance budget go going went want need still also just like please pls".split(" "),
);

/** What one of these usually costs: the middle of the last ninety days' purchases, or by description over a year. */
export function usualCost(transactions: readonly Transaction[], item: string, asOf: IsoDate): Centavos | null {
  const since = addDays(asOf, -90);
  const key = item.toLowerCase();
  let paid = transactions
    .filter((t) => t.type === "Spending" && t.date >= since && t.date <= asOf && t.item.trim().toLowerCase() === key && t.total > 0)
    .map((t) => t.total)
    .sort((a, b) => a - b);
  if (paid.length === 0) {
    const yearAgo = addDays(asOf, -365);
    paid = transactions
      .filter((t) => t.type === "Spending" && t.date >= yearAgo && t.date <= asOf && t.total > 0 && ` ${words(t.description)} `.includes(` ${words(key).trim()} `))
      .map((t) => t.total)
      .sort((a, b) => a - b);
  }
  if (paid.length === 0) return null;
  const mid = Math.floor(paid.length / 2);
  return paid.length % 2 === 1 ? paid[mid]! : Math.round((paid[mid - 1]! + paid[mid]!) / 2);
}

export interface AffordInput {
  readonly transactions: readonly Transaction[];
  readonly reference: ReferenceLists;
  readonly budgets: Budgets;
  readonly debts: readonly Debt[];
  readonly asOf: IsoDate;
}

/** The answer, in plain sentences. Money is formatted only here, at the last moment. */
export function affordAnswer(ask: AffordAsk, input: AffordInput): string {
  const { transactions, reference, budgets, debts, asOf } = input;
  const year = getYear(asOf);
  const month = getMonth(asOf);
  const brief = monthBrief({ transactions, reference, budgets, debts, year, month, asOf });
  const safe = brief.safe;
  const monthName = MONTH_NAMES[month - 1] ?? "This month";
  const money = formatMoney;

  // What is held, wallet by wallet, so the figure can be checked against the apps.
  const held = reference.wallets
    .map((w) => ({ name: w, balance: walletBalance(transactions, w) }))
    .filter((w) => w.balance !== 0);
  const inWallets = safe?.wallets ?? held.reduce((s, w) => s + w.balance, 0);
  const due = safe ? safe.reservedBills + safe.reservedDebt : 0;
  const free = inWallets - due;

  // The one wallet asked about, when one is named: only what it holds can pay.
  const fromWallet = ask.wallet ? walletBalance(transactions, ask.wallet) : null;

  // What it would cost: the figure said, or what each named thing usually costs.
  const costs = ask.items.map((item) => ({ item, cost: usualCost(transactions, item, asOf) }));
  const known = costs.filter((c): c is { item: string; cost: Centavos } => c.cost !== null);
  const cost = ask.amount ?? (known.length > 0 ? known.reduce((s, c) => s + c.cost, 0) : null);

  const lines: string[] = [];
  // A wallet below zero is named too, or the parts do not add up to the whole ("₱941.46 (Gcash ₱1,000.00, Maya ₱302.46)").
  const walletWords = held.map((w) => `${w.name} ${money(w.balance)}`);
  const holding =
    fromWallet !== null
      ? `${ask.wallet} holds ${money(fromWallet)}.`
      : `Your spending wallets hold ${money(inWallets)}${walletWords.length > 0 ? ` (${walletWords.join(", ")})` : ""}.`;
  const dueWords =
    due > 0
      ? ` ${money(due)} of bills and debt payments is still due before ${monthName} ends, which leaves ${money(Math.max(0, free))} free.`
      : ` Nothing else is due before ${monthName} ends.`;

  if (cost !== null) {
    const what =
      ask.amount !== null
        ? money(ask.amount)
        : known.map((c) => `${c.item} usually costs you ${money(c.cost)}`).join(", and ");
    // "Gym usually costs you ₱70.00, so about ₱70.00" said the figure twice (26 October 2026): once, or the sum of several.
    const whatCost = ask.amount !== null ? what : known.length > 1 ? `${what}: together ${money(cost)}` : what;
    const room = fromWallet ?? free;
    const after = room - cost;
    /*
     * The day decides the first word. "CAN I SPEND 100 TODAY FOR GYM?" was
     * answered "Yes, going by what you hold today" with PHP 0.00 safe to
     * spend that day, and the next line then said it was PHP 100.00 more
     * than today's figure: a yes and a no to one question (backup of 7
     * October 2026, three times). The month's money is said second.
     */
    const tomorrowOnly = ask.when === "tomorrow" && (safe?.daysLeft ?? 0) > 1;
    const dayFigure = safe && fromWallet === null ? (tomorrowOnly ? safe.perDayAfter : safe.perDay) : null;
    const pastTheDay = dayFigure !== null && cost > dayFigure;
    if (room >= cost) {
      lines.push(
        pastTheDay
          ? `Not within ${tomorrowOnly ? "tomorrow's" : "today's"} figure of ${money(dayFigure)}: ${money(cost)} is ${money(cost - dayFigure)} more. The month's money can cover it. ${holding}${dueWords}`
          : `${ask.yesNo === false ? `${money(cost)} fits what you hold` : "Yes, going by what you hold"}${ask.when ? ` ${ask.when === "tomorrow" ? "for tomorrow" : "today"}` : ""}. ${holding}${fromWallet === null ? dueWords : ""}`,
      );
      lines.push(
        ask.amount !== null
          ? `After ${what} you would have ${money(after)} left${fromWallet !== null ? ` in ${ask.wallet}` : " free"}.`
          : `${whatCost}, which leaves ${money(after)}${fromWallet !== null ? ` in ${ask.wallet}` : " free"}.`,
      );
    } else if (fromWallet === null && inWallets >= cost) {
      lines.push(`Only by using money that is already spoken for. ${holding}${dueWords}`);
      lines.push(`${ask.amount !== null ? `${what} is` : `${whatCost}: that is`} ${money(cost - Math.max(0, free))} more than is free.`);
    } else {
      lines.push(`${ask.yesNo === false ? `${money(cost)} does not fit what you hold.` : "No."} ${holding}${fromWallet === null ? dueWords : ""}`);
      lines.push(`${ask.amount !== null ? `${what} is` : `${whatCost}: that is`} ${money(cost - Math.max(0, room))} more than that.`);
    }
    /*
     * The day, as the Dashboard has it. "Yes, going by what you hold" is the
     * month; a meal can fit the month and still be more than today's figure
     * (7 October 2026: a PHP 95.00 meal called within PHP 80.64 a day).
     */
    if (safe && fromWallet === null && room >= cost) {
      const then = safeAfter(safe, cost);
      if (ask.when === "tomorrow" && safe.daysLeft > 1) {
        lines.push(
          cost <= safe.perDayAfter
            ? `It fits tomorrow's figure of ${money(safe.perDayAfter)}.`
            : `It is ${money(cost - safe.perDayAfter)} more than tomorrow's figure of ${money(safe.perDayAfter)}, so the days after it would have less.`,
        );
      } else if (then.fitsToday) {
        lines.push(`It fits today's figure of ${money(safe.perDay)}, so from tomorrow stays ${money(then.perDayAfter)} a day.`);
      } else {
        lines.push(
          `It is ${money(cost - safe.perDay)} more than today's figure of ${money(safe.perDay)}${safe.daysLeft > 1 ? `: from tomorrow you would have ${money(then.perDayAfter)} a day instead of ${money(safe.perDayAfter)}` : ""}.`,
        );
      }
    }
    /*
     * Their own money, and what would be borrowed. "You have enough" was true
     * of money drawn on a credit line too; the owner asked to be told when a
     * purchase would be paid with borrowed money (7 October 2026). Followed
     * through every transfer (`borrowed.ts`).
     */
    if (debts.length > 0 && room >= cost) {
      const b = borrowedMoney(transactions, debts, [...reference.wallets, ...reference.savings]);
      if (b.inHand > 0 || b.heldForOthers > 0) {
        /*
         * Worked from the wallets asked about: Gcash holding someone's money
         * was called borrowed from Maya Credit, whose money was in Maya, and
         * "what you borrowed" was said when nothing was (7 October 2026
         * engine review). Own money first, then borrowed, then held (B6).
         */
        const asked = fromWallet !== null && ask.wallet ? [ask.wallet] : reference.wallets;
        const lentHere = asked.reduce((s, w) => s + (b.byAccount.get(w) ?? 0), 0);
        const heldHere = asked.reduce((s, w) => s + (b.notOwnByAccount.get(w) ?? 0), 0) - lentHere;
        const own = ownIn(b, asked, (w) => walletBalance(transactions, w));
        const past = Math.min(cost, cost - own);
        const lenders = lenderNames(new Map([...b.byLender].filter(([id]) => debts.find((d) => d.id === id)?.form !== "pass-through")), debts);
        const whose = fromWallet !== null ? ask.wallet : "your spending wallets";
        if (past > 0) {
          const fromLent = Math.min(past, lentHere);
          const fromHeld = Math.min(past - fromLent, Math.max(0, heldHere));
          const parts = [
            ...(fromLent > 0 ? [`${money(fromLent)} of this would be borrowed money, from ${lenders}`] : []),
            ...(fromHeld > 0 ? [`${money(fromHeld)}${fromLent > 0 ? "" : " of this"} would be money held for someone, which has to go back`] : []),
          ];
          if (parts.length > 0) lines.push(`But only ${money(own)} of what ${whose} ${fromWallet !== null ? "holds" : "hold"} is your own: ${parts.join(", and ")}.`);
        } else if (lentHere > 0 || heldHere > 0) {
          lines.push(`It is covered by your own money, ${money(own)}, without touching ${lentHere > 0 ? "what you borrowed" : "the money held for someone"}.`);
        }
      }
    }
    const unknown = costs.filter((c) => c.cost === null).map((c) => c.item);
    if (unknown.length > 0) lines.push(`There is nothing recent to go by for ${unknown.join(" and ")}, so it is not counted.`);
  } else if (ask.items.length > 0) {
    lines.push(`${holding}${dueWords}`);
    lines.push(`There is nothing in the last ninety days to say what ${ask.items.join(" and ")} usually costs. Tell me the amount and I will check it.`);
  } else {
    /*
     * "What can I afford": how much, and the day's figures the Dashboard
     * shows. Its own even split said PHP 77.32 a day beside the Dashboard's
     * PHP 80.42 from tomorrow (6 October 2026 audit).
     */
    lines.push(`${holding}${dueWords}`);
    if (free > 0) {
      const days = safe?.daysLeft ?? 1;
      const rest = days - 1;
      const after = safe && rest > 0 ? `${money(safe.perDayAfter)} a day for the ${rest} ${rest === 1 ? "day" : "days"} after` : "";
      const day = !safe
        ? ""
        : safe.overToday > 0
          ? ` Today's share is already spent, ${money(safe.overToday)} past it${after ? `; from tomorrow, ${after}` : ""}.`
          : ` That is ${money(safe.perDay)} today${after ? `, then ${after}` : ""}.`;
      lines.push(`So you can spend up to ${money(free)} before ${monthName} ends and still cover what is due.${day}`);
    } else {
      lines.push(`So nothing is free to spend until more comes in: what is due is more than the wallets hold.`);
    }
  }

  // The budget, as the budget: whether it was planned for, not whether the money is there.
  if (safe && safe.budgetLeft !== null) {
    if (safe.budgetLeft < 0) {
      lines.push(
        `On the budget it is a different answer: ${monthName}'s spending is already ${money(-safe.budgetLeft)} over its budget, so ${cost !== null ? "this adds to that" : "anything more adds to that"}. The balance says whether you can pay; the budget says whether you planned to.`,
      );
    } else if (cost !== null && cost > safe.budgetLeft) {
      lines.push(`It would take ${monthName} ${money(cost - safe.budgetLeft)} past its spending budget, which has ${money(safe.budgetLeft)} left.`);
    } else {
      // "too" only after a yes: after "No" it read as agreeing with itself (12 October 2026 audit, A17).
      const said = lines[0] ?? "";
      lines.push(
        /^(?:\*\*)?(?:No|Not)\b/.test(said)
          ? `On the budget alone it fits, with ${money(safe.budgetLeft)} left of ${monthName}'s spending budget; the money above is what decides.`
          : `It fits the budget too: ${money(safe.budgetLeft)} is left of ${monthName}'s spending budget.`,
      );
    }
  }
  return lines.join("\n\n");
}
