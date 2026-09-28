/**
 * The months ahead, as a realistic plan: what a normal month costs, what is
 * due, what usually comes in, and what the budget set for it says.
 *
 * ── Why this replaced the forecast's figures ───────────────────────────────
 *
 * The owner, 28 September 2026, looking at the Budget screen's forecast:
 * October ₱10,030.39 "3,601.51 to 16,459.27", November and December
 * ₱16,127.76 "15% up on the trend". A weighted average of the last three
 * months with a trend on top turns one Shopee order into every month after
 * it, and the bills figure was an average that still counted subscriptions
 * the owner had stopped. They asked for it to be "the realistic basis for
 * alloting budget", knowing their habits: what they spend, what they earn,
 * and the plan for spending and for bills.
 *
 * So each month ahead is the owner's usual month (`budgetAdvice.ts`): every
 * item at its median over the six months before, one-offs left out, the
 * bills still running at their last amount, the debt payments due that
 * month, and the income a usual month brings in. The same figures the budget
 * recommendation, the chat and "use the forecast" read, so none of them can
 * disagree.
 *
 * A month that last year held something the usual month does not (tuition,
 * a trip, Christmas) is said beside it and raises the top of the range. It is
 * not added to the estimate: one year is not a habit.
 */

import { budgetAdvice, median, monthsRead, type BudgetAdvice } from "./budgetAdvice";
import { budgetForMonth } from "./budget";
import { daysInMonth, makeDate, monthName } from "./dates";
import type { Debt } from "./debt";
import type { Centavos } from "./money";
import { costOf, spendingAttribution, totalsFor } from "./totals";
import type { Budgets, IsoDate, Transaction } from "./types";

export type Steadiness = "steady" | "varies" | "varies a lot" | "rough";

export interface Seasonal {
  readonly item: string;
  /** What it cost in the same month last year. */
  readonly lastYear: Centavos;
  /** Its usual month, for comparison. */
  readonly usual: Centavos;
}

export interface MonthOutlook {
  readonly year: number;
  readonly month: number;
  readonly name: string;
  /** Spending, fees and interest in a usual month: the spending track. */
  readonly spending: Centavos;
  /** The bills and subscriptions still running. */
  readonly billsSubs: Centavos;
  /** Both tracks: what the month is expected to cost. */
  readonly total: Centavos;
  /** Debt payments due in the month: money needed, not part of the budget. */
  readonly debtDue: Centavos;
  /** The spending track's likely range: the usual month, up to the middle month read or last year's same month, whichever is more. */
  readonly low: Centavos;
  readonly high: Centavos;
  /** The middle month read, as it really went, one-offs and all: half the months spent this or more. */
  readonly withExtras: Centavos;
  /** What a usual month brings in. */
  readonly income: Centavos;
  /** Income less the month's cost and its debt payments. Negative when it does not cover them. */
  readonly left: Centavos;
  /** The budget set for the month, if any. */
  readonly budget: { readonly spending: Centavos; readonly billsSubs: Centavos; readonly total: Centavos };
  readonly steadiness: Steadiness;
  readonly seasonal: readonly Seasonal[];
  /** The months it was read from, oldest first ("2026-04"). */
  readonly read: readonly string[];
  /** The advice it came from, for the split by item. */
  readonly advice: BudgetAdvice;
}

