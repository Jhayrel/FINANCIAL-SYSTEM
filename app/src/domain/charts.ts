/**
 * Turning "show me a chart" into something to look at.
 *
 * ── Why bars and not a pie ────────────────────────────────────────────────
 *
 * The panel is 280px wide. A pie of a month's spending has a dozen slices in
 * it, most of them a few degrees across, and reading one means a legend, and
 * a legend in that column is a list of labels beside a circle nobody can
 * read. Horizontal bars are the same information sorted, with the figure
 * printed next to each one, and they stay legible at any width.
 *
 * It also keeps the design contract intact. Flow colour means direction of
 * money in this app (rule D3), so a chart cannot spend colour on telling
 * slices apart: length carries the comparison and a single ink does the rest.
 *
 * ── Why the totals are computed here ──────────────────────────────────────
 *
 * Same reason as everywhere else in this codebase: integer centavos, summed
 * in TypeScript, never by a model. A chart is a claim about figures, and a
 * wrong bar is a wrong figure drawn large.
 */

import { toPesos } from "./money";
import { editsBetween } from "./nearly";
import { costOf, incomeOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

export type ChartBy = "item" | "month" | "wallet" | "category" | "day";

/**
 * How to draw it.
 *
 * `bars` is the default because it is the one that always works: it stays
 * legible at 280px, at any number of rows, and without colour. The others are
 * offered when they are asked for and when the data suits them.
 *
 * `pie` is a share of a whole, so it is only honest for a grouping that adds
 * up to something: spending by item does, spending across months does not.
 * `line` is a series over time, so it only means anything grouped by month.
 */
export type ChartKind = "bars" | "pie" | "line";

export interface ChartRow {
  readonly label: string;
  /** Integer centavos. */
  readonly value: number;
  /** 0 to 1, of the largest row, for the bar length. */
  readonly share: number;
  readonly count: number;
}

export interface Chart {
  readonly title: string;
  readonly by: ChartBy;
  readonly kind: ChartKind;
  readonly rows: readonly ChartRow[];
  /** Integer centavos. */
  readonly total: number;
  /** What was left out, when there was more than fits. */
  readonly othersCount: number;
  /**
   * Money in or money out, which decides the colour (rule D3): income green,
   * spending red. Absent on charts stored before it existed, which read it
   * from the title.
   */
  readonly direction?: "spending" | "revenue" | undefined;
}

/** Which way the money in a chart went, including charts stored before it was recorded. */
export function chartDirection(chart: Chart): "spending" | "revenue" {
  return chart.direction ?? (/^income\b/i.test(chart.title) ? "revenue" : "spending");
}

/**
 * Asking to see something rather than be told it.
 *
 * "trend" and "over time" were missing, and the cost of that was not a
 * missing chart. It was the assistant denying it could draw one at all:
 * "Charts do not exist in the data I have", and later "I cannot make charts
 * or graphs here, only plain text". The owner replied that it had come out
 * wrong, and they were right. This app draws charts perfectly well; the
 * request never reached the part that draws them, so it went to a model that
 * can only write sentences and answered honestly about itself.
 *
 * A word here is worth more than a line of prompt telling a model not to say
 * something true about itself.
 */
const WANTS_CHART =
  /\b(chart|graph|pie|bar|bars|breakdown|break down|visual|visuals|visuali[sz]e|plot|show me|diagram|trend|trends|trending|over time|shape of)\b/i;

/** Asking for the written version. */
const WANTS_REPORT = /\b(report|summary|summarise|summarize|overview|statement)\b/i;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** More than this in a 280px column is a list, not a chart. */
const MOST_ROWS = 8;

const monthOf = (date: IsoDate): string => date.slice(0, 7);

const monthName = (ym: string): string =>
  `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

/**
 * What counts as spending: the app's own definition, not a second one.
 *
 * This file had its own, and it over-counted 2026 by PHP 13,128.00 by
 * counting Spending rows whose category is blank and ignoring debt interest.
 * A chart that disagrees with the Insights screen about the year is worse
 * than no chart, so there is one definition and `charts.test.ts` asserts that
 * every chart's total equals `totalsFor(...).total` for the same window.
 */
const spendingOf = costOf;

/**
 * Money in, using the app's own definition of it.
 *
 * `totalsFor` counts a Revenue row unless its category is Opening: an opening
 * row is money you already had on the day you started counting, it credits
 * the wallet, and it is not income. The Excel had no such category and booked
 * PHP 953.89 of carried balance as 2026 earnings.
 *
 * Copied in shape, not in code, for the same reason `spendingOf` is `costOf`:
 * a chart that disagrees with the Insights screen about the year is worse
 * than no chart. `chartAccuracy.test.ts` asserts the two agree.
 */
const revenueOf = incomeOf;

/**
 * Which direction of money the question is about.
 *
 * ── The chart that answered backwards ─────────────────────────────────────
 *
 * "chart my income this year" drew "Spending by item", and so did "chart my
 * revenue per month" and "show me earnings by month". Every chart in this
 * file counted spending, because nothing ever asked which direction was
 * wanted, and the answer was not merely imprecise: it was the other one.
 *
 * Spending stays the default. It is what almost every question is about, and
 * a chart of income is asked for in words that say so.
 *
 * ── Said with a typo ──────────────────────────────────────────────────────
 *
 * "chart my revenu by month" drew Spending, the opposite of what was asked,
 * because one missing letter matched nothing. "income", "revenue" and
 * "salary" are now matched one letter off, or with two letters swapped
 * ("reveneu"), as whole words of five letters or more. "earnings" is left
 * out on purpose: one letter from it are "earrings" and "warnings", and a
 * chart of what earrings cost is a chart of spending.
 *
 * "receipts" is no longer a word for income. Here a receipt is the slip from
 * a purchase, the thing photographed for the chat, so "chart my receipts"
 * reading as income was backwards.
 */
function directionOf(question: string): "spending" | "revenue" {
  /*
   * "positive" is the owner's own word for it.
   *
   * On their screen, 26 September 2026: "show my in chart all my
   * positive spending?" and, under the spending chart that came back,
   * "//why it didnt show my my positive spending etc". Nothing in the
   * list said money in, so the chart drew money out and looked like it
   * had ignored the question.
   *
   * The Tagalog words are the ones with only the one meaning.
   * "natanggap" is received and "pumasok" is came in. Bare "kita" is
   * left out: it is earnings in one sentence and "see you" in the next,
   * and a chart drawn from the wrong half of that is worse than a chart
   * that asked.
   */
  if (
    /\b(income|revenue|earned|earnings|earning|salary|allowance|received|receiving|money in|inflow|coming in|came in|cash in|positive|gain|gains|deposit|deposits|deposited|natanggap|kinita|pumasok)\b/i.test(
      question,
    )
  ) {
    return "revenue";
  }
  return question
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => word.length >= 5 && MONEY_IN_WORDS.some((w) => editsBetween(word, w, 1) <= 1 || swappedOnce(word, w)))
    ? "revenue"
    : "spending";
}

const MONEY_IN_WORDS = ["income", "revenue", "salary"] as const;

/** The same letters with one neighbouring pair the wrong way round. */
function swappedOnce(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const at = [...a].findIndex((c, i) => c !== b[i]);
  return at >= 0 && at < a.length - 1 && a[at] === b[at + 1] && a[at + 1] === b[at] && a.slice(at + 2) === b.slice(at + 2);
}

/**
 * Which drawing the question asked for, and whether it suits the data.
 *
 * A pie of twelve months is meaningless: the months are a series, not slices
 * of one thing, and drawing them as a circle says they add up to a year in a
 * way nobody reads. A line of spending by item is worse: it draws a trend
 * across categories that have no order. So a request that does not suit the
 * grouping falls back to bars rather than drawing something wrong prettily.
 */
function kindOf(question: string, by: ChartBy): ChartKind {
  if (/\b(pie|donut|doughnut|circle)\b/i.test(question)) {
    /**
     * A pie of months, when a pie is what was asked for.
     *
     * This used to answer a pie request across months with bars, on the
     * reasoning that months are not a share of a whole. They are: the months
     * in a window partition that window, and they add up to exactly the total
     * printed on the card, which is the test a pie has to pass.
     *
     * Changed at the owner's request on 2026-09-16, after asking for a pie
     * chart and being given bars twice.
     */
    return "pie";
  }
  // Bars asked for by name are bars, over months and days as well.
  if (/\b(bars?|bar chart|bar graph|columns?)\b/i.test(question)) return "bars";
  if (/\b(line|trend|over time|curve|movement|progression)\b/i.test(question)) {
    return by === "month" || by === "day" ? "line" : "bars";
  }
  // A question about months or days is a series whether or not it says so.
  return by === "month" || by === "day" ? "line" : "bars";
}

/** Which grouping the question asked for. Item is the useful default. */
/**
 * Two months named, and a word that puts them side by side.
 *
 * ── The chart this fixes ──────────────────────────────────────────────────
 *
 * "how did august compare with july" drew "Spending by item, July 2026".
 * One month, the wrong one, broken down by item: not a comparison at all.
 *
 * Two things went wrong together. The range rule needs a word between the
 * months, and its list was "to, through, until, till, and, thru", none of
 * which is how anybody phrases a comparison. So the range was missed, and
 * the fallback below takes the first month it finds in calendar order, which
 * for August and July is July.
 *
 * A comparison is a chart with one bar per month, so it has to decide the
 * grouping as well as the window. Nothing further down can work that out: by
 * the time the window is chosen the question has become two dates.
 */
const COMPARING =
  /\b(compare|compared|comparing|comparison|versus|vs|against|difference|differ|better|worse|more than|less than)\b/i;

/** A question putting two named months side by side. */
export function comparesMonths(question: string): boolean {
  if (!COMPARING.test(question)) return false;
  const found = MONTHS.filter((m) => new RegExp(`\\b${m}\\b`, "i").test(question));
  return found.length > 1;
}

function dimensionOf(question: string): ChartBy {
  /**
   * A comparison of two months is one bar per month.
   *
   * Checked first, because such a question also names two months, and
   * grouping by item inside a two month window answers something else.
   */
  if (comparesMonths(question)) return "month";

  // "daily", "day by day", "per day": one point a day.
  if (/\b(daily|per day|by day|day by day|each day|every day|day to day)\b/i.test(question)) return "day";

  /**
   * "per month", not "this month".
   *
   * "show me a chart of this month" asks for this month broken down, and
   * matching a bare "month" turned it into twelve bars of the whole year.
   * Every phrase that genuinely means across-months is longer than the word.
   */
  if (
    /\b(monthly|per month|by month|month by month|each month|every month|over time|trend|across the months)\b/i.test(
      question,
    )
  ) {
    return "month";
  }
  /**
   * "by wallet", not "in maya".
   *
   * This used to match a bare `gcash|maya|cash`, so "chart my maya spending
   * this year" grouped by wallet and drew all three of them, total included.
   * Naming one account is a filter, not a grouping, and it is handled by
   * `focusOf` now. The account names were also hardcoded here, so "chart my
   * reserved fund" matched nothing at all.
   */
  if (
    /\b(?:by|per|across|each|every|between|which)\s+(?:wallet|wallets|account|accounts)\b/i.test(
      question,
    ) ||
    /\bwallets\b/i.test(question)
  ) {
    return "wallet";
  }
  if (/\b(category|categories|bills|subscriptions)\b/i.test(question)) return "category";
  return "item";
}

/**
 * Whether a sentence names a window at all, as opposed to leaving
 * `windowOf` to fall back to this month.
 */
export const namesWindow = (question: string): boolean =>
  /\b(today|yesterday|week|weeks|month|months|year|quarter|q[1-4]|days?|since|ytd|20\d{2}(?:-\d{2}-\d{2})?|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b|\bthe\s+\d{1,2}(?:st|nd|rd|th)\b/i.test(
    question,
  );

/** The window the question asked about, and what to call it. The same reading the charts use. */
export function windowOf(
  question: string,
  asOf: IsoDate,
): { readonly from: IsoDate; readonly to: IsoDate; readonly name: string } {
  const year = asOf.slice(0, 4);

  /**
   * "this past 3 months", which used to draw one month.
   *
   * "chart about treats this past 3 months" came back as August alone, with
   * every item in it. The period was read by nothing, so it fell through to
   * the default at the bottom of this function, which is the current month.
   *
   * Counted back from the month it is now, inclusive, so three months in
   * August is June, July and August rather than May to July.
   */
  const iso = (d: Date): IsoDate => d.toISOString().slice(0, 10);
  const shift = (from: IsoDate, days: number): IsoDate => {
    const at = new Date(`${from}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return iso(at);
  };
  const lastDay = (ym: string): IsoDate => {
    const at = new Date(`${ym}-01T00:00:00Z`);
    at.setUTCMonth(at.getUTCMonth() + 1);
    at.setUTCDate(0);
    return iso(at);
  };
  const short = (d: IsoDate): string => `${MONTHS[Number(d.slice(5, 7)) - 1]?.slice(0, 3) ?? ""} ${Number(d.slice(8, 10))}`;
  const monthAt = (word: string): number =>
    MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === word.slice(0, 3).toLowerCase());
  const MONTH_WORD = String.raw`(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)`;

  /**
   * ── Any window, said any way ─────────────────────────────────────────────
   *
   * The owner, 26 September 2026: "what if I ask today only, or this week,
   * or a range, all should work". Months, the year and the words for a day
   * or a week were read; a range of days, a count of days, "since August",
   * "last year" and one particular date were not, and each fell through to
   * this month and drew a chart of a different question. Read here, before
   * the month rules, because every one of them also names a month.
   */
  const isoRange = /\b(20\d{2}-\d{2}-\d{2})\s*(?:to|until|till|through|thru|[-\u2010-\u2015])\s*(20\d{2}-\d{2}-\d{2})\b/i.exec(question);
  if (isoRange?.[1] && isoRange[2]) {
    const [from, to] = [isoRange[1], isoRange[2]].sort() as [IsoDate, IsoDate];
    return { from, to, name: `${short(from)} to ${short(to)} ${to.slice(0, 4)}` };
  }

  // "sep 1 to sep 15", "september 1-15", "sept 1 to 15", "oct 28 to nov 3".
  const dayRange = new RegExp(
    String.raw`\b${MONTH_WORD}\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|until|till|through|thru|[-\u2010-\u2015])\s*(?:${MONTH_WORD}\s+)?(\d{1,2})(?:st|nd|rd|th)?\b`,
    "i",
  ).exec(question);
  if (dayRange?.[1] && dayRange[2] && dayRange[4]) {
    const y = /\b(20\d{2})\b/.exec(question)?.[1] ?? year;
    const m1 = monthAt(dayRange[1]) + 1;
    const m2 = dayRange[3] ? monthAt(dayRange[3]) + 1 : m1;
    const from = `${y}-${String(m1).padStart(2, "0")}-${dayRange[2].padStart(2, "0")}`;
    const to = `${y}-${String(m2).padStart(2, "0")}-${dayRange[4].padStart(2, "0")}`;
    const [a, b] = [from, to].sort() as [IsoDate, IsoDate];
    return { from: a, to: b, name: `${short(a)} to ${short(b)} ${y}` };
  }

  // "from the 1st to the 15th", this month.
  const ofThisMonth = /\b(?:from\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\s*(?:to|until|till|through|[-\u2010-\u2015])\s*(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(question);
  if (ofThisMonth?.[1] && ofThisMonth[2]) {
    const ym = monthOf(asOf);
    const [a, b] = [`${ym}-${ofThisMonth[1].padStart(2, "0")}`, `${ym}-${ofThisMonth[2].padStart(2, "0")}`].sort() as [IsoDate, IsoDate];
    return { from: a, to: b, name: `${short(a)} to ${short(b)} ${year}` };
  }

  // One day: "on sept 20", "sep 20", "2026-09-20".
  const oneIso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(question);
  if (oneIso?.[1]) return { from: oneIso[1], to: oneIso[1], name: short(oneIso[1]) };
  const oneDay = new RegExp(String.raw`\b${MONTH_WORD}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:months?|days?|weeks?))`, "i").exec(question);
  if (oneDay?.[1] && oneDay[2] && Number(oneDay[2]) <= 31) {
    const y = /\b(20\d{2})\b/.exec(question)?.[1] ?? year;
    const d = `${y}-${String(monthAt(oneDay[1]) + 1).padStart(2, "0")}-${oneDay[2].padStart(2, "0")}`;
    return { from: d, to: d, name: short(d) };
  }

  // "the last 10 days", "past 14 days", "3 days".
  const days = /\b(?:(?:past|last|previous|recent)\s+)?(\d{1,3})\s*days?\b/i.exec(question);
  if (days?.[1]) {
    const n = Math.max(1, Math.min(366, Number(days[1])));
    return { from: shift(asOf, -(n - 1)), to: asOf, name: `the last ${n} ${n === 1 ? "day" : "days"}` };
  }

  // "since august", "since sep 5": from then to today.
  const since = new RegExp(String.raw`\bsince\s+${MONTH_WORD}(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?\b`, "i").exec(question);
  if (since?.[1]) {
    const y = /\b(20\d{2})\b/.exec(question)?.[1] ?? year;
    const from = `${y}-${String(monthAt(since[1]) + 1).padStart(2, "0")}-${(since[2] ?? "1").padStart(2, "0")}`;
    return { from, to: asOf, name: `${short(from)} to today` };
  }

  // A quarter: "this quarter", "last quarter", "q3".
  const quarter = /\b(this|last|previous)\s+quarter\b|\bq([1-4])\b/i.exec(question);
  if (quarter) {
    const nowQ = Math.floor((Number(asOf.slice(5, 7)) - 1) / 3) + 1;
    let q = quarter[2] ? Number(quarter[2]) : nowQ;
    let y = Number(year);
    if (quarter[1] && /last|previous/i.test(quarter[1])) {
      q -= 1;
      if (q === 0) {
        q = 4;
        y -= 1;
      }
    }
    const first = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}`;
    const last = `${y}-${String(q * 3).padStart(2, "0")}`;
    return { from: `${first}-01`, to: lastDay(last), name: `Q${q} ${y}` };
  }

  // "last year" is the year before, not this one.
  if (/\b(last|previous)\s+year\b/i.test(question)) {
    const y = String(Number(year) - 1);
    return { from: `${y}-01-01`, to: `${y}-12-31`, name: y };
  }

  // "last week" is the seven days before these seven.
  if (/\b(last|previous)\s+week\b/i.test(question) && !/\blast\s+\d/.test(question)) {
    const from = shift(asOf, -13);
    const to = shift(asOf, -7);
    return { from, to, name: `${short(from)} to ${short(to)}` };
  }

  const back = /\b(?:past|last|previous|recent)\s+(\d{1,2})\s*(month|months|week|weeks)\b/i.exec(
    question,
  );
  if (back?.[1]) {
    const n = Math.max(1, Math.min(36, Number(back[1])));
    if (/week/i.test(back[2] ?? "")) {
      const to = asOf;
      const from = new Date(`${asOf}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - n * 7);
      return {
        from: from.toISOString().slice(0, 10),
        to,
        name: `the last ${n} ${n === 1 ? "week" : "weeks"}`,
      };
    }
    const start = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() - (n - 1));
    const from = `${start.toISOString().slice(0, 7)}-01`;
    return {
      from,
      to: `${asOf.slice(0, 7)}-31`,
      name:
        n === 1
          ? monthName(asOf.slice(0, 7))
          : `${monthName(from.slice(0, 7))} to ${monthName(asOf.slice(0, 7))}`,
    };
  }

  /**
   * The short periods, which all drew the whole month.
   *
   *   "chart last month"  drew August, the month it already is
   *   "chart this week"   drew August
   *   "chart yesterday"   drew August
   *
   * None of them was read, so each fell through to the default at the end of
   * this function. "Last month" being off by a whole month is the worst of
   * the three, because the answer looks entirely reasonable.
   *
   * A week is the last seven days rather than a calendar week, matching how
   * the rest of the app answers "this week": the ledger has no week column,
   * and inventing one that starts on a Monday would disagree with itself.
   */
  const day = (from: IsoDate, days: number): IsoDate => {
    const at = new Date(`${from}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
  };

  if (/\blast month\b/i.test(question)) {
    const start = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() - 1);
    const ym = start.toISOString().slice(0, 7);
    return { from: `${ym}-01`, to: `${ym}-31`, name: monthName(ym) };
  }

  if (/\b(this month|current month)\b/i.test(question)) {
    const ym = monthOf(asOf);
    return { from: `${ym}-01`, to: `${ym}-31`, name: monthName(ym) };
  }

  if (/\byesterday\b/i.test(question)) {
    const d = day(asOf, -1);
    // Named the way it was asked for. A raw ISO date in a title reads as a
    // field value rather than as an answer to the question.
    return { from: d, to: d, name: "yesterday" };
  }

  if (/\btoday\b/i.test(question)) {
    return { from: asOf, to: asOf, name: "today" };
  }

  if (/\b(this week|the week|past week|last week|last 7 days)\b/i.test(question)) {
    return { from: day(asOf, -6), to: asOf, name: "the last 7 days" };
  }

  /**
   * "from may to august" is a range, and it drew May alone.
   *
   * The rule below takes the first month it recognises and treats the whole
   * question as that one month, so a range lost everything after its first
   * word. Two months named with a range word between them is one of the most
   * ordinary ways to ask for a period.
   *
   * Both endpoints are inclusive, and they are sorted, so "august to may"
   * means the same window rather than nothing at all.
   */
  const spanned = MONTHS.map((m, i) => ({
    at: question.search(new RegExp(`\\b${m}\\b`, "i")),
    index: i,
  })).filter((m) => m.at >= 0);

  if (
    spanned.length > 1 &&
    (/\b(to|through|until|till|and|thru|until)\b/i.test(question) || COMPARING.test(question))
  ) {
    const y = /\b(20\d{2})\b/.exec(question)?.[1] ?? year;
    const months = [...spanned].sort((a, b) => a.index - b.index);
    const first = months[0];
    const last = months[months.length - 1];
    if (first && last) {
      const from = `${y}-${String(first.index + 1).padStart(2, "0")}`;
      const to = `${y}-${String(last.index + 1).padStart(2, "0")}`;
      return {
        from: `${from}-01`,
        to: `${to}-31`,
        name: `${monthName(from)} to ${monthName(to)}`,
      };
    }
  }

  const named = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`, "i").test(question));
  if (named >= 0) {
    const y = /\b(20\d{2})\b/.exec(question)?.[1] ?? year;
    const mm = String(named + 1).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-31`, name: monthName(`${y}-${mm}`) };
  }

  if (/\b(year|annual|this year|ytd)\b/i.test(question)) {
    return { from: `${year}-01-01`, to: `${year}-12-31`, name: year };
  }

  if (/\b(all|everything|ever|whole|entire)\b/i.test(question)) {
    return { from: "0000-01-01", to: "9999-12-31", name: "the whole ledger" };
  }

  // Month by month only makes sense across more than one month.
  if (dimensionOf(question) === "month") {
    return { from: `${year}-01-01`, to: `${year}-12-31`, name: year };
  }

  const month = monthOf(asOf);
  return { from: `${month}-01`, to: `${month}-31`, name: monthName(month) };
}

/**
 * Asking to be told, rather than shown.
 *
 * ── The answer that was a picture ──────────────────────────────────────────
 *
 * The owner, 20 September 2026: "I would like to understand how this month
 * compares with last month ... tell me what actually caused the difference
 * rather than just stating the totals." It came back as a bar chart of
 * August. Every word of that sentence asks for an explanation, and a chart
 * is the one thing it explicitly said would not do.
 *
 * The router had called it a chart, which is understandable: it names a
 * comparison and a grouping. This overrules it, the same way a question about
 * a credit line does, because a request to be told something is not satisfied
 * by being shown something.
 */
export const asksForProse = (question: string): boolean =>
  /\b(?:tell me|explain|explain to me|why|what caused|what actually caused|walk me through|help me understand|i want to understand|i would like to understand|in words|rather than just|instead of just|not just|sabihin mo|bakit|ipaliwanag)\b/i.test(
    question,
  );

/** True when the message is asking to see a chart at all. */
export const wantsChart = (question: string): boolean => WANTS_CHART.test(question);

/**
 * A period named on its own, with a chart already on screen.
 *
 * "How about this month?" straight after a chart is asking for the same
 * chart over a different window, and answering it in prose was reading the
 * words and ignoring the conversation. It only counts as a follow-up when
 * the message is short and names a period and nothing else: anything longer
 * is a new question that happens to mention a month.
 */
export function isChartFollowUp(question: string, chartOnScreen: boolean): boolean {
  if (!chartOnScreen) return false;
  const trimmed = question.trim();
  if (!trimmed || trimmed.length > 48) return false;
  if (WANTS_CHART.test(trimmed)) return false;

  const namesPeriod =
    // Doubled on purpose: inside a template literal `\b` is the backspace
    // escape, so a single one builds a regex that matches a control
    // character and never a word boundary.
    MONTHS.some((m) => new RegExp(`\\b${m}\\b`, "i").test(trimmed)) ||
    /\b(this month|last month|this year|last year|the year|ytd|all|everything|per month|monthly|by wallet|by category|by item)\b/i.test(
      trimmed,
    ) ||
    // The short windows: "how about this week", "today only", "last 10 days".
    /\b(today|yesterday|this week|last week|past week|(last|past) \d+ days?|this quarter|last quarter|q[1-4]|since \w+|daily|by day|per day)\b/i.test(
      trimmed,
    );

  /*
   * A new shape for the same chart: "as a line", "make it a donut". Not a
   * period, but the chart on screen is exactly what it is about.
   */
  const namesShape = /\b(as|into|make it|in)( a| an)? (line|donut|doughnut|pie|bars?|bar chart|line chart)\b/i.test(trimmed);
  if (!namesPeriod && !namesShape) return false;

  // "how much did I spend in May" is a question about a figure, not a
  // request to redraw. A follow-up is a fragment, not a sentence.
  return !/\b(how much|how many|what|why|when|who|which|did|do|does|is|are|was|were)\b/i.test(
    trimmed,
  );
}

/** True when the message is asking for the written version. */
export const wantsReport = (question: string): boolean =>
  WANTS_REPORT.test(question) && !WANTS_CHART.test(question);

/**
 * Build it, or return null when there is nothing to draw.
 *
 * An empty window returns null rather than an empty chart: a chart of nothing
 * is a picture that says nothing while looking like it says something.
 */
/**
 * One item, when the question names one of the owner's own.
 *
 * "chart about treats this past 3 months" is a question about Treat, and it
 * came back as every item in the ledger. The item was read by nothing at all:
 * `dimensionOf` decides how to group and `windowOf` decides when, and neither
 * had any way to express "only this one".
 *
 * Matched against the items actually in the ledger rather than a list passed
 * in, so it needs no new argument and cannot drift from the data. Longest
 * first, so "Online Buy" beats "Buy", and a trailing "s" is allowed because
 * people pluralise: "treats" is Treat.
 */
interface Focus {
  readonly item: string;
  readonly wallet: string;
}

/** The first name in `names` that the question uses, longest first. */
function named(question: string, names: readonly string[]): string {
  const asked = question.toLowerCase();
  const byLength = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );

  for (const name of byLength) {
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}s?\\b`).test(asked)) return name;
  }
  return "";
}

