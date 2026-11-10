/**
 * Which chart a message wants, the charts beyond money in and money out, and
 * what each chart says in a sentence.
 *
 * ── Why the assistant now says which chart ────────────────────────────────
 *
 * The owner, 4 October 2026: "Fix the ai and charting like make sure they
 * are align like if the result need to show charts or pie or tend etc show
 * them but be careful ai should know properly and show the right things.
 * Make sure everything ai can do and charts can do all."
 *
 * The model used to say only whether a message was a chart. What kind, split
 * by what, and of which money was read from the words alone (`charts.ts`), so
 * "where did my money go this month?" was answered in words with nothing
 * drawn, "is my food going up?" drew nothing, and "chart my budget vs actual"
 * drew spending by item. Now the model says what it would draw (`ChartHint`),
 * the device's own reading of the words fills the gaps and overrules it where
 * the words are plain (a "pie" typed is a pie whatever a model thinks), and
 * every figure is still added up here, in integer centavos, never by a model.
 *
 * ── Why budget, balance and owed are drawn here too ───────────────────────
 *
 * Dashboard and Insights draw spending against the budget, and the Debt
 * screen says what is owed. The assistant could talk about all three and
 * draw none of them, so "show me my budget vs actual" was a chart of
 * something else. Each is its own measure, with the colour its money has
 * everywhere else (rule D3): spending red beside a grey budget, a balance
 * grey because holding money is neither gain nor loss, and what is owed
 * amber because a liability is not an expense.
 */

import {
  type Chart,
  type ChartBy,
  type ChartKind,
  type ChartRow,
  chartLabel,
  directionIn,
  groupingOf,
  namesWindow,
  overTime,
  wantsBothDirections,
  windowOf,
  presentationFor,
  percentOf,
} from "./charts";
import { budgetForMonth } from "./budget";
import { monthsRead } from "./budgetAdvice";
import { monthsSaid, outlookFor, type MonthOutlook } from "./outlook";
import type { AllocationStatus, MonthAllocations } from "./monthAllocation";
import type { SafeToSpend } from "./monthPlan";
import { asksUpcoming } from "./upcoming";
import { owedChange, type Debt } from "./debt";
import { costOf, monthTotals } from "./totals";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "./types";
import { walletDelta } from "./balances";
import { formatMedium } from "./dates";

// ── What the message wants drawn ────────────────────────────────────────────

/** The money a chart is of. The last three are levels or a budget, drawn by this file. */
export type ChartMoney = "spending" | "income" | "both" | "budget" | "balance" | "owed" | "forecast" | "allocation" | "safe" | "upcoming";

/** What to draw, as the model or the words say it. Every part may be missing. */
export interface ChartHint {
  readonly shape?: ChartKind | undefined;
  readonly by?: ChartBy | undefined;
  readonly money?: ChartMoney | undefined;
}

const SHAPES: Readonly<Record<string, ChartKind>> = {
  bars: "bars", bar: "bars", column: "bars", columns: "bars",
  pie: "pie", donut: "pie", doughnut: "pie",
  line: "line", trend: "line",
};

const GROUPINGS: Readonly<Record<string, ChartBy>> = {
  item: "item", items: "item",
  category: "category", categories: "category",
  wallet: "wallet", wallets: "wallet", account: "wallet", accounts: "wallet",
  day: "day", days: "day", daily: "day",
  week: "week", weeks: "week", weekly: "week",
  month: "month", months: "month", monthly: "month",
  year: "year", years: "year", yearly: "year",
};

const MONIES: Readonly<Record<string, ChartMoney>> = {
  spending: "spending", spent: "spending", expenses: "spending", expense: "spending",
  income: "income", revenue: "income",
  both: "both",
  budget: "budget",
  balance: "balance", balances: "balance",
  owed: "owed", debt: "owed", owe: "owed",
  forecast: "forecast", prediction: "forecast", projection: "forecast",
  allocation: "allocation", allocations: "allocation",
  safe: "safe",
  upcoming: "upcoming", future: "upcoming",
};

/**
 * The model's `draw`, checked against the lists. Anything it invented is
 * dropped rather than passed on, the same as an invented intent.
 */
export function hintFrom(said: unknown): ChartHint | null {
  if (!said || typeof said !== "object" || Array.isArray(said)) return null;
  const v = said as Record<string, unknown>;
  const word = (key: string): string => (typeof v[key] === "string" ? (v[key] as string).trim().toLowerCase() : "");
  const shape = SHAPES[word("shape")];
  const by = GROUPINGS[word("by")];
  const money = MONIES[word("money")];
  if (!shape && !by && !money) return null;
  return { ...(shape ? { shape } : {}), ...(by ? { by } : {}), ...(money ? { money } : {}) };
}

/** "where did my money go": a share of a whole, so a pie. */
const SPLIT_SHARE =
  /\bwhere (?:did|does|do|has|have|is) (?:all )?(?:of )?(?:my|the) money (?:go|gone|going)\b|\bwhere (?:my|the) money (?:went|goes|is going)\b|\bsaan (?:napunta|napupunta|nauubos|naubos)\b|\bhow (?:is|was) (?:my|the) (?:spending|money) (?:split|divided|spread)\b/i;

