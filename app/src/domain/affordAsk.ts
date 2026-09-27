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
import { addDays, getMonth, getYear, MONTH_NAMES } from "./dates";
import type { Debt } from "./debt";
import { formatMoney, type Centavos } from "./money";
import { monthBrief } from "./monthPlan";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "./types";

/** Asking whether there is money for something, anywhere in the sentence. */
const AFFORD =
  /\b(?:afford|affored|aford|afort|affort|kaya ko ba|kaya ba|can i (?:buy|spend|get|pay for|use)|could i (?:buy|spend|get)|do i have enough|have i got enough|enough (?:money|cash|balance|for|to)|what can i (?:buy|get|spend|afford)|how much (?:can|could|should) i (?:spend|spare|use)|can i spare|spare (?:for|tomorrow|tommorrow|today))\b|\bcan i\s*\??\s*$/i;

/** Saying it is a question, or which figure to go by, after a question like that. */
const GO_BY =
  /\b(?:based on (?:my )?(?:current )?balance|with my (?:current )?balance|on my balance|balance not (?:the )?budget|not (?:with |on )?(?:the |my )?budget|not the budget|i am asking|i'?m asking|just asking|not adding|not an entry|not a transaction|it'?s a question|this is a question)\b/i;

export const isAffordQuestion = (text: string): boolean => AFFORD.test(text);

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
  const wallet =
    [...reference.wallets, ...reference.savings].find((w) => said.includes(` ${words(w).trim()} `)) ?? null;
  const when = /\b(?:tomorrow|tommorrow|tomorow|tmrw|bukas)\b/i.test(text) ? "tomorrow" : /\b(?:today|now|ngayon)\b/i.test(text) ? "today" : null;
  return { items, amount: figureIn(text), wallet, when };
}

/** What one of these usually costs: the middle of the last ninety days' purchases. */
export function usualCost(transactions: readonly Transaction[], item: string, asOf: IsoDate): Centavos | null {
  const since = addDays(asOf, -90);
  const key = item.toLowerCase();
  const paid = transactions
    .filter((t) => t.type === "Spending" && t.date >= since && t.date <= asOf && t.item.trim().toLowerCase() === key && t.total > 0)
    .map((t) => t.total)
    .sort((a, b) => a - b);
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
  const walletWords = held.filter((w) => w.balance > 0).map((w) => `${w.name} ${money(w.balance)}`);
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
    const room = fromWallet ?? free;
    const after = room - cost;
    if (room >= cost) {
      lines.push(`Yes, going by what you hold${ask.when ? ` ${ask.when === "tomorrow" ? "for tomorrow" : "today"}` : ""}. ${holding}${fromWallet === null ? dueWords : ""}`);
      lines.push(
        ask.amount !== null
          ? `After ${what} you would have ${money(after)} left${fromWallet !== null ? ` in ${ask.wallet}` : " free"}.`
          : `${what}, so ${known.length > 1 ? "together about " : "about "}${money(cost)}, which leaves ${money(after)}${fromWallet !== null ? ` in ${ask.wallet}` : " free"}.`,
      );
    } else if (fromWallet === null && inWallets >= cost) {
      lines.push(`Only by using money that is already spoken for. ${holding}${dueWords}`);
      lines.push(`${ask.amount !== null ? what : `${what}, about ${money(cost)}`} is ${money(cost - Math.max(0, free))} more than is free.`);
    } else {
      lines.push(`No. ${holding}${fromWallet === null ? dueWords : ""}`);
      lines.push(`${ask.amount !== null ? what : `${what}, about ${money(cost)}`} is ${money(cost - Math.max(0, room))} more than that.`);
    }
    const unknown = costs.filter((c) => c.cost === null).map((c) => c.item);
    if (unknown.length > 0) lines.push(`There is nothing recent to go by for ${unknown.join(" and ")}, so it is not counted.`);
  } else if (ask.items.length > 0) {
    lines.push(`${holding}${dueWords}`);
    lines.push(`There is nothing in the last ninety days to say what ${ask.items.join(" and ")} usually costs. Tell me the amount and I will check it.`);
  } else {
    // "What can I afford": how much, and how that spreads over the days left.
    const days = Math.max(1, safe?.daysLeft ?? 1);
    lines.push(`${holding}${dueWords}`);
    if (free > 0) {
      lines.push(
        `So you can spend up to ${money(free)} and still cover what is due: about ${money(Math.floor(free / Math.max(1, days)))} a day for the ${days} ${days === 1 ? "day" : "days"} left in ${monthName}.`,
      );
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
      lines.push(`It fits the budget too: ${money(safe.budgetLeft)} is left of ${monthName}'s spending budget.`);
    }
  }
  return lines.join("\n\n");
}