/** The value a share of the way up a sorted list. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at] ?? 0;
}

export function outlookFor(
  transactions: readonly Transaction[],
  budgets: Budgets,
  year: number,
  month: number,
  asOf: IsoDate,
  options: {
    readonly stopped?: readonly { readonly name: string; readonly since: IsoDate }[];
    readonly debts?: readonly Debt[];
    /** The month to read back from; the months ahead all share one (`outlookAhead`). */
    readonly readBefore?: { readonly year: number; readonly month: number };
  } = {},
): MonthOutlook {
  const rows = transactions.filter((t) => !(t as Transaction & { deletedAt?: string }).deletedAt);
  const advice = budgetAdvice({
    transactions: rows,
    year,
    month,
    asOf,
    stopped: options.stopped ?? [],
    debts: options.debts ?? [],
    ...(options.readBefore ? { readBefore: options.readBefore } : {}),
  });

  // ── The spread of the months read, for the range and how steady it is ────
  const tracks = advice.read.map((k) => {
    const t = totalsFor(rows.filter((r) => r.date.startsWith(k)));
    return t.spending + t.fees + t.interest;
  });
  const sorted = [...tracks].sort((a, b) => a - b);
  const mid = median(tracks);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  const steadiness: Steadiness =
    advice.read.length < 3 ? "rough" : mid <= 0 ? "rough" : (p75 - p25) * 10 < mid * 3 ? "steady" : (p75 - p25) * 10 < mid * 7 ? "varies" : "varies a lot";

  // ── Last year's same month, for what the usual month would miss ──────────
  const lastKey = `${year - 1}-${String(month).padStart(2, "0")}`;
  const lastRange = { start: makeDate(year - 1, month, 1), end: makeDate(year - 1, month, daysInMonth(year - 1, month)) };
  const lastRows = rows.filter((r) => r.date.startsWith(lastKey));
  const usualOf = new Map(advice.items.map((l) => [l.name.toLowerCase(), l.amount]));
  const seasonal: Seasonal[] = [...spendingAttribution(lastRows, lastRange)]
    .filter(([item]) => !/^transaction fee$/i.test(item))
    .map(([item, amount]) => ({ item, lastYear: amount, usual: usualOf.get(item.toLowerCase()) ?? 0 }))
    .filter((s) => s.lastYear >= 100_000 && s.lastYear >= s.usual * 2 + 50_000)
    .sort((a, b) => b.lastYear - b.usual - (a.lastYear - a.usual))
    .slice(0, 3);
  const seasonalExtra = seasonal.reduce((sum, s) => sum + (s.lastYear - s.usual), 0);

  const spending = advice.spending;
  const billsSubs = advice.billsSubs;
  const total = spending + billsSubs;
  const set = budgetForMonth(budgets, year, month);
  return {
    year,
    month,
    name: `${monthName(month)} ${year}`,
    spending,
    billsSubs,
    total,
    debtDue: advice.debtDue,
    low: spending,
    high: Math.max(spending + seasonalExtra, mid),
    withExtras: Math.max(spending, mid),
    income: advice.typicalIncome,
    left: advice.typicalIncome - total - advice.debtDue,
    budget: { spending: set.spending, billsSubs: set.billsSubs, total: set.spending + set.billsSubs },
    steadiness,
    seasonal,
    read: advice.read,
    advice,
  };
}

/**
 * The months still ahead, from the one after today, `count` of them, across
 * the end of the year when it comes.
 */
export function outlookAhead(
  transactions: readonly Transaction[],
  budgets: Budgets,
  asOf: IsoDate,
  count: number,
  options: { readonly stopped?: readonly { readonly name: string; readonly since: IsoDate }[]; readonly debts?: readonly Debt[] } = {},
): MonthOutlook[] {
  const out: MonthOutlook[] = [];
  let y = Number(asOf.slice(0, 4));
  let m = Number(asOf.slice(5, 7));
  const next = m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  for (let i = 0; i < count; i += 1) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    // Every month ahead read from the same recent months, the ones before the next.
    out.push(outlookFor(transactions, budgets, y, m, asOf, { ...options, readBefore: next }));
  }
  return out;
}

const STEADY_WORDS: Record<Steadiness, string> = {
  steady: "Your months are steady, so this is close.",
  varies: "Your months vary a little, so allow some room.",
  "varies a lot": "Your months vary a lot, so treat this as a guide.",
  rough: "Few months to go on, so this is rough.",
};
export const steadyWords = (s: Steadiness): string => STEADY_WORDS[s];

/** How the outlook was made, in one line, for under the table. */
export function basisWords(o: MonthOutlook): string {
  return `Each item's usual month over ${monthsRead(o.read)}, the middle value so one big month does not set it, one-offs left out, and the bills still running at their last amount.`;
}

/** Months side by side that say the same, run by run, so three alike months are one line. */
function runs<T>(list: readonly MonthOutlook[], key: (o: MonthOutlook) => T): MonthOutlook[][] {
  const out: MonthOutlook[][] = [];
  for (const o of list) {
    const last = out[out.length - 1];
    const head = last?.[0];
    if (last && head && key(head) === key(o)) last.push(o);
    else out.push([o]);
  }
  return out;
}