/** "what did I spend most on": a ranking, so bars. */
const SPLIT_RANK =
  /\bwhat (?:did|do|have) i (?:spend|spent) (?:the )?most on\b|\bwhat (?:am i|i'?m|was i) spending (?:on|the most)\b|\b(?:biggest|largest|top|main|highest) (?:spending|expenses?|costs?|items?|categories|purchases)\b|\bwhat (?:costs?|cost me|takes?|took|eats?) (?:me )?(?:the )?most\b|\b(?:and|spent|spend|spending|went|goes|go) (?:it )?on what\b/i;

/** Going up or down: change over time, so a line. */
const MOVING =
  /\b(?:going|gone|went|go|goes) (?:up|down)\b|\b(?:increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|dropp(?:ed|ing)|climb(?:s|ed|ing)|ris(?:e|es|ing|en)|rose|grow(?:s|ing|n)?|grew|shrink(?:s|ing)?|shrank)\b|\bover the (?:months|weeks|year)\b|\btumataas\b|\bbumababa\b|\bhow (?:has|have|did) .{0,40}\b(?:change|changed|moved|gone)\b/i;

/** About money at all, so "is it going up" about a chart on screen is not read as one. */
const MONEYISH =
  /\b(?:spend|spending|spent|expenses?|income|revenue|earnings|allowance|salary|savings?|balances?|money|gastos|ginastos|bills?|subscriptions?|costs?|food|fare|debt|owed?)\b/i;

/** A word for drawing, or for the shape of change, that makes a level something to see. */
const SEE =
  /\b(?:chart|graph|plot|draw (?:me|my|a|the|it|out)|visual|visuali[sz]e|show|trend|trends|over time|history|by month|each month|every month|per month|monthly|by day|daily|by week|weekly|month by month|grew|grown|changed?|moved|went (?:up|down)|gone (?:up|down)|paid down|lately)\b/i;

const BUDGET_SEE = /\b(?:vs\.?|versus|against|compared?|compare|actual|chart|graph|plot|draw|show|track|tracking|pace|each month|every month|per month|by month|monthly|over time|trend|so far)\b/i;
/** A budget being set, raised or recommended is a budget card, not a chart. */
const BUDGET_DOING = /\b(?:set|change|raise|lower|recommend|suggest|propose|make|add|apply|increase|decrease|cut|realistic)\b/i;
/**
 * Why it was asked, not what to draw: "a break down of expenses based on
 * categories so I can do Budgeting last month", then "chart", drew the month
 * against the budget instead of the categories (owner, 4 November 2026).
 */
export const BUDGET_PURPOSE = /\b(?:so\s+(?:that\s+)?i\s+(?:can|could)|for|to\s+help\s+(?:me\s+)?(?:with)?|to)\s+(?:do\s+|make\s+|plan\s+|set\s+|with\s+)?(?:my\s+|a\s+|the\s+)?budget(?:ing|s)?\b/gi;

/** Where the money is now, per account: a level, split. */
/** "how much is in each of my accounts", "how much do I have in my wallets". */
const IN_ACCOUNTS = String.raw`\bhow much (?:do i have|i have|is|is there) in (?:each|every|all)?\s*(?:of\s+)?(?:my\s+)?(?:wallets?|accounts?)\b`;

const PER_ACCOUNT = new RegExp(
  String.raw`\b(?:each|every|per|by|across|all(?: of)? my|which)\s+(?:of\s+my\s+)?(?:wallets?|accounts?)\b|\bwhere is (?:all )?my money\b(?!\s+go)|${IN_ACCOUNTS}`,
  "i",
);

/**
 * A balance as a thing an account has: "my maya balance", "balances",
 * "balance over time". Not the verb: "My Maya Credit does not balance" is
 * a reconciliation, and "can you balance my spending" a request for advice.
 */
const BALANCE_NOUN =
  /\b(?:my|the|account|wallet|wallets|total|savings|maya|gcash|cash|bank|its|their)\s+balances?\b|\bbalances\b|\bbalances?\s+(?:of|in|on|over|by|per|for|history|trend|chart|graph|grew|changed?|went)\b/i;

/** "my balance is 1533": a figure being told, never a chart to draw. */
const TELLS_BALANCE = /\bbalances?\s+(?:is|was|says|shows|reads)\s+(?:php|₱|p)?\s*\d/i;

const DEBT_WORDS = /\b(?:debts?|owe|owed|owing|utang|loans?|borrow(?:ed|ing)?|credit)\b/i;

/**
 * The months ahead as the app plans them: "a prediction next month", "my
 * forecast for December", "what will I spend next month". The owner, 9
 * November 2026, asked for a prediction of next month, was answered in
 * words, then said "can you show that in chart?" and was drawn the gym's
 * spending from two questions before: nothing here knew a forecast was a
 * thing to draw.
 */
export const FORECAST_WORDS =
  /\b(?:forecast(?:ed|s|ing)?|predict(?:ion|ions|ed|s|ing)?|projections?|projected|(?:will|would|might) i (?:likely |probably )?(?:spend|need)|expected (?:spending|expenses?|costs?)|usual month)\b/i;
/** "use the forecast": a budget being set from it, which is a budget card, not a chart. */
const FORECAST_DOING = /\b(?:use|apply|take|go with|set (?:it |my budget |the budget )?to)\s+(?:the\s+|my\s+|that\s+|this\s+)?(?:forecast|projection|prediction)\b/i;
/** About a month to come, or the months ahead, rather than one gone. */
const AHEAD = /\b(?:next|coming|upcoming|ahead|future|rest of (?:the|this) year|following)\b|\b(?:will|would|might|going to|gonna)\b/i;

/** Safe to spend by name, or what is free to spend. */
const SAFE_WORDS = /\bsafe[\s-]+to[\s-]+spend\b|\b(?:free|okay|ok) to spend\b|\bhow much (?:can|could) i (?:still )?spend\b|\bpwede (?:ko )?(?:pang )?gastusin\b/i;

/** Said about allocations by name: "allocation", "allocated", "envelope". */
const ALLOCATION_WORDS = /\b(?:allocat\w*|alocat\w*|envelopes?|naka-?allocate)\b/i;

/** Whether the words ask about the months ahead as the app plans them. */
export function asksForecast(question: string): boolean {
  if (!FORECAST_WORDS.test(question) || FORECAST_DOING.test(question)) return false;
  // "usual month" alone is a habit asked about; with a month to come it is a forecast.
  return /\b(?:forecast|predict|projection|projected)/i.test(question) || AHEAD.test(question) || /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(question);
}

/**
 * What the words alone say should be drawn, from plain signals only.
 *
 * Narrow on purpose: this is what overrules a model, so it fires on
 * phrasings with one meaning and leaves everything else to the model.
 */
export function localHint(question: string, credits: readonly string[] = []): ChartHint | null {
  const q = question.trim();
  if (!q) return null;
  const lower = q.toLowerCase();
  const namesCredit = credits.some((c) => c.trim() !== "" && lower.includes(c.trim().toLowerCase()));

  if (asksForecast(q)) return { money: "forecast" };
  if (asksUpcoming(q)) return { money: "upcoming" };
  if (SAFE_WORDS.test(q) && SEE.test(q)) return { money: "safe" };
  if (ALLOCATION_WORDS.test(q) && (SEE.test(q) || /\b(?:status|left|how (?:are|is)|progress|used)\b/i.test(q))) return { money: "allocation" };
  if (/\bbudget/i.test(q.replace(BUDGET_PURPOSE, " ")) && BUDGET_SEE.test(q) && !BUDGET_DOING.test(q)) {
    return { money: "budget" };
  }
  if (!TELLS_BALANCE.test(q) && (BALANCE_NOUN.test(q) || /\b(?:savings|ipon)\b|\bwhere is (?:all )?my money\b(?!\s+go)/i.test(q) || new RegExp(IN_ACCOUNTS, "i").test(q))) {
    if (PER_ACCOUNT.test(q)) return { money: "balance", by: "wallet" };
    if (SEE.test(q)) return { money: "balance" };
  }
  if ((namesCredit || DEBT_WORDS.test(q)) && SEE.test(q) && !/\bdraw by draw\b/i.test(q)) {
    return { money: "owed" };
  }
  // A shape the words name is theirs: "a pie of top spending" is a pie, not the bars a ranking would get.
  const shaped = SAYS_SHAPE.test(q);
  if (SPLIT_SHARE.test(q)) return shaped ? { by: "item" } : { by: "item", shape: "pie" };
  if (SPLIT_RANK.test(q)) return shaped ? { by: "item" } : { by: "item", shape: "bars" };
  if (MOVING.test(q) && MONEYISH.test(q)) return shaped ? { by: "month" } : { by: "month", shape: "line" };
  return null;
}

/**
 * The model's guess at a level or a budget stands only when the words are
 * about one. "show my spending" read as a balance would draw the wrong
 * thing in exactly the way the owner asked to stop.
 */
function moneyAllowed(money: ChartMoney, question: string, credits: readonly string[]): boolean {
  if (money === "budget") return /\b(?:budget|limit)/i.test(question);
  if (money === "balance") {
    return (
      !TELLS_BALANCE.test(question) &&
      // Not "net worth": a balance chart takes no debt off, so it drew a line above the Dashboard's net worth (6 October 2026 audit).
      (BALANCE_NOUN.test(question) || /\b(?:savings|ipon|where is (?:all )?my money|in (?:my|each|every) (?:wallets?|accounts?))\b/i.test(question) || new RegExp(IN_ACCOUNTS, "i").test(question))
    );
  }
  if (money === "forecast") return asksForecast(question);
  if (money === "allocation") return ALLOCATION_WORDS.test(question);
  if (money === "safe") return SAFE_WORDS.test(question);
  if (money === "upcoming") return asksUpcoming(question);
  if (money === "owed") {
    const lower = question.toLowerCase();
    return DEBT_WORDS.test(question) || credits.some((c) => c.trim() !== "" && lower.includes(c.trim().toLowerCase()));
  }
  return true;
}

/** The words' reading first, the model's for whatever the words leave open. */
export function mergeHint(local: ChartHint | null, model: ChartHint | null, question: string, credits: readonly string[] = []): ChartHint | null {
  const modelMoney = model?.money && moneyAllowed(model.money, question, credits) ? model.money : undefined;
  const money = local?.money ?? modelMoney;
  const by = local?.by ?? model?.by;
  // A line through items, which have no order, is bars (`charts.ts`, `kindOf`).
  const shapeSaid = local?.shape ?? model?.shape;
  const shape = shapeSaid === "line" && by !== undefined && !overTime(by) ? undefined : shapeSaid;
  if (!money && !by && !shape) return null;
  return { ...(shape ? { shape } : {}), ...(by ? { by } : {}), ...(money ? { money } : {}) };
}

/** The money this chart is of, when it is a level or a budget rather than a flow. */
export function measureOf(hint: ChartHint | null): "budget" | "balance" | "owed" | "forecast" | "allocation" | "safe" | "upcoming" | null {
  const money = hint?.money;
  return money === "budget" || money === "balance" || money === "owed" || money === "forecast" || money === "allocation" || money === "safe" || money === "upcoming" ? money : null;
}

const SAYS_SHAPE = /\b(?:pie|donut|doughnut|circle|bars?|bar chart|bar graph|columns?|line|line chart|curve|trend|over time)\b/i;
const SAYS_SPENDING = /\b(?:spen[dt]|spending|expenses?|gastos|ginastos|money out|went out)\b/i;

const BY_IN_WORDS: Readonly<Record<ChartBy, string>> = {
  item: "by item",
  category: "by category",
  wallet: "by wallet",
  day: "daily",
  week: "weekly",
  month: "by month",
  year: "by year",
};

const SHAPE_IN_WORDS: Readonly<Record<ChartKind, string>> = {
  bars: "as bars",
  pie: "pie",
  line: "as a line",
};

/**
 * The question with what the hint adds said in words, for `buildChart`.
 *
 * Only the parts the message left open: a grouping, a shape or a direction
 * it names stays the one it named. Said in words rather than passed as
 * options because `buildChart` already reads every one of these phrases,
 * window defaults included ("by month" with no period is this year), so the
 * hint goes through exactly the rules a typed request does.
 */
export function inWords(question: string, hint: ChartHint | null): string {
  if (!hint) return question;
  const add: string[] = [];
  const groupingSaid = groupingOf(question) !== "item" || /\bitems?\b/i.test(question);
  if (hint.by && hint.by !== "item" && !groupingSaid) add.push(BY_IN_WORDS[hint.by]);
  if (hint.shape && !SAYS_SHAPE.test(question)) add.push(SHAPE_IN_WORDS[hint.shape]);
  if (hint.money === "income" && directionIn(question) === "spending" && !SAYS_SPENDING.test(question)) add.push("income");
  if (hint.money === "both" && !wantsBothDirections(question)) add.push("income and spending");
  return add.length > 0 ? `${question} ${add.join(" ")}` : question;
}

/** A question after one figure: "how much is my maya balance", "magkano na". A chart adds nothing to it. */
const ONE_FIGURE = /^\s*(?:so\s+)?(?:how much|magkano|what(?:'s| is) my|ilan)\b/i;
const SPREAD = /\b(?:each|every|per|by|on what|where|breakdown|break down|split|trend|over time|over the|month by month|compared?|vs|versus|against|than|which|most|biggest|largest|top)\b/i;

/**
 * Whether a question answered in words should have a chart beside it.
 *
 * Only for what a picture says better than a sentence: a split, a change
 * over time, two periods side by side, a budget, a balance or a debt over
 * time. Never for one figure, a yes or no, or a question about a chart
 * already on screen: "is it a trend??" straight after one was answered with
 * the same chart again (7 September 2026, "you showed me a chart thats a
 * question").
 */
export function chartHelps(question: string, hint: ChartHint | null, chartJustShown: boolean): boolean {
  if (!hint) return false;
  // A list of questions in one message is answered in words: one chart cannot be the answer to all of them.
  if (question.trim().split(/\n+/).length >= 3 || question.trim().split(/\s+/).length > 60) return false;
  if (chartJustShown && /\b(?:it|that|this|those|these|the chart|the graph|the trend)\b/i.test(question)) return false;
  if (ONE_FIGURE.test(question) && !SPREAD.test(question)) return false;
  const presentation = presentationFor(question);
  if (presentation === "text") return false;
  if (presentation === "chart" || OVER_TIME.test(question)) return true;
  /*
   * "Compare to Elon Musk" is not two of the owner's own figures side by
   * side: a comparison is drawn only against a period, a budget, a plan or
   * income (13 October 2026).
   */
  if (COMPARES.test(question) && !COMPARES_OWN.test(question)) return false;
  /*
   * Drawn beside the words whenever the question has a shape a picture
   * shows: a split, a ranking, a forecast, a budget, a balance or a debt
   * over time. The owner, 9 November 2026: "they know the right time to
   * show charts ... they dont wait". This replaces the rule of 13 October
   * 2026, when a chart nobody named was offered after the words and drawn
   * only on a yes. One figure, a yes or no, and a question about a chart
   * already on screen are still answered in words alone (above).
   */
  return true;
}

const COMPARES = /\b(?:compare[sd]?|comparing|comparison|vs\.?|versus|against)\b/i;
/** Compared with something of the owner's own: a period, the budget, a plan, income or spending. */
const COMPARES_OWN =
  /\b(?:compare[sd]?|comparing|comparison|vs\.?|versus|against)\s+(?:to\s+|with\s+)?(?:my\s+|the\s+|its\s+|what\s+i\s+)?(?:last|this|previous|next|same|budget|budgets|limits?|plan|plans|forecast|income|spending|spent|earn\w*|usual|average|actual|january|february|march|april|may|june|july|august|september|october|november|december|20\d{2})\b/i;

/** A question about how something moved across periods. */
const OVER_TIME = /\b(?:going up|went up|rising|rose|increas\w*|decreas\w*|dropp\w*|falling|fell|month by month|each month|every month|per month|week by week|over the (?:months|weeks|year)|compared? (?:to|with) (?:last|this|the previous|previous|the same) (?:month|week|year|period)|(?:vs\.?|versus) (?:last|this|the previous|previous) (?:month|week|year)|than last (?:month|week|year))\b/i;

// ── The charts this file draws ──────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const monthName = (ym: string): string => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
const dayName = (d: IsoDate): string => `${MONTHS[Number(d.slice(5, 7)) - 1]?.slice(0, 3) ?? ""} ${Number(d.slice(8, 10))}`;

const at = (d: IsoDate): Date => new Date(`${d}T00:00:00Z`);
const iso = (d: Date): IsoDate => d.toISOString().slice(0, 10);

function lastDayOf(ym: string): IsoDate {
  const d = at(`${ym}-01`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return iso(d);
}

function nextDay(d: IsoDate): IsoDate {
  const x = at(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return iso(x);
}

function nextMonth(ym: string): string {
  const x = at(`${ym}-01`);
  x.setUTCMonth(x.getUTCMonth() + 1);
  return iso(x).slice(0, 7);
}

const daysBetween = (from: IsoDate, to: IsoDate): number => Math.round((at(to).getTime() - at(from).getTime()) / 86_400_000) + 1;

/** One period of a level chart: its label and the day it is read at. */
interface Step {
  readonly label: string;
  readonly end: IsoDate;
}

/** Days for a short window, months for a long one; never past today. */
function stepsOver(from: IsoDate, to: IsoDate, asOf: IsoDate): Step[] {
  const last = to < asOf ? to : asOf;
  if (from > last) return [];
  const steps: Step[] = [];
  if (daysBetween(from, last) <= 62) {
    for (let d = from; d <= last; d = nextDay(d)) steps.push({ label: dayName(d), end: d });
    return steps;
  }
  for (let ym = from.slice(0, 7); ym <= last.slice(0, 7); ym = nextMonth(ym)) {
    const end = lastDayOf(ym);
    steps.push({ label: monthName(ym), end: end < last ? end : last });
  }
  return steps;
}

/** The first day anything in the ledger happened, for a window that starts at the beginning. */
const firstDayOf = (rows: readonly Transaction[]): IsoDate | null =>
  rows.reduce<IsoDate | null>((first, t) => (first === null || t.date < first ? t.date : first), null);

/**
 * The named one, longest first, so "Maya Bank (Personal savings)" beats "Maya".
 * A name in brackets is also said without them: "maya bank" or "personal
 * savings" both mean "Maya Bank (Personal savings)". The edges are letters
 * and digits rather than a word boundary, which cannot follow a closing bracket.
 */
function namedIn(question: string, names: readonly string[]): string {
  const lower = question.toLowerCase();
  const says = (phrase: string): boolean =>
    new RegExp(`(?<![a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(lower);
  const spoken = [...new Set(names.map((n) => n.trim()).filter(Boolean))].flatMap((name) => {
    const full = name.toLowerCase();
    const bare = full.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    const inside = /\(([^)]+)\)/.exec(full)?.[1]?.trim() ?? "";
    return [full, bare, inside].filter((p) => p.length >= 3).map((phrase) => ({ name, phrase }));
  });
  return spoken.sort((a, b) => b.phrase.length - a.phrase.length).find((s) => says(s.phrase))?.name ?? "";
}

/**
 * Spending beside the budget.
 *
 * Over months: each month's spending and its budget, the same two figures
 * as the Dashboard's "Budget vs actual" (`budgetSummary`: spending plus bills
 * and subscriptions, against both budget lines). Inside one month: the month
 * added up day by day against a steady pace to its budget, the same as the
 * Insights burn chart. A month that has not started yet has nothing to show.
 */
export function buildBudgetChart(
  question: string,
  transactions: readonly Transaction[],
  budgets: Budgets,
  asOf: IsoDate,
): Chart | null {
  const year = asOf.slice(0, 4);
  const said = namesWindow(question) ? windowOf(question, asOf) : { from: `${year}-01-01`, to: asOf, name: `${year} so far` };

  if (said.from.slice(0, 7) === said.to.slice(0, 7) && said.from > "1000") {
    const ym = said.from.slice(0, 7);
    const start = `${ym}-01`;
    if (start > asOf) return null;
    const end = lastDayOf(ym);
    const last = end < asOf ? end : asOf;
    const plan = budgetForMonth(budgets, Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));
    const budget = plan.spending + plan.billsSubs;
    const days = Number(end.slice(8, 10));
    const byDay = new Map<IsoDate, { value: number; count: number }>();
    for (const t of transactions) {
      if (t.date < start || t.date > last) continue;
      const cost = costOf(t);
      if (cost <= 0) continue;
      const found = byDay.get(t.date) ?? { value: 0, count: 0 };
      found.value += cost;
      found.count += 1;
      byDay.set(t.date, found);
    }
    const rows: ChartRow[] = [];
    let spent = 0;
    for (let d = start; d <= last; d = nextDay(d)) {
      const day = byDay.get(d);
      spent += day?.value ?? 0;
      const pace = budget > 0 ? Math.round((budget * Number(d.slice(8, 10))) / days) : 0;
      rows.push({ label: dayName(d), value: spent, share: 0, count: day?.count ?? 0, previous: pace, previousShare: 0 });
    }
    // The rest of the month already entered counts on the last day, as the month's total counts it.
    const later = last < end ? transactions.filter((t) => t.date > last && t.date <= end && costOf(t) > 0) : [];
    const lastDay = rows[rows.length - 1];
    if (later.length > 0 && lastDay) {
      spent += later.reduce((sum, t) => sum + costOf(t), 0);
      rows[rows.length - 1] = { ...lastDay, value: spent, count: lastDay.count + later.length };
    }
    if (spent === 0 && budget === 0) return null;
    const top = Math.max(1, spent, budget);
    return {
      title: `Spending through ${monthName(ym)}, against the budget`,
      by: "day",
      kind: "line",
      rows: rows.map((r) => ({ ...r, share: r.value / top, previousShare: (r.previous ?? 0) / top })),
      total: spent,
      othersCount: 0,
      direction: "spending",
      measure: "budget",
      against: { name: "the budget", total: budget, now: last < end ? "Spent so far" : "Spent" },
      ...(last < end ? { running: true } : {}),
      ...(later.length > 0 ? { ahead: later.length } : {}),
    };
  }

  const first = firstDayOf(transactions);
  const from = said.from > "1000" ? said.from : first ?? said.from;
  const to = said.to < asOf ? said.to : asOf;
  const months: { ym: string; spent: number; budget: number; count: number }[] = [];
  for (let ym = from.slice(0, 7); ym <= to.slice(0, 7); ym = nextMonth(ym)) {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    const plan = budgetForMonth(budgets, y, m);
    const spent = monthTotals(transactions, y, m).total;
    const count = transactions.filter((t) => t.date.startsWith(ym) && costOf(t) > 0).length;
    months.push({ ym, spent, budget: plan.spending + plan.billsSubs, count });
  }
  // Months before the ledger and before any budget are not part of the story.
  const firstUsed = months.findIndex((m) => m.spent > 0 || m.budget > 0);
  const used = firstUsed < 0 ? [] : months.slice(firstUsed);
  if (used.length === 0) return null;
  const kept = used.slice(-24);
  const top = Math.max(1, ...kept.map((m) => Math.max(m.spent, m.budget)));
  const lastYm = kept[kept.length - 1]?.ym ?? "";
  // The month's total already counts what is entered for later in it.
  const ahead = lastYm === asOf.slice(0, 7) ? transactions.filter((t) => t.date > asOf && t.date.startsWith(lastYm) && costOf(t) > 0).length : 0;
  return {
    title: `Spending against the budget by month, ${said.name}`,
    by: "month",
    kind: "bars",
    rows: kept.map((m) => ({
      label: monthName(m.ym),
      value: m.spent,
      share: m.spent / top,
      count: m.count,
      previous: m.budget,
      previousShare: m.budget / top,
    })),
    total: kept.reduce((s, m) => s + m.spent, 0),
    othersCount: used.length - kept.length,
    direction: "spending",
    measure: "budget",
    against: { name: "the budget", total: kept.reduce((s, m) => s + m.budget, 0), now: "Spent" },
    ...(lastYm === asOf.slice(0, 7) ? { running: true } : {}),
    ...(ahead > 0 ? { ahead } : {}),
  };
}

/**
 * What one account, or a set of them, holds: per account now, or over time.
 *
 * Read the way `balances.ts` reads it (SYSTEM-ANALYSIS rule 3.1, revenue on
 * either side, money in net of its fee and money out with it), so the last
 * point of the line is the balance every other screen shows.
 */
export function buildBalanceChart(
  question: string,
  transactions: readonly Transaction[],
  reference: Pick<ReferenceLists, "wallets" | "savings">,
  asOf: IsoDate,
  perAccount = false,
): Chart | null {
  const named = namedIn(question, [...reference.wallets, ...reference.savings]);
  const savingsOnly = !named && /\b(?:savings|ipon)\b/i.test(question);
  const everything = /\b(?:all|every|each|total|whole|everything)\b/i.test(question);
  const set = named
    ? [named]
    : savingsOnly
      ? [...reference.savings]
      : perAccount || everything
        ? [...reference.wallets, ...reference.savings]
        : [...reference.wallets];
  if (set.length === 0) return null;
  const inSet = new Set(set);

  const window = namesWindow(question) ? windowOf(question, asOf) : null;
  const end = window && window.to < asOf ? window.to : asOf;

  /** What one row does to the set's balance, by the workbook's own three terms. */
  const delta = (t: Transaction, only?: string): number => walletDelta(t, (w) => (only ? w === only : inSet.has(w)));

  if (perAccount && !named) {
    const rows = set
      .map((w) => {
        let value = 0;
        let count = 0;
        for (const t of transactions) {
          // Up to today, everything entered counts, dated ahead or not, as on the sidebar.
          if (t.date > end && end !== asOf) continue;
          const d = delta(t, w);
          if (d !== 0) {
            value += d;
            count += 1;
          }
        }
        return { label: w, value, count };
      })
      .filter((r) => r.value !== 0)
      .sort((a, b) => b.value - a.value);
    if (rows.length === 0) return null;
    const top = Math.max(1, ...rows.map((r) => r.value));
    const positive = rows.every((r) => r.value > 0);
    const ahead = end === asOf ? transactions.filter((t) => t.date > asOf && set.some((w) => delta(t, w) !== 0)).length : 0;
    return {
      title: `Balance by account, ${end === asOf ? "today" : dayName(end)}`,
      by: "wallet",
      kind: /\b(?:pie|donut|doughnut)\b/i.test(question) && positive ? "pie" : "bars",
      rows: rows.map((r) => ({ ...r, share: Math.max(0, r.value) / top })),
      total: rows.reduce((s, r) => s + r.value, 0),
      othersCount: 0,
      measure: "balance",
      ...(ahead > 0 ? { ahead } : {}),
    };
  }

  const first = firstDayOf(transactions.filter((t) => delta(t) !== 0));
  if (!first) return null;
  const year = asOf.slice(0, 4);
  const from = window ? (window.from > "1000" ? window.from : first) : `${year}-01-01` > first ? `${year}-01-01` : first;
  const steps = stepsOver(from, end, asOf);
  if (steps.length === 0) return null;

  const sorted = transactions.filter((t) => t.date <= end && delta(t) !== 0).sort((a, b) => a.date.localeCompare(b.date));
  const rows: ChartRow[] = [];
  let i = 0;
  let level = 0;
  let previousEnd = "";
  for (const step of steps) {
    let count = 0;
    while (i < sorted.length && (sorted[i]?.date ?? "") <= step.end) {
      const t = sorted[i] as Transaction;
      level += delta(t);
      if (t.date > previousEnd) count += 1;
      i += 1;
    }
    previousEnd = step.end;
    rows.push({ label: step.label, value: level, share: 0, count });
  }
  // Read to today, the last point is the balance the sidebar shows, entries dated ahead included.
  const later = end === asOf ? transactions.filter((t) => t.date > asOf && delta(t) !== 0) : [];
  const lastRow = rows[rows.length - 1];
  if (later.length > 0 && lastRow) {
    rows[rows.length - 1] = { ...lastRow, value: lastRow.value + later.reduce((sum, t) => sum + delta(t), 0), count: lastRow.count + later.length };
  }
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const who = named ? named : savingsOnly ? "Savings" : everything ? "All accounts" : "Wallets";
  const name = window ? window.name : `${from.slice(0, 4) === year ? year : `${monthName(from.slice(0, 7))} to today`}`;
  const by: ChartBy = steps.length > 0 && /^\w{3} \d{1,2}$/.test(steps[0]?.label ?? "") ? "day" : "month";
  return {
    title: `${who} balance by ${by}, ${name}`,
    by,
    kind: "line",
    rows: rows.map((r) => ({ ...r, share: Math.max(0, r.value) / top })),
    total: rows[rows.length - 1]?.value ?? 0,
    othersCount: 0,
    measure: "balance",
    ...(end === asOf ? { running: true } : {}),
    ...(later.length > 0 ? { ahead: later.length } : {}),
  };
}

/**
 * What is owed, over time: one credit line when one is named, else every
 * line borrowed from. Rule 5.6.2: drawn, plus charges the lender added, less
 * repaid and written off; interest paid from a wallet is not owed.
 */
export function buildOwedChart(
  question: string,
  transactions: readonly Transaction[],
  debts: readonly Debt[],
  asOf: IsoDate,
): Chart | null {
  const name = namedIn(question, debts.map((d) => d.name));
  const chosen = name
    ? debts.filter((d) => d.name.trim().toLowerCase() === name.toLowerCase())
    : debts.filter((d) => d.kind === "payable" && d.form !== "pass-through");
  if (chosen.length === 0) return null;
  const ids = new Set(chosen.map((d) => d.id));
  const rowsOf = transactions.filter((t) => t.debtId !== undefined && ids.has(t.debtId)).sort((a, b) => a.date.localeCompare(b.date));
  const first = rowsOf[0]?.date;
  if (!first) return null;

  const window = namesWindow(question) ? windowOf(question, asOf) : null;
  // From the start of the month it began, so a line borrowed on the 15th is read month by month.
  const from = window && window.from > "1000" ? window.from : `${first.slice(0, 7)}-01`;
  const end = window && window.to < asOf ? window.to : asOf;
  const steps = stepsOver(from, end, asOf);
  if (steps.length === 0) return null;

  const rows: ChartRow[] = [];
  let i = 0;
  let owed = 0;
  for (const step of steps) {
    let count = 0;
    while (i < rowsOf.length && (rowsOf[i]?.date ?? "") <= step.end) {
      const t = rowsOf[i] as Transaction;
      owed += owedChange(t);
      if (t.date >= from) count += 1;
      i += 1;
    }
    rows.push({ label: step.label, value: owed, share: 0, count });
  }
  // As with a balance: read to today, what is owed includes what is dated ahead, as the sidebar has it.
  const later = end === asOf ? rowsOf.filter((t) => t.date > asOf) : [];
  const lastOwed = rows[rows.length - 1];
  if (later.length > 0 && lastOwed) {
    rows[rows.length - 1] = { ...lastOwed, value: lastOwed.value + later.reduce((sum, t) => sum + owedChange(t), 0), count: lastOwed.count + later.length };
  }
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const who = name || (chosen.length === 1 ? chosen[0]?.name ?? "" : "your credit lines");
  const by: ChartBy = /^\w{3} \d{1,2}$/.test(steps[0]?.label ?? "") ? "day" : "month";
  const span = window ? window.name : `${monthName(from.slice(0, 7))} to today`;
  return {
    title: `Owed on ${who} by ${by}, ${span}`,
    by,
    kind: "line",
    rows: rows.map((r) => ({ ...r, share: Math.max(0, r.value) / top })),
    total: rows[rows.length - 1]?.value ?? 0,
    othersCount: 0,
    measure: "owed",
    ...(end === asOf ? { running: true } : {}),
    ...(later.length > 0 ? { ahead: later.length } : {}),
  };
}

// ── The months ahead ────────────────────────────────────────────────────────

const MONTH_WORDS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const COUNT_WORDS: Readonly<Record<string, number>> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, few: 3, "couple of": 2, couple: 2,
};

/**
 * The months a forecast is asked for, as month numbers counted from year 0
 * (`year * 12 + month - 1`), oldest first. "past" when every month named has
 * already ended: a forecast is of a month still to come.
 *
 * Next month when none is said. A month named without a year is its next
 * one from today ("december" in November is this December, "march" is next
 * year's). "the next 3 months", "the coming months", "the rest of the year",
 * "next year" and "december to february" are each a run of months.
 */
export function forecastMonths(question: string, asOf: IsoDate): number[] | "past" {
  const q = question.toLowerCase();
  const y = Number(asOf.slice(0, 4));
  const now = y * 12 + Number(asOf.slice(5, 7)) - 1;
  const run = (from: number, count: number): number[] => Array.from({ length: Math.max(1, Math.min(12, count)) }, (_, i) => from + i);

  const counted = /\b(?:next|coming|upcoming|following)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|couple(?: of)?)\s+months?\b/.exec(q);
  if (counted?.[1]) return run(now + 1, /^\d+$/.test(counted[1]) ? Number(counted[1]) : (COUNT_WORDS[counted[1]] ?? 3));
  if (/\b(?:the\s+)?(?:coming|upcoming)\s+months\b|\bmonths\s+(?:ahead|to come)\b|\bnext\s+quarter\b/.test(q)) return run(now + 1, 3);
  if (/\brest of (?:the|this) year\b/.test(q)) return run(now + 1, 11 - (now % 12) || 1);
  if (/\bnext year\b/.test(q)) return run((y + 1) * 12, 12);

  // Month names, each at its next coming, with a year when one is said beside it.
  const named: number[] = [];
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(20\d{2}))?\b/g;
  for (let m = re.exec(q); m; m = re.exec(q)) {
    const word = m[0];
    // "may" is a month only beside a year or a word for one ("in may", "for may"), not "may I".
    if (m[1] === "may" && !m[2] && !/\b(?:in|for|of|on|by|until|till|to|from|this|next|last)\s+may\b/.test(q)) continue;
    // Only whole month words: "mart" or "decent" are not months.
    if (!/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:\s+20\d{2})?$/.test(word)) continue;
    const month = MONTH_WORDS.indexOf(m[1] as (typeof MONTH_WORDS)[number]);
    /*
     * Without a year, a month this year that ended in the last six is that
     * month ("october" said in November is the October just gone, which has
     * no forecast); one further back is next year's ("march" in November).
     */
    const thisYear = y * 12 + month;
    const index = m[2] ? Number(m[2]) * 12 + month : thisYear >= now || now - thisYear <= 6 ? thisYear : (y + 1) * 12 + month;
    named.push(index);
  }
  let months: number[];
  if (named.length >= 2 && /\b(?:to|through|thru|until|till)\b|\s-\s/.test(q)) {
    const from = named[0] as number;
    let to = named[named.length - 1] as number;
    while (to < from) to += 12;
    months = run(from, to - from + 1);
  } else if (named.length > 0) {
    months = [...new Set(named)].sort((a, b) => a - b);
  } else {
    months = [now + 1];
  }
  const ahead = months.filter((i) => i >= now);
  return ahead.length === 0 ? "past" : ahead;
}

const nameOfIndex = (index: number): string => `${MONTHS[index % 12]} ${Math.floor(index / 12)}`;

/**
 * The months ahead, drawn as the Budget screen plans them (`outlook.ts`):
 * each item at its usual month, bills at their latest amount, what a usual
 * month brings in, and the debt payments due. The same figures the chat is
 * given in words, so the chart and the answer it was asked after agree.
 *
 * One month is drawn by item; several are drawn month by month beside the
 * income a usual month brings in. Null when there is no history to plan
 * from, or every month asked about has already ended.
 */
export function buildForecastChart(
  question: string,
  transactions: readonly Transaction[],
  budgets: Budgets,
  asOf: IsoDate,
  options: {
    readonly stopped?: readonly { readonly name: string; readonly since: IsoDate }[];
    readonly debts?: readonly Debt[];
    /**
     * The Planner's plans due in a month. "Will December be short?" was
     * answered "not short", with money left, from the usual month alone,
     * with a plan of December's on the Planner that made it short
     * (10 November 2026).
     */
    readonly plansIn?: (year: number, month: number) => readonly { readonly name: string; readonly amount: number }[];
  } = {},
): Chart | null {
  const months = forecastMonths(question, asOf);
  if (months === "past") return null;
  const now = Number(asOf.slice(0, 4)) * 12 + Number(asOf.slice(5, 7)) - 1;
  const next = { year: Math.floor((now + 1) / 12), month: ((now + 1) % 12) + 1 };
  const plans: MonthOutlook[] = months.map((index) =>
    outlookFor(transactions, budgets, Math.floor(index / 12), (index % 12) + 1, asOf, {
      ...(options.stopped ? { stopped: options.stopped } : {}),
      ...(options.debts ? { debts: options.debts } : {}),
      ...(options.plansIn ? { planned: options.plansIn(Math.floor(index / 12), (index % 12) + 1) } : {}),
      // Every month ahead read from the same months, as the Budget screen does; the month running from the ones before it.
      ...(index > now ? { readBefore: next } : {}),
    }),
  );
  const first = plans[0];
  if (!first || first.read.length === 0 || first.total <= 0) return null;
  const readFrom = monthsRead(first.read);
  const shape: ChartKind = /\b(?:pie|donut|doughnut|circle)\b/i.test(question) ? "pie" : "bars";

  if (plans.length === 1) {
    const a = first.advice;
    const parts = new Map<string, number>();
    const put = (label: string, value: number): void => {
      if (value > 0) parts.set(label, (parts.get(label) ?? 0) + value);
    };
    for (const l of a.items) put(l.name, l.amount);
    for (const l of a.planned ?? []) put(`${l.name} (plan)`, l.amount);
    put("Transfer fees", a.fees);
    put("Debt interest", a.interest);
    for (const l of [...a.bills, ...a.subscriptions]) put(l.name, l.amount);
    // Whatever the parts leave of the month's figure, so the rows always add up to it.
    const counted = [...parts.values()].reduce((sum, v) => sum + v, 0);
    if (first.total - counted > 0) put("Other", first.total - counted);
    const sorted = [...parts.entries()].sort((x, y) => y[1] - x[1]);
    // The nine largest, and the rest together, so the rows still add up to the month.
    const keep = sorted.length > 10 ? sorted.slice(0, 9) : sorted;
    const rest = sorted.slice(keep.length);
    const listed = rest.length > 0 ? [...keep, [`The other ${rest.length} items`, rest.reduce((sum, [, v]) => sum + v, 0)] as [string, number]] : keep;
    const top = Math.max(...listed.map(([, v]) => v), 1);
    const rows: ChartRow[] = listed.map(([label, value]) => ({ label, value, share: value / top, count: 0 }));
    return {
      title: `${first.name} forecast by item`,
      by: "item",
      kind: shape,
      rows,
      total: listed.reduce((sum, [, v]) => sum + v, 0),
      othersCount: 0,
      direction: "spending",
      measure: "forecast",
      plan: {
        income: first.income,
        debtDue: first.debtDue,
        left: first.left,
        budget: first.budget.total,
        readFrom,
        name: first.name,
        ...(months[0] === now ? { running: true } : {}),
      },
    };
  }

  const top = Math.max(...plans.map((o) => Math.max(o.total, o.income)), 1);
  const rows: ChartRow[] = plans.map((o) => ({ label: o.name, value: o.total, share: o.total / top, count: 0, previous: o.income, previousShare: o.income / top }));
  const sum = (f: (o: MonthOutlook) => number): number => plans.reduce((s, o) => s + f(o), 0);
  const name = monthsSaid(plans);
  return {
    title: `${name} forecast by month`,
    by: "month",
    kind: shape === "pie" ? "pie" : /\b(?:line|trend|curve)\b/i.test(question) ? "line" : "bars",
    rows,
    total: sum((o) => o.total),
    othersCount: 0,
    direction: "spending",
    measure: "forecast",
    against: { name: "Usual income", total: sum((o) => o.income), now: "Usual month" },
    plan: { income: sum((o) => o.income), debtDue: sum((o) => o.debtDue), left: sum((o) => o.left), budget: sum((o) => o.budget.total), readFrom, name: name || nameOfIndex(months[0] as number) },
  };
}

/**
 * The month's allocations, each one's spending beside what it holds: the
 * figures the Budget screen's Allocations card shows (`monthAllocations`).
 * Only the lines a question names, when it names some ("chart the gym
 * allocation"); every line otherwise. A line marked done holds only what it
 * spent up to that day. Null when the month has none.
 */
export function buildAllocationChart(month: MonthAllocations, named: readonly string[] = []): Chart | null {
  const own = month.lines.filter((l) => !l.twinOf);
  const picked = named.length > 0 ? own.filter((l) => named.includes(l.line.id)) : own;
  const lines = picked.length > 0 ? picked : own;
  if (lines.length === 0) return null;
  const holds = (l: AllocationStatus): number => (l.done ? l.spent : l.line.amount);
  const top = Math.max(...lines.map((l) => Math.max(l.spent, holds(l))), 1);
  const rows: ChartRow[] = lines.map((l) => ({
    label: l.name,
    value: l.spent,
    share: l.spent / top,
    count: l.entries,
    previous: holds(l),
    previousShare: holds(l) / top,
  }));
  const allocated = lines.reduce((sum, l) => sum + holds(l), 0);
  const [y, m] = [Number(month.month.slice(0, 4)), Number(month.month.slice(5, 7))];
  return {
    title: `${lines.length === 1 ? `${lines[0]?.name ?? ""} allocation` : "Allocations"}, ${MONTHS[m - 1] ?? ""} ${y}`,
    by: "item",
    kind: "bars",
    rows,
    total: rows.reduce((sum, r) => sum + r.value, 0),
    othersCount: 0,
    direction: "spending",
    measure: "allocation",
    against: { name: "Allocated", total: allocated, now: "Spent" },
    ...(month.phase === "running" ? { running: true } : {}),
  };
}

/**
 * Where the spending wallets' money stands: what is still due out of it
 * (bills, debt payments, plans, allocations) and what is safe to spend, the
 * Dashboard's own figures (`monthBrief`), so "how much can I spend", then
 * "show that in a chart", draws the answer rather than a month of spending.
 * The parts add up to what the wallets hold. When they hold less than is
 * due, the shortfall is said and safe to spend is nothing.
 */
export function buildSafeChart(
  safe: Pick<SafeToSpend, "wallets" | "reservedBills" | "reservedDebt" | "reservedPlans" | "reservedAllocations" | "free" | "safe" | "daysLeft" | "perDay">,
  ym: string,
  pie = false,
): Chart | null {
  if (safe.wallets <= 0) return null;
  const parts: [string, number][] = [
    ["Bills still to pay", safe.reservedBills],
    ["Debt payments due", safe.reservedDebt],
    ["Plans", safe.reservedPlans],
    ["Allocations", safe.reservedAllocations ?? 0],
  ];
  const due = parts.reduce((sum, [, v]) => sum + v, 0);
  // When the wallets cannot cover what is due, each part is cut down in order, so the parts still add up to the wallets.
  let room = safe.wallets;
  const kept = parts.map(([label, v]) => {
    const take = Math.max(0, Math.min(v, room));
    room -= take;
    return [label, take] as [string, number];
  });
  const rows0: [string, number][] = [...kept.filter(([, v]) => v > 0), ["Safe to spend", Math.max(0, safe.free)]];
  const top = Math.max(...rows0.map(([, v]) => v), 1);
  return {
    title: `Safe to spend, ${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ""} ${ym.slice(0, 4)}`,
    by: "item",
    kind: pie ? "pie" : "bars",
    rows: rows0.map(([label, value]) => ({ label, value, share: value / top, count: 0 })),
    total: safe.wallets,
    othersCount: 0,
    measure: "safe",
    plan: { income: 0, debtDue: safe.reservedDebt, left: safe.free, budget: due, readFrom: "", name: `${safe.daysLeft} ${safe.daysLeft === 1 ? "day" : "days"} left, ${chartLabel(safe.perDay)} today` },
  };
}

/**
 * Why a forecast drew nothing, in a sentence: every month asked about has
 * ended, or there is no history to plan from.
 */
export function forecastEmptyWords(question: string, asOf: IsoDate): string {
  const months = forecastMonths(question, asOf);
  if (months === "past") return "That month has ended, so it has no forecast. Ask what it spent, or ask for a month still to come, like \"forecast for next month\".";
  return "There are no months of spending yet to plan from. The forecast needs at least one month that has ended.";
}

/** Whichever level or budget the hint names, built; null when it names none or there is nothing to draw. */
export function buildMeasureChart(
  question: string,
  hint: ChartHint | null,
  data: {
    readonly transactions: readonly Transaction[];
    readonly budgets: Budgets;
    readonly reference: Pick<ReferenceLists, "wallets" | "savings">;
    readonly debts: readonly Debt[];
    readonly asOf: IsoDate;
    /** Bills and subscriptions marked stopped, which a forecast leaves out as the Budget screen does. */
    readonly stopped?: readonly { readonly name: string; readonly since: IsoDate }[];
    /** The month's allocations, as Budget shows them, and the lines the question names. */
    readonly allocations?: { readonly month: MonthAllocations; readonly named: readonly string[] };
    /** The Dashboard's safe to spend this month, for a chart of it. */
    readonly safe?: SafeToSpend | null;
    /** The Planner's plans due in a month, for a forecast (`buildForecastChart`). */
    readonly plansIn?: (year: number, month: number) => readonly { readonly name: string; readonly amount: number }[];
  },
): Chart | null {
  const measure = measureOf(hint);
  if (measure === "safe") return data.safe ? buildSafeChart(data.safe, data.asOf.slice(0, 7), /\b(?:pie|donut|doughnut|circle)\b/i.test(question)) : null;
  if (measure === "allocation") return data.allocations ? buildAllocationChart(data.allocations.month, data.allocations.named) : null;
  if (measure === "forecast") return buildForecastChart(question, data.transactions, data.budgets, data.asOf, { stopped: data.stopped ?? [], debts: data.debts, ...(data.plansIn ? { plansIn: data.plansIn } : {}) });
  if (measure === "budget") return buildBudgetChart(question, data.transactions, data.budgets, data.asOf);
  if (measure === "balance") {
    return buildBalanceChart(question, data.transactions, data.reference, data.asOf, hint?.by === "wallet" || PER_ACCOUNT.test(question));
  }
  if (measure === "owed") return buildOwedChart(question, data.transactions, data.debts, data.asOf);
  return null;
}

// ── What a chart says ───────────────────────────────────────────────────────

// Honestly rounded: "under 1%", "over 99%" (`percentOf`).
const percent = (part: number, whole: number): string => percentOf(part, whole);

const UNIT: Readonly<Record<ChartBy, string>> = {
  item: "item",
  category: "category",
  wallet: "account",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

/**
 * The chart in a sentence or two, worked out here from its own rows.
 *
 * The owner asked for this twice before it existed: "good but it lacks of
 * visuals and explanation" (5 September 2026) and "I want chart and trend at
 * the same time with proper explanation" (31 August). A chart says the
 * shape; this says what the shape means: which part is largest and by how
 * much, where a trend peaked, how two periods differ, where a budget broke.
 * A period still running is called that, so three days of October are never
 * read as a quiet month.
 */
export function chartReading(chart: Chart): string {
  const rows = chart.rows;
  if (rows.length === 0) return "";
  const m = chartLabel;
  const last = rows[rows.length - 1] as ChartRow;
  // "in May 2026", "on Oct 3", "in the week of Sep 21": a period named the way a sentence takes it.
  const when = (label: string): string => (chart.by === "day" ? `on ${label}` : chart.by === "week" ? `in the ${label.replace(/^Week/, "week")}` : `in ${label}`);
  const asName = (label: string): string => (chart.by === "week" ? `The ${label.replace(/^Week/, "week")}` : label);
  const lastName = chart.running ? `${asName(last.label)} so far` : asName(last.label);
  const ahead = chart.ahead ? ` Counts ${chart.ahead} ${chart.ahead === 1 ? "entry" : "entries"} dated after today.` : "";

  if (chart.measure === "budget") {
    const budget = chart.against?.total ?? 0;
    if (chart.by === "day") {
      if (budget === 0) return `${m(last.value)} spent by ${last.label}. No budget is set for this month, so there is no pace to measure against.${ahead}`;
      const pace = last.previous ?? 0;
      const gap = pace - last.value;
      const left = budget - last.value;
      return `${m(last.value)} spent by ${last.label}, ${gap >= 0 ? `${m(gap)} under` : `${m(-gap)} over`} a steady pace to the ${m(budget)} budget. ${left >= 0 ? `${m(left)} of it is left.` : `The budget is passed by ${m(-left)}.`}${ahead}`;
    }
    // A month still running is not over or under yet: it is said apart, with what is left of it.
    const finished = chart.running ? rows.slice(0, -1) : rows;
    const withBudget = finished.filter((r) => (r.previous ?? 0) > 0);
    const now = chart.running
      ? (last.previous ?? 0) > 0
        ? ` ${last.label} is still running: ${m(last.value)} of ${m(last.previous ?? 0)} so far${last.value > (last.previous ?? 0) ? ", already over" : ""}.`
        : ` ${last.label} is still running, with no budget set.`
      : "";
    if (withBudget.length === 0) {
      return rows.some((r) => (r.previous ?? 0) > 0) ? `${now.trim()}${ahead}` : "No budget is set for these months, so there is nothing to measure against. Ask me to set one.";
    }
    const over = withBudget.filter((r) => r.value > (r.previous ?? 0));
    const worst = [...over].sort((a, b) => b.value - (b.previous ?? 0) - (a.value - (a.previous ?? 0)))[0];
    const head =
      over.length === 0
        ? `Within the budget in every month that has one (${withBudget.length}).`
        : `Over the budget in ${over.length} of ${withBudget.length} ${withBudget.length === 1 ? "month" : "months"} with one${worst ? `; ${worst.label} by the most, ${m(worst.value - (worst.previous ?? 0))} over` : ""}.`;
    return `${head}${now}${ahead}`;
  }

  if (chart.measure === "upcoming" && chart.upcoming) {
    const u = chart.upcoming;
    const parts = [
      u.plans > 0 ? `${m(u.plans)} in plans${u.noDate > 0 ? ` (${m(u.noDate)} of it with no date yet)` : ""}` : "",
      u.bills > 0 ? `${m(u.bills)} of bills and subscriptions this month` : "",
      u.allocations > 0 ? `${m(u.allocations)} still held in allocations` : "",
      u.debts > 0 ? `${m(u.debts)} of debt payments due` : "",
    ].filter(Boolean);
    const top = rows[0] as ChartRow;
    return `${m(chart.total)} is still to come: ${parts.join(", ")}. ${top.label} is the largest, ${m(top.value)}.`;
  }

  if (chart.measure === "safe" && chart.plan) {
    const p = chart.plan;
    const safeRow = rows.find((r) => r.label === "Safe to spend");
    const short = p.left < 0 ? ` The wallets are ${m(-p.left)} short of what is still due, so nothing is safe to spend.` : "";
    return `The spending wallets hold ${m(chart.total)}. ${m(p.budget)} of it is still due this month${short ? "" : `, which leaves ${m(safeRow?.value ?? 0)} safe to spend`} (${p.name}).${short}`;
  }

  if (chart.measure === "allocation") {
    const over = rows.filter((r) => r.value > (r.previous ?? 0));
    const allocated = chart.against?.total ?? 0;
    const left = rows.reduce((sum, r) => sum + Math.max(0, (r.previous ?? 0) - r.value), 0);
    const head = `${m(chart.total)} spent of ${m(allocated)} allocated${chart.running ? ", with the month still running" : ""}.`;
    const overs = over.length > 0 ? ` ${over.map((r) => `${r.label} is ${m(r.value - (r.previous ?? 0))} over`).join("; ")}.` : "";
    const most = [...rows].filter((r) => r.value <= (r.previous ?? 0)).sort((a, b) => (b.previous ?? 0) - b.value - ((a.previous ?? 0) - a.value))[0];
    return `${head}${overs}${left > 0 ? ` ${m(left)} is left${most && rows.length > 1 ? `, most of it in ${most.label}, ${m((most.previous ?? 0) - most.value)}` : ""}.` : ""}`;
  }

  if (chart.measure === "forecast" && chart.plan) {
    const p = chart.plan;
    // A bundle of the smaller ones is not an item: "The other 8 items is the largest" (10 November 2026).
    const top = ([...rows].filter((r) => !/^(?:the other \d+ items|other(?: \(\d+\))?)$/i.test(r.label)).sort((a, b) => b.value - a.value)[0] ?? rows[0]) as ChartRow;
    const after = p.left >= 0 ? `which leaves about ${m(p.left)}` : `which is ${m(-p.left)} short`;
    const debt = p.debtDue > 0 ? ` after ${m(p.debtDue)} of debt payments due` : "";
    const budget =
      p.budget > 0
        ? ` The budget set is ${m(p.budget)}${p.budget < chart.total ? `, ${m(chart.total - p.budget)} under the forecast` : ", which covers it"}.`
        : ` No budget is set for ${rows.length > 1 && chart.by !== "item" ? "them" : "it"} yet.`;
    if (chart.by === "item") {
      const running = p.running ? ` ${p.name} is already running: this is its usual month, not what it has spent.` : "";
      return `${p.name} should cost about ${m(chart.total)}, going by your usual month; ${top.label} is the largest, ${m(top.value)}. A usual month brings in ${m(p.income)}, ${after}${debt}.${budget}${running}`;
    }
    const high = rows.reduce((a, b) => (b.value > a.value ? b : a), top);
    const same = rows.every((r) => r.value === rows[0]?.value);
    return `About ${m(chart.total)} across ${rows.length} months, going by your usual month${same ? `, ${m(high.value)} each` : `; ${high.label} the most, ${m(high.value)}`}. A usual month brings in ${m(Math.round(p.income / rows.length))}, ${m(p.income)} in all, ${after}${debt}.${budget}`;
  }

  // A level is read at the end of a month, and on a day.
  const at = (label: string): string => (chart.by === "day" ? `on ${label}` : `at the end of ${label}`);

  if (chart.measure === "balance") {
    if (chart.by === "wallet") {
      const top = rows[0] as ChartRow;
      const below = rows.filter((r) => r.value < 0);
      return `${top.label} holds the most, ${m(top.value)}${chart.total > 0 && rows.length > 1 ? `, ${percent(top.value, chart.total)} of the ${m(chart.total)} across these accounts` : ""}.${below.length > 0 ? ` ${below.map((r) => r.label).join(" and ")} ${below.length === 1 ? "is" : "are"} below zero.` : ""}${ahead}`;
    }
    const firstRow = rows[0] as ChartRow;
    const moved = last.value - firstRow.value;
    const low = rows.reduce((a, b) => (b.value < a.value ? b : a), firstRow);
    const lowNote = rows.length > 2 && low !== firstRow && low !== last ? ` Lowest ${at(low.label)}, ${m(low.value)}.` : "";
    return `${m(last.value)} now, ${moved === 0 ? "the same as" : `${moved > 0 ? "up" : "down"} ${m(Math.abs(moved))} from`} ${m(firstRow.value)} ${at(firstRow.label)}.${lowNote}${ahead}`;
  }

  if (chart.measure === "owed") {
    const firstRow = rows[0] as ChartRow;
    const peak = rows.reduce((a, b) => (b.value > a.value ? b : a), firstRow);
    const now = last.value <= 0 ? "Nothing owed now: it is paid off." : `${m(last.value)} owed now.`;
    const was = peak.value > last.value ? ` The most owed was ${m(peak.value)}, ${at(peak.label)}.` : "";
    return `${now}${was}${ahead}`;
  }

  if (chart.against) {
    const moved = chart.total - chart.against.total;
    const mover = [...rows].sort((a, b) => Math.abs(b.value - (b.previous ?? 0)) - Math.abs(a.value - (a.previous ?? 0)))[0];
    const change = mover ? mover.value - (mover.previous ?? 0) : 0;
    const head = moved === 0 ? `The same as ${chart.against.name}.` : `${m(Math.abs(moved))} ${moved > 0 ? "more" : "less"} than ${chart.against.name}.`;
    return mover && change !== 0 ? `${head} The biggest change is ${mover.label}, ${change > 0 ? "up" : "down"} ${m(Math.abs(change))}.` : head;
  }

  if (overTime(chart.by)) {
    const unit = UNIT[chart.by];
    /*
     * A pie's "Other months" slice is many months, not one: it is no high,
     * no low and no last month. "Other months is PHP 37,458.87 above that"
     * was said of five months together (owner's chat, 3 November 2026).
     */
    const dated = rows.filter((r) => !/^Other\b/i.test(r.label));
    if (dated.length > 0 && dated.length < rows.length) {
      // Only what the slices can stand behind: the smaller periods are inside "Other", so no lowest and no average is said.
      const folded = rows.filter((r) => /^Other\b/i.test(r.label)).reduce((sum, r) => sum + r.value, 0);
      const top = dated.reduce((a, b) => (b.value > a.value ? b : a));
      return `The ${dated.length} largest ${unit}s have slices of their own. ${when(top.label).replace(/^in /, "")} is the largest, ${m(top.value)}, ${percent(top.value, chart.total)} of the ${m(chart.total)} total. The other ${unit}s together are ${m(folded)}.`;
    }
    if (!rows.some((r) => r.value > 0)) return "";
    if (rows.length === 1) return `${lastName}: ${m(last.value)}.`;
    // Two periods are a comparison: the second against the first, said once.
    if (rows.length === 2) {
      const firstRow = rows[0] as ChartRow;
      const moved = last.value - firstRow.value;
      return moved === 0
        ? `${lastName} is the same as ${asName(firstRow.label).replace(/^The /, "the ")}, ${m(last.value)}.`
        : `${lastName} is ${m(Math.abs(moved))} ${moved > 0 ? "more" : "less"} than ${asName(firstRow.label).replace(/^The /, "the ")} (${m(last.value)} against ${m(firstRow.value)}).`;
    }
    // A period still running is not a low: it is left out of the high, the low and the average.
    // Nor is a first period the records start partway through (`partialFirst`).
    const partial = chart.partialFirst && rows[0]?.label === chart.partialFirst.label ? chart.partialFirst : null;
    const whole = (chart.running ? rows.slice(0, -1) : rows).slice(partial ? 1 : 0);
    const counted = whole.filter((r) => r.value > 0);
    if (counted.length === 0) return `${lastName}: ${m(last.value)}.`;
    const high = counted.reduce((a, b) => (b.value > a.value ? b : a));
    const low = counted.reduce((a, b) => (b.value < a.value ? b : a));
    const average = Math.round(whole.reduce((s, r) => s + r.value, 0) / Math.max(whole.length, 1));
    const word = chart.direction === "revenue" ? "in" : "spent";
    const parts = [`Highest ${when(high.label)}, ${m(high.value)}${low !== high ? `; lowest ${when(low.label)}, ${m(low.value)}` : ""}.`];
    const empty = whole.filter((r) => r.value === 0);
    const days = chart.by === "day" && empty.length > 0;
    parts.push(
      days
        ? `Money ${chart.direction === "revenue" ? "came in" : "went out"} on ${whole.length - empty.length} of ${whole.length} days, ${m(average)} a day on average.`
        : `${m(average)} ${word} a ${unit} on average.`,
    );
    if (chart.running) {
      /*
       * Already past every whole one, though not over: "Highest in 2023" was
       * said of a chart whose running 2026 was a third above it
       * (10 November 2026).
       */
      parts.push(
        last.value > high.value
          ? `${lastName}, ${m(last.value)}, is already more than any whole ${unit} before it, and it is not over.`
          : `${lastName}: ${m(last.value)}.`,
      );
    } else if (last.value !== average) {
      parts.push(`${asName(last.label)} is ${m(Math.abs(last.value - average))} ${last.value > average ? "above" : "below"} that.`);
    }
    if (partial) parts.push(`${partial.label} starts on ${formatMedium(partial.from)}, when your records begin, so it is not a whole ${unit} and is left out of the highest, the lowest and the average.`);
    // A month with nothing in it is part of the line, so it is said, not left for the eye to find.
    if (!days && empty.length > 0) {
      parts.push(empty.length <= 2 ? `Nothing ${empty.map((r) => when(r.label)).join(" or ")}.` : `Nothing in ${empty.length} of the ${whole.length} ${unit}s.`);
    }
    return parts.join(" ");
  }

  const top = rows[0] as ChartRow;
  if (rows.length === 1) return `All of it is ${top.label}: ${m(top.value)} over ${top.count} ${top.count === 1 ? "entry" : "entries"}.`;
  const share = percent(top.value, chart.total);
  const threeShare = percent(rows.slice(0, 3).reduce((s, r) => s + r.value, 0), chart.total);
  const three = rows.length > 3 ? ` The top three make up ${threeShare}.` : "";
  return `${top.label} is the largest, ${m(top.value)}, ${share} of the ${m(chart.total)} total.${three}`;
}

/**
 * The charts drawn for a question, as figures the model must answer with.
 *
 * "your description and the chart doesnt match fix the chart" (5 September
 * 2026): the model answered from its own reading while the chart drew the
 * device's. Now the model is handed the chart's own figures, said to be the
 * ones on screen, so the words and the picture are one answer.
 */
export function chartsWorked(charts: readonly Chart[], inWordsOf: (c: Chart) => string): string {
  if (charts.length === 0) return "";
  return [
    `The app drew ${charts.length === 1 ? "this chart" : "these charts"} just above your answer, from the ledger. ${charts.length === 1 ? "Its" : "Their"} figures are correct and are what the owner is looking at: answer with them, refer to the chart where it helps, never describe a different chart, and never say a chart cannot be drawn.`,
    ...charts.map((c) => `${c.title}: ${inWordsOf(c)} ${chartReading(c)}${c.scope ? ` ${c.scope}` : ""}`.trim()),
  ].join("\n");
}