function focusOf(question: string, transactions: readonly Transaction[]): Focus {
  return {
    item: named(question, transactions.map((t) => t.item)),
    /**
     * Naming one account is a filter, not a grouping.
     *
     * "chart my maya spending this year" drew all three wallets with the
     * whole year's total, because a bare account name made `dimensionOf`
     * group by wallet. Grouping by the thing you just narrowed to gives one
     * bar, which is the same mistake a single item had.
     *
     * Read from the ledger rather than a hardcoded list, so an account added
     * or renamed later is recognised without touching this file: "chart my
     * reserved fund" matched nothing at all before.
     */
    wallet: named(
      question,
      transactions.flatMap((t) => [t.fromWallet, t.toWallet]),
    ),
  };
}

/** The calendar day after this one. */
function nextDay(day: IsoDate): IsoDate {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

export function buildChart(
  question: string,
  transactions: readonly Transaction[],
  asOf: IsoDate,
  /** Money in or money out, when the caller has decided (income and spending drawn side by side). */
  only?: "spending" | "revenue",
): Chart | null {
  const focus = focusOf(question, transactions);
  const direction = only ?? directionOf(question);
  const valueOf = direction === "revenue" ? revenueOf : spendingOf;
  const word = direction === "revenue" ? "Income" : "Spending";
  /**
   * Never group by the thing you just narrowed to.
   *
   * One item grouped by item is a single bar labelled with the word you
   * typed. One wallet grouped by wallet is the same. So a filtered chart
   * moves to the next useful question: an item goes across months, which
   * says whether it is growing, and a wallet goes across items, which says
   * what it was spent on.
   */
  const period = windowOf(question, asOf);
  /** How many days the window covers. The whole ledger is as long as a window gets. */
  const span =
    period.from < "1000"
      ? Number.POSITIVE_INFINITY
      : Math.round((Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000) + 1;
  /*
   * A trend over a short window is day by day. "this week's trend" grouped
   * by month drew one point, which is not a trend.
   */
  const asked0 = dimensionOf(question);
  const asked = asked0 === "month" && span <= 45 && !comparesMonths(question) ? "day" : asked0;
  const by: ChartBy =
    focus.item && asked === "item"
      ? span <= 45
        ? "day"
        : "month"
      : focus.wallet && asked === "wallet"
        ? "item"
        : asked;


  /**
   * The side the money actually moved through.
   *
   * Spending leaves `fromWallet`; income lands in `toWallet`. `walletUsage`
   * attributes every cost to the from side and nothing to the to side, and a
   * chart that disagrees with it is the `costOf` mistake again.
   *
   * Matching either side was tried first and double-counted: a transfer fee
   * is borne by the account the money left, so charting Maya and Cash
   * separately added the same PHP 458.00 of fees to both.
   */
  const sideOf = (t: Transaction): string =>
    direction === "revenue" ? t.toWallet.trim() : t.fromWallet.trim();

  const matchesWallet = (t: Transaction): boolean =>
    !focus.wallet || sideOf(t).toLowerCase() === focus.wallet.toLowerCase();

  const inWindow = transactions.filter(
    (t) =>
      t.date >= period.from &&
      t.date <= period.to &&
      (!focus.item || t.item.trim().toLowerCase() === focus.item.toLowerCase()) &&
      matchesWallet(t),
  );

  const key = (t: Transaction): string => {
    switch (by) {
      case "month":
        return monthOf(t.date);
      case "day":
        return t.date;
      case "wallet":
        // The side the money moved through, so an income chart grouped by
        // wallet does not put every row under "(none)": a Revenue row has no
        // source, and reading one was how that happened.
        return sideOf(t) || "(none)";
      case "category":
        return t.category.trim() || "(none)";
      case "item":
        return t.item.trim() || "(no item)";
    }
  };

  const groups = new Map<string, { value: number; count: number }>();
  for (const row of inWindow) {
    const spent = valueOf(row);
    if (spent <= 0) continue;
    const name = key(row);
    const found = groups.get(name) ?? { value: 0, count: 0 };
    found.value += spent;
    found.count += 1;
    groups.set(name, found);
  }

  if (groups.size === 0) return null;

  /*
   * A quiet day is part of a trend. "this week's spending trend" with one
   * spending day drew a single dot, because only days with money on them
   * had a row. Every day of a short window gets one, at zero when nothing
   * moved, up to today: a day that has not happened yet is not a zero.
   */
  if (by === "day" && span <= 62) {
    const last = period.to < asOf ? period.to : asOf;
    for (let d = period.from; d <= last; d = nextDay(d)) {
      if (!groups.has(d)) groups.set(d, { value: 0, count: 0 });
    }
  }

  const all = [...groups.entries()]
    // Months and days read in order; everything else reads largest first.
    .sort((a, b) => (by === "month" || by === "day" ? a[0].localeCompare(b[0]) : b[1].value - a[1].value));

  const total = all.reduce((sum, [, g]) => sum + g.value, 0);
  const kept = by === "month" || by === "day" ? all : all.slice(0, MOST_ROWS);
  const largest = Math.max(...kept.map(([, g]) => g.value), 1);

  return {
    /**
     * The title says what was filtered, or the chart is a lie by omission.
     *
     * A chart of Treat alone, headed "Spending by month", reads as the whole
     * month's spending and is wrong by everything it left out.
     */
    /**
     * The title carries every filter, or the chart is a lie by omission.
     *
     * A chart of Treat alone headed "Spending by month" reads as the whole
     * month's spending and is wrong by everything it left out. The same goes
     * for one wallet.
     */
    title: `${focus.item || word}${focus.wallet ? ` from ${focus.wallet}` : ""} by ${by}, ${
      period.name
    }`,
    by,
    kind: kindOf(question, by),
    rows: kept.map(([label, g]) => ({
      label: by === "month" ? monthName(label) : by === "day" ? `${MONTHS[Number(label.slice(5, 7)) - 1]?.slice(0, 3) ?? ""} ${Number(label.slice(8, 10))}` : label,
      value: g.value,
      share: g.value / largest,
      count: g.count,
    })),
    total,
    othersCount: all.length - kept.length,
    direction,
  };
}

/** Pesos, for a label. Display only, never arithmetic. */
export const chartLabel = (centavos: number): string =>
  `PHP ${Number(toPesos(centavos).toFixed(2)).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * What the chart says, in a sentence.
 *
 * A stored chart carries this as its message text, for two reasons. A reader
 * that knows nothing about charts sees an answer rather than a blank line.
 * And when the turn goes back to the model as history, "Spending by item,
 * August 2026: School PHP 52,432.00, Online Buy PHP 42,529.74" is something
 * it can answer a follow-up from, where a picture is not.
 */
export function chartInWords(chart: Chart): string {
  const top = chart.rows
    .filter((r) => r.value > 0)
    .slice(0, 5)
    .map((r) => `${r.label} ${chartLabel(r.value)}`)
    .join(", ");
  const rest = chart.othersCount > 0 ? `, and ${chart.othersCount} more` : "";
  return `${top}${rest}. Total ${chartLabel(chart.total)}.`;
}

/**
 * Asking for something to keep, print or send.
 *
 * ── Why this is separate from `wantsReport` ───────────────────────────────
 *
 * "summarise the month" wants words on screen. "give me a pdf of my
 * financial status this month" wants a file, and those are different
 * answers: one the assistant can give and one it cannot.
 *
 * It has never been able to produce a file, and it says so correctly. What
 * it did not do was say where one lives. The Statements screen is the
 * printable view of a month, so a request for a report is pointed at it
 * rather than answered with a flat no.
 */
const WANTS_A_FILE =
  /\b(pdf|download|print|printable|export|excel|spreadsheet|csv|file|copy of|send me|statement|statements)\b/i;

export const wantsStatement = (question: string): boolean =>
  WANTS_A_FILE.test(question) ||
  (WANTS_REPORT.test(question) && /\b(month|monthly|this month|financial status|position)\b/i.test(question));

/**
 * The same question with the file part taken out.
 *
 * ── Why the answer arrived twice ──────────────────────────────────────────
 *
 * Asking for a PDF gets two replies. The app says it cannot make a file and
 * points at Statements, which is right, and then passes the question on so
 * the figures still arrive. But the question still says "give me pdf", and
 * the model is told plainly that it cannot produce files, so it says so too:
 *
 *   I cannot make a file here. The Statements screen is the printable
 *   month, so open that and print it to PDF from your browser.
 *   I cannot produce a PDF, spreadsheet, or image of that report.
 *
 * Two refusals in a row, the second longer and less useful than the first.
 * The owner asked twice and got the pair both times.
 *
 * The app has already answered the file half. What is left for the model is
 * the half about money, so that is what it is asked.
 */
export function withoutTheFilePart(question: string): string {
  const left = question
    .replace(WANTS_A_FILE, " ")
    .replace(/\b(give me|make me|send me|generate|create|produce|i want to|i want|can you|please)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "");

  /**
   * What is left has to still be a question about money. "give me a pdf"
   * leaves nothing, and asking a model to answer an empty string produces
   * whatever it feels like.
   */
  return left.length >= 8 ? left : "How is this month going?";
}

/**
 * A chart of what the screen is showing: "chart what I picked", "chart this".
 *
 * On Insights the calendar picks the days, and "chart what I picked" drew
 * this month, because the pick was only ever sent as words for the model.
 * A pointing word means the pick. A bare "this" or "it" only counts when no
 * chart is in the conversation yet, since after one it means that chart.
 */
export function pointsAtScreen(question: string, chartShown: boolean): boolean {
  if (/\b(picked|selected|selection|highlighted|(the|my|this|that) range|(on )?the (screen|calendar))\b/i.test(question)) {
    return true;
  }
  return !chartShown && /\b(this|that|these|those|it)\b/i.test(question);
}

/**
 * Asking for a chart in other colours: "make it blue", "change the colors".
 *
 * A chart's colour is the direction of its money (rule D3): red is money
 * out, green is money in, and the same hue means the same thing on every
 * screen and in both themes. Recolouring on request would make a blue bar
 * mean nothing and a red one mean something else, so the answer says why
 * and offers what can change: the shape.
 */
export function asksChartColour(question: string): boolean {
  const q = question.toLowerCase();
  const colourWord = /\b(colou?rs?|colou?red|shades?|palette|theme)\b/.test(q);
  const hue = /\b(blue|purple|violet|pink|orange|yellow|teal|cyan|black|white|rainbow)\b/.test(q);
  const change = /\b(change|make|turn|use|switch|different|another|other|new|adapt|set|paint)\b/.test(q);
  return (colourWord && change) || (hue && /\b(make|turn|paint|in|to)\b/.test(q) && /\b(it|chart|graph|bars?|line|pie|donut)\b/.test(q));
}

/**
 * Money in and money out asked for together: "income vs spending", "cash
 * flow", "in and out". One chart can only be one direction (rule D3: its
 * colour says which way the money went), so this is drawn as two, each in
 * its own colour, rather than one of them silently.
 */
export function wantsBothDirections(question: string): boolean {
  const q = question.toLowerCase();
  const incoming = /\b(income|revenue|earnings|money in|received|allowance|salary)\b/.test(q);
  const outgoing = /\b(spending|spent|expenses?|money out|outflow)\b/.test(q);
  return (incoming && outgoing) || /\b(cash ?flow|in and out|ins and outs|coming in and going out)\b/.test(q);
}