/** "October 2026", "October and November 2026", "October to December 2026", "December 2026 and January 2027". */
export function monthsSaid(list: readonly MonthOutlook[]): string {
  const first = list[0];
  const last = list[list.length - 1];
  if (!first || !last) return "";
  if (list.length === 1) return first.name;
  const from = list.every((o) => o.year === first.year) ? monthName(first.month) : first.name;
  return list.length === 2 ? `${from} and ${last.name}` : `${from} to ${last.name}`;
}

const figuresKey = (o: MonthOutlook): string =>
  [o.total, o.spending, o.withExtras, o.billsSubs, o.debtDue, o.income, o.left, o.budget.total].join("|");

/** The outlook in words, the device's own: what the table says, for a reader. */
export function outlookWords(list: readonly MonthOutlook[], money: (c: Centavos) => string): string {
  const first = list[0];
  if (!first) return "";
  const out: string[] = [];
  out.push(
    `A usual month costs about ${money(first.total)}: ${money(first.spending)} of spending and ${money(first.billsSubs)} of bills and subscriptions${first.withExtras > first.spending ? `; counting one-offs, half your months spent ${money(first.withExtras)} or more` : ""}. It usually brings in ${money(first.income)}, ${first.left >= 0 ? `which leaves about ${money(first.left)}` : `which is ${money(-first.left)} short`}${first.debtDue > 0 ? ` after ${money(first.debtDue)} of debt payments due in ${monthName(first.month)}` : ""}.`,
  );
  for (const run of runs(list, (o) => `${o.budget.total}|${o.total}`)) {
    const o = run[0];
    if (!o) continue;
    const said = monthsSaid(run);
    if (o.budget.total > 0 && o.budget.total < o.total) {
      out.push(`${run.length === 1 ? `${said}'s budget` : `The budget for ${said}`} of ${money(o.budget.total)} ${run.length === 1 ? "is" : "is, each month,"} ${money(o.total - o.budget.total)} under a usual month.`);
    } else if (o.budget.total === 0) {
      out.push(`${said} ${run.length === 1 ? "has" : "have"} no budget yet.`);
    }
  }
  for (const o of list) {
    for (const s of o.seasonal) {
      out.push(`Last ${monthName(o.month)} also had ${s.item} ${money(s.lastYear)} (usually ${money(s.usual)}): if it comes again, plan for it.`);
    }
  }
  out.push(steadyWords(first.steadiness));
  return out.join(" ");
}

/** The facts the model is given to explain the outlook: nothing else. */
export function outlookFacts(list: readonly MonthOutlook[], money: (c: Centavos) => string): string[] {
  const facts: string[] = [];
  const first = list[0];
  if (first) facts.push(`Worked out from each item's usual month over ${monthsRead(first.read)}, one-offs left out.`);
  for (const run of runs(list, figuresKey)) {
    const o = run[0];
    if (!o) continue;
    facts.push(
      `${monthsSaid(run)}${run.length > 1 ? ", each" : ""}: a usual month ${money(o.total)} (spending ${money(o.spending)}, and counting one-offs half the months read spent ${money(o.withExtras)} or more; bills and subscriptions ${money(o.billsSubs)}); debt payments due ${money(o.debtDue)}; usual income ${money(o.income)}; left after the usual month and its debt payments ${money(o.left)}; budget set ${o.budget.total > 0 ? `${money(o.budget.total)}${o.budget.total < o.total ? `, ${money(o.total - o.budget.total)} under a usual month` : ", which covers a usual month"}` : "none"}.`,
    );
  }
  for (const o of list) {
    for (const s of o.seasonal) facts.push(`${o.name}: last year that month also had ${s.item} ${money(s.lastYear)}, usually ${money(s.usual)}.`);
  }
  if (first) {
    const top = first.advice.items.slice(0, 5).map((l) => `${l.name} ${money(l.amount)}`).join(", ");
    if (top) facts.push(`The biggest items in a usual month: ${top}.`);
    facts.push(steadyWords(first.steadiness));
  }
  return facts;
}

/** What a month costs so far, for the rows the table does not plan: used by tests and the chat. */
export const costSoFar = (rows: readonly Transaction[], key: string): Centavos => rows.filter((t) => t.date.startsWith(key)).reduce((s, t) => s + costOf(t), 0);
