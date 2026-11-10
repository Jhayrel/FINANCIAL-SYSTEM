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

import { spanIn } from "./periodIn";
import { toPesos } from "./money";
import { editsBetween } from "./nearly";
import { costOf, incomeOf, writtenOffAsSpending } from "./totals";
import type { IsoDate, Transaction } from "./types";

export type ChartBy = "item" | "month" | "wallet" | "category" | "day" | "week" | "year";

/** A grouping that is a series over time, drawn in calendar order rather than by size. */
export const overTime = (by: ChartBy): boolean => by === "month" || by === "day" || by === "week" || by === "year";

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
  /** On a comparison: the same row in the earlier period, in centavos. */
  readonly previous?: number | undefined;
  /** And its bar length, on the same scale as `share`. */
  readonly previousShare?: number | undefined;
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
  /**
   * The earlier period of a comparison: "this month compared to last
   * month". Each row carries its own figure for it in `previous`.
   */
  readonly against?:
    | {
        readonly name: string;
        readonly total: number;
        readonly now: string;
        /** Both windows, so a follow-up ("by wallet", "pie") keeps comparing the same two. */
        readonly periods?: ComparedPeriods | undefined;
      }
    | undefined;
  /**
   * What it measures, when it is not money in or money out over a window
   * (`chartAsk.ts`). A budget chart puts each period's spending beside its
   * budget, in `previous`; a balance or what is owed is a level, read at the
   * end of each period, so `total` is the latest level rather than a sum.
   */
  readonly measure?: "budget" | "balance" | "owed" | "forecast" | "allocation" | "safe" | "upcoming" | undefined;
  /** What a chart narrowed to the owner's wants or needs counts, said under it (`wantsAsk.ts`). */
  readonly scope?: string | undefined;
  /** Spending still to come, by what it is (`upcoming.ts`): the parts its reading names. */
  readonly upcoming?:
    | { readonly plans: number; readonly noDate: number; readonly bills: number; readonly allocations: number; readonly debts: number }
    | undefined;
  /**
   * A forecast's own figures beside its rows (`buildForecastChart`): what a
   * usual month brings in, the debt payments due, and what is left after
   * both, so the chart says the same as the words it was asked after.
   */
  readonly plan?:
    | {
        readonly income: number;
        readonly debtDue: number;
        readonly left: number;
        /** The budget already set for the month, 0 when none. */
        readonly budget: number;
        /** The months the usual month was read from, said ("June to November 2026"). */
        readonly readFrom: string;
        /** The month or months planned, said ("December 2026", "December 2026 to February 2027"). */
        readonly name: string;
        /** The month planned is the one running: its usual month, not what it has spent. */
        readonly running?: boolean | undefined;
      }
    | undefined;
  /** The last row is a period still running: "October 2026" read on 3 October. */
  readonly running?: boolean | undefined;
  /**
   * The first row is a period the records start partway through: "2022"
   * when the first entry is in May. Neither the lowest nor a whole one, so
   * the reading leaves it out of the high, the low and the average, and
   * says so (10 November 2026: "lowest in 2022" for eight months of it).
   */
  readonly partialFirst?: { readonly label: string; readonly from: IsoDate } | undefined;
  /**
   * The question it was drawn from, so "bars" after a pie draws the same
   * thing as bars (`redrawAsked`). Without it, "pie" of the year's food
   * then "bars" drew this month's food day by day (4 November 2026 sweep).
   */
  readonly asked?: string | undefined;
  /**
   * Entries dated after today, counted in a level's last point so it is the
   * balance, or the amount owed, that every other screen shows. The Add
   * form takes a date ahead with a warning, and the sidebar counts it.
   */
  readonly ahead?: number | undefined;
}

/**
 * A part of a whole as a percentage, honestly rounded: never "0%" for money
 * that is there, never "100%" beside other parts. "Random: PHP 31.00, 0%"
 * and "Framelink Media ... 100%" sat in one November breakdown of three
 * sources (owner's chat, 3 November 2026).
 */
export function percentOf(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const exact = (part * 100) / whole;
  if (exact < 0.5) return "under 1%";
  if (exact >= 99.5 && part < whole) return "over 99%";
  return `${Math.round(exact)}%`;
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
/*
 * Only the words that ask for a picture. "Breakdown", "break down" and
 * "show me" went with them, and "give me a breakdown, very detailed" or
 * "show my spending this month like detailed" were drawn when the owner
 * wanted it written (13 October 2026). Those are `presentationFor`'s
 * "either": written first, with the picture offered.
 */
const WANTS_CHART =
  /\b(chart|charts|graph|graphs|pie|bar|bars|bar chart|visual|visuals|visuali[sz]e|plot|diagram|trend|trends|trending|over time|shape of|line chart)\b/i;

/** Asking for it written: a summary, a list, the details, in the chat. */
const WANTS_TEXT =
  /\b(summary|summari[sz]e|overview|report|detailed|details|in detail|list|listed|itemi[sz]e|in text|as text|in words|text only|written|write it|explain|tell me|walk me through|plain|here in (?:the )?chat|sa text)\b/i;

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
 *
 * "earn" and "receive" were missing as plain words: "how much did i earn
 * last month", answered as income, then "pie", drew last month's spending
 * (4 November 2026 sweep).
 */
/** Money in or money out, as the words say it (`chartAsk.ts`). */
export const directionIn = (question: string): "spending" | "revenue" => directionOf(question);

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
    /\b(income|revenue|earn|earns|earned|earnings|earning|salary|allowance|receive|receives|received|receiving|money in|inflow|coming in|came in|come in|cash in|positive|gain|gains|deposit|deposits|deposited|natanggap|kinita|pumasok)\b/i.test(
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
  /*
   * Parts of one whole, asked as parts: "what share", "the breakdown",
   * "where did my money go". A pie answers that at a glance, and a list of
   * bars makes the eye add them up (owner, 10 November 2026: "know when to
   * use trend, chart, graph, pie"). Never over time: months in a row are a
   * trend, whatever word asked for them.
   */
  if (!overTime(by) && /\b(shares?|percent(?:age)?s?|proportions?|portions?|breakdown|break\s+down|split\s+(?:of|between)|where\s+(?:did|does|do)\s+(?:my|the|all)\s+(?:money|pera)\s+go|what\s+(?:did|do)\s+i\s+spend\s+(?:it|most)\s+on|saan\s+napunta)\b/i.test(question)) return "pie";
  if (/\b(line|trend|over time|curve|movement|progression)\b/i.test(question)) {
    return overTime(by) ? "line" : "bars";
  }
  // Two named months side by side are two bars: a line between two points says nothing a bar does not.
  if (comparesMonths(question)) return "bars";
  // A question about months or days is a series whether or not it says so.
  return overTime(by) ? "line" : "bars";
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

/** The grouping the words ask for, item when they ask for none (`chartAsk.ts`). */
export const groupingOf = (question: string): ChartBy => dimensionOf(question);

function dimensionOf(question: string, twoMonthsAreBars = true): ChartBy {
  /**
   * A comparison of two months is one bar per month.
   *
   * Checked first, because such a question also names two months, and
   * grouping by item inside a two month window answers something else.
   * Not when the two periods are already known and drawn side by side: a
   * comparison chart's own title names two months, and "by wallet" after it
   * drew one bar of one month (3 October 2026).
   */
  if (twoMonthsAreBars && comparesMonths(question)) return "month";

  // "daily", "day by day", "per day": one point a day.
  if (/\b(daily|per day|by day|day by day|each day|every day|day to day)\b/i.test(question)) return "day";

  // "weekly", "by week": one point a week. "yearly", "by year": one a year.
  if (/\b(weekly|per week|by week|week by week|each week|every week)\b/i.test(question)) return "week";
  if (/\b(yearly|per year|by year|year by year|each year|every year|annually|year on year|year over year)\b/i.test(question)) return "year";

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
  /*
   * "Categories" are the owner's kinds, Food and Travel, as Settings,
   * Categories lists them and the breakdown answers: a pie of "expenses based
   * on categories" drew three slices, Spending, Bills and Subscriptions,
   * beside a breakdown of fifteen kinds (3 November 2026). The three groups
   * only when asked for by name.
   */
  if (/\b(?:main|top[- ]level|big)\s+categor(?:y|ies)\b|\bspending,?\s+bills\b|\bbills\s+(?:and|vs\.?|or)\s+subscriptions\b/i.test(question) || (/\bbills\b/i.test(question) && /\bsubscriptions\b/i.test(question))) return "category";
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
  /*
   * Across years: "dec 2025 to feb 2026", "march 2024 to june 2025", and
   * "2024 to 2025". Each fell through to this month (27 September 2026).
   */
  const monthYearRange = new RegExp(
    String.raw`\b${MONTH_WORD}\s+(20\d{2})\s*(?:to|until|till|through|thru|and|[-\u2010-\u2015])\s*${MONTH_WORD}\s+(20\d{2})\b`,
    "i",
  ).exec(question);
  if (monthYearRange?.[1] && monthYearRange[2] && monthYearRange[3] && monthYearRange[4]) {
    const a = `${monthYearRange[2]}-${String(monthAt(monthYearRange[1]) + 1).padStart(2, "0")}`;
    const b = `${monthYearRange[4]}-${String(monthAt(monthYearRange[3]) + 1).padStart(2, "0")}`;
    const [first, last] = [a, b].sort() as [string, string];
    return { from: `${first}-01`, to: lastDay(last), name: `${monthName(first)} to ${monthName(last)}` };
  }
  const yearRange = /\b(20\d{2})\s*(?:to|until|till|through|thru|and|[-\u2010-\u2015])\s*(20\d{2})\b/i.exec(question);
  if (yearRange?.[1] && yearRange[2] && !new RegExp(String.raw`\b${MONTH_WORD}\b`, "i").test(question)) {
    const [a, b] = [yearRange[1], yearRange[2]].sort() as [string, string];
    return { from: `${a}-01-01`, to: `${b}-12-31`, name: `${a} to ${b}` };
  }

  /*
   * "since august 15" is from then to today. It was read as the one day,
   * August 15, because the one-day rule below comes first.
   */
  const sinceEarly = new RegExp(String.raw`\bsince\s+${MONTH_WORD}(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?\b`, "i").exec(question);
  if (sinceEarly?.[1]) {
    const y = /\b(20\d{2})\b/.exec(question)?.[1] ?? year;
    const from = `${y}-${String(monthAt(sinceEarly[1]) + 1).padStart(2, "0")}-${(sinceEarly[2] ?? "1").padStart(2, "0")}`;
    return { from, to: asOf, name: `${short(from)} to today` };
  }

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

  /*
   * Any other range, said any other way: "march 2026 to today", "from may
   * to now", "jan 5 to feb 10 2026" (domain/periodIn.ts). Before the rules
   * for one day, because each end of a range is one: "march 2026 to today"
   * drew today alone (28 September 2026).
   */
  const span = spanIn(question, asOf);
  if (span) return span;

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
    // "q2 2025" is that year's, not this one's.
    let y = Number(/\b(20\d{2})\b/.exec(question)?.[1] ?? year);
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

  /*
   * "last week" is Monday to Sunday of the week before this one, as the
   * AI's recent windows and the week comparison already count it. It was the
   * seven days before these seven, so the chat and the chart named two
   * different weeks for one question (26 October 2026). "the past week" and
   * "the last 7 days" are still the last seven days.
   */
  const monday = shift(asOf, -((new Date(`${asOf}T00:00:00Z`).getUTCDay() + 6) % 7));
  if (/\b(last|previous)\s+week\b/i.test(question) && !/\blast\s+\d/.test(question)) {
    const from = shift(monday, -7);
    const to = shift(monday, -1);
    return { from, to, name: `last week, ${short(from)} to ${short(to)}` };
  }

  const back = /\b(?:past|last|previous|recent)\s+(\d{1,2})\s*(month|months|week|weeks|year|years)\b/i.exec(
    question,
  );
  if (back?.[1]) {
    const n = Math.max(1, Math.min(36, Number(back[1])));
    // "past 2 years": the twenty-four months to this one, inclusive.
    if (/year/i.test(back[2] ?? "")) {
      const start = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
      start.setUTCMonth(start.getUTCMonth() - (n * 12 - 1));
      const from = `${start.toISOString().slice(0, 7)}-01`;
      return { from, to: lastDay(asOf.slice(0, 7)), name: `${monthName(from.slice(0, 7))} to ${monthName(asOf.slice(0, 7))}` };
    }
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
      to: lastDay(asOf.slice(0, 7)),
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
   * This week is Monday to today, the week the AI is told about and the
   * week comparison uses (26 October 2026); "the last 7 days" is said so.
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
    return { from: `${ym}-01`, to: lastDay(ym), name: monthName(ym) };
  }

  if (/\b(this month|current month)\b/i.test(question)) {
    const ym = monthOf(asOf);
    return { from: `${ym}-01`, to: lastDay(ym), name: monthName(ym) };
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

  // This week is Monday to today (above: one week for the chat, the chart and the comparison).
  if (/\b(this week|the week)\b/i.test(question)) {
    return { from: monday, to: asOf, name: monday === asOf ? "this week, today" : `this week, ${short(monday)} to ${short(asOf)}` };
  }
  if (/\b(past week|last 7 days)\b/i.test(question)) {
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

  /*
   * A month named with no year is the latest one that has begun: in January,
   * "december" is the December just gone. It was December of the new year,
   * which has not happened, and answered "Nothing in December 2027 yet"
   * (2 November 2026, testing the app on 1 January 2027). Every question
   * read here is about money already spent.
   */
  const said = /\b(20\d{2})\b/.exec(question)?.[1];
  const thisMonthNo = Number(asOf.slice(5, 7));
  const yearOf = (monthNo: number): string => said ?? (monthNo > thisMonthNo ? String(Number(year) - 1) : year);

  if (
    spanned.length > 1 &&
    (/\b(to|through|until|till|and|thru|until)\b/i.test(question) || COMPARING.test(question))
  ) {
    const bySaid = [...spanned].sort((a, b) => a.at - b.at);
    const saidFirst = bySaid[0];
    const saidLast = bySaid[bySaid.length - 1];
    // "From december to january", asked in January: across New Year, December first.
    const wraps = !said && saidFirst && saidLast && saidFirst.index > saidLast.index && saidFirst.index + 1 > thisMonthNo && saidLast.index + 1 <= thisMonthNo;
    const months = wraps ? [saidFirst, saidLast] : [...spanned].sort((a, b) => a.index - b.index);
    const first = months[0];
    const last = months[months.length - 1];
    if (first && last) {
      // A range all after this month is last year's; one reaching into this month is this year's.
      const yFirst = wraps ? String(Number(year) - 1) : yearOf(first.index + 1);
      const yLast = wraps ? year : yFirst;
      const from = `${yFirst}-${String(first.index + 1).padStart(2, "0")}`;
      const to = `${yLast}-${String(last.index + 1).padStart(2, "0")}`;
      return {
        from: `${from}-01`,
        to: lastDay(to),
        name: `${monthName(from)} to ${monthName(to)}`,
      };
    }
  }

  const named = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`, "i").test(question));
  if (named >= 0) {
    const y = yearOf(named + 1);
    const mm = String(named + 1).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: lastDay(`${y}-${mm}`), name: monthName(`${y}-${mm}`) };
  }

  // A year on its own, "2025" or "in 2024", is that whole year. It drew this month.
  const bareYear = /\b(20\d{2})\b/.exec(question);
  if (bareYear?.[1]) {
    return { from: `${bareYear[1]}-01-01`, to: `${bareYear[1]}-12-31`, name: bareYear[1] };
  }

  // "by year", "yearly": one point a year needs every year there is.
  if (dimensionOf(question) === "year" && !/\b(this|last|previous)\s+year\b/i.test(question)) {
    return { from: "0000-01-01", to: "9999-12-31", name: "the whole ledger" };
  }

  if (/\b(year|annual|this year|ytd)\b/i.test(question)) {
    return { from: `${year}-01-01`, to: `${year}-12-31`, name: year };
  }

  if (/\b(all|everything|ever|whole|entire)\b/i.test(question)) {
    return { from: "0000-01-01", to: "9999-12-31", name: "the whole ledger" };
  }

  // Month by month only makes sense across more than one month.
  const grouping = dimensionOf(question);
  if (grouping === "month") {
    return { from: `${year}-01-01`, to: `${year}-12-31`, name: year };
  }
  // Week by week, the last twelve weeks; year by year, every year there is.
  if (grouping === "week") {
    return { from: shift(asOf, -83), to: asOf, name: "the last 12 weeks" };
  }
  if (grouping === "year") {
    return { from: "0000-01-01", to: "9999-12-31", name: "the whole ledger" };
  }

  const month = monthOf(asOf);
  return { from: `${month}-01`, to: lastDay(month), name: monthName(month) };
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
export const wantsChart = (question: string): boolean => WANTS_CHART.test(question) && !/\b(?:not|no|without|ayoko ng)\s+(?:a |the |any )?(?:chart|graph|pie|bars?)\b/i.test(question);

/**
 * How the answer should come: drawn, written, or either.
 *
 * Asked for by name ("pie", "trend", "chart my food") it is drawn. Asked
 * for written ("summary", "detailed", "list", "explain", "not a chart") it
 * is written, and the chart is offered, never pushed. Anything else ("show
 * me my spending", "breakdown of October") is "either": written, with one
 * line offering the picture, so the owner chooses (13 October 2026: "they
 * should communicate, not just show it instantly").
 */
export type Presentation = "chart" | "text" | "either";

/** Said in so many words that no picture is wanted: "not a chart", "text only", "in words". */
export const noPicture = (question: string): boolean =>
  /\b(?:not|no|without|ayoko ng)\s+(?:a |the |any )?(?:chart|graph|pie|bars?)\b|\b(?:text only|in text|as text|in words|written|sa text|here in (?:the )?chat)\b/i.test(question);
export function presentationFor(question: string): Presentation {
  if (/\b(?:not|no|without|ayoko ng)\s+(?:a |the |any )?(?:chart|graph|pie|bars?)\b/i.test(question)) return "text";
  if (wantsChart(question)) return "chart";
  if (WANTS_TEXT.test(question) || asksForProse(question)) return "text";
  return "either";
}

/**
 * A short yes to an offered picture: "pie", "bars please", "yes as a trend",
 * "sige graph". The kind it names, or "chart" for a plain yes to drawing it.
 */
export function drawReply(said: string): "pie" | "bars" | "trend" | "chart" | null {
  const t = said.trim().toLowerCase().replace(/[.!]+$/, "");
  if (t.split(/\s+/).length > 7) return null;
  // "I want pie", "can I see a pie", "gusto ko pie": said as a wish, not a command (owner, 3 November 2026).
  const m = /^(?:(?:yes|yeah|yep|sure|ok(?:ay)?|sige|oo|go|please|pls)[\s,]+)*(?:(?:i\s+(?:want|need|wanna|would\s+like|like)|can\s+i\s+(?:have|see|get)|let\s+me\s+see|gusto\s+ko(?:\s+ng)?)(?:\s+(?:it|that|this))?\s+)?(?:(?:draw|show|make|give)(?: me)?(?: it| that)?(?: (?:as|in))?(?: a| an)?\s+)?(?:(?:as|in)\s+)?(?:a\s+|an\s+)?(pie|pie chart|bars?|bar chart|trend|line|line chart|chart|graph)(?:\s+(?:please|pls|chart|it|po|na))*$/.exec(t);
  if (m?.[1]) return /^pie/.test(m[1]) ? "pie" : /^bar/.test(m[1]) ? "bars" : /^(?:trend|line)/.test(m[1]) ? "trend" : "chart";
  return /^(?:yes|yeah|yep|sure|ok(?:ay)?|sige|oo)[\s,]*(?:please|pls)?[\s,]*(?:draw it|show it|draw|show me)$/.test(t) ? "chart" : null;
}

/**
 * "let see it in trend", "show that in a pie", "can I see it as a chart":
 * the answer just given, drawn, said with "it" or "that" and a kind of
 * picture. The kind, or null. 26 October 2026: after "can I afford the gym
 * today?", "let see it in trend" drew all of 2026's spending.
 */
export function drawsBack(said: string): "pie" | "bars" | "trend" | "chart" | null {
  const t = said.trim().toLowerCase().replace(/[.!?]+$/, "");
  /*
   * "This month" is a time, not the answer pointed at, and "of my unnecessary
   * expenses" names its own subject: "pie of my unnecessary expenses this
   * month" redrew the chart before it as a pie (9 November 2026 sweep).
   */
  const pointing = t.replace(/\b(?:this|that|last|next)\s+(?:month|week|year|day|morning|afternoon|evening|quarter|time)\b/g, " ");
  if (t.split(/\s+/).length > 8 || !/\b(?:it|that|this|those|them)\b/.test(pointing)) return null;
  if (/\bof\s+(?:my|the|our)\s+[a-z]/.test(pointing)) return null;
  if (/\b(?:pie|donut|doughnut)\b/.test(t)) return "pie";
  if (/\bbars?\b/.test(t)) return "bars";
  if (/\b(?:trend|line|over time|by month|monthly)\b/.test(t)) return "trend";
  return /\b(?:chart|graph|plot|visuali[sz]e|draw)\b/.test(t) ? "chart" : null;
}

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
    // "by month" was missing, so straight after a chart it went to a model, or with none, nowhere.
    // "all" and "everything" only nearly alone ("all", "all time"): "If I spend all tomorrow, how will I survive?" is not a period.
    (trimmed.split(/\s+/).length <= 3 && /\b(?:all|everything)\b/i.test(trimmed)) ||
    /\b(this month|last month|this year|last year|the year|ytd|all time|(?:by|per) (?:months?|wallets?|accounts?|categor(?:y|ies)|items?)|monthly|month by month|weekly|by week|per week|yearly|by year|per year|20\d{2}|(last|past) \d+ (months?|weeks?|years?))\b/i.test(
      trimmed,
    ) ||
    // The short windows: "how about this week", "today only", "last 10 days".
    /\b(today|yesterday|this week|last week|past week|(last|past) \d+ days?|this quarter|last quarter|q[1-4]|daily|by day|per day)\b/i.test(
      trimmed,
    ) ||
    // "since march", "since 2025", "since last month": not "since starting", which names no period.
    /\bsince\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|20\d{2}\b|last\b|the\s+\d|\d)/i.test(trimmed);

  /*
   * A new shape for the same chart: "as a line", "make it a donut". Not a
   * period, but the chart on screen is exactly what it is about.
   */
  const namesShape = /\b(as|into|make it|in)( a| an)? (line|donut|doughnut|pie|bars?|bar chart|line chart)\b/i.test(trimmed);
  if (!namesPeriod && !namesShape) return false;

  // "how much did I spend in May" is a question about a figure, not a
  // request to redraw. A follow-up is a fragment, not a sentence.
  /*
   * "so since starting I didnt have good budgeting?", 28 September 2026, was
   * drawn as September's chart: "didnt" is not "did", and a sentence that
   * judges the figures is a question about them.
   */
  // "if" and "will" make it a question about money, and "how" is one unless it is "how about" (backup of 7 October 2026).
  return !/\b(how(?!\s+about)|if|will|won'?t|can|can'?t|survive|how much|how many|what|why|when|who|which|did|didn'?t|do|does|doesn'?t|don'?t|is|isn'?t|are|was|wasn'?t|were|have|has|had|haven'?t|should|could|would|good|bad|better|worse)\b/i.test(
    trimmed,
  );
}

/** Asking for a pie or a donut. */
export const asksPie = (question: string): boolean => /\b(pie|donut|doughnut|circle)\b/i.test(question);

/** Saying the chart should run over time, in the owner's own words: "by month", "daily". */
export const saysOverTime = (question: string): boolean =>
  /\b(monthly|per month|by month|each month|month by month|daily|per day|by day|each day|day by day|trend|over time)\b/i.test(question);

/**
 * "gas only", "just food", "only treats": the chart on screen, narrowed.
 *
 * The owner, 27 September 2026, straight after a chart of September's
 * spending: "gas only". It was read as an entry, and the card asked how much
 * it was. A few words with "only" or "just" in them, after a chart, are
 * about that chart; the caller checks that a chart is what was last shown.
 */
export function narrowsChart(question: string): boolean {
  const trimmed = question.trim().replace(/[.!?]+$/, "");
  if (!trimmed || trimmed.split(/\s+/).length > 4) return false;
  return /\b(only|just|lang)\b/i.test(trimmed) && !/\d/.test(trimmed);
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
  /** Two or more kinds named together ("food and gas"): drawn side by side, those kinds only. Empty otherwise. */
  readonly items: readonly string[];
  readonly wallet: string;
  /**
   * A word from the owner's own descriptions the question is about: a place,
   * a trip, an event. "How much I spent in my trip in abra? show me a chart"
   * drew all of October by item (4 October 2026); the trip is the rows that
   * say Abra.
   */
  readonly about: string;
  /**
   * Bills or Subscriptions, one of them named: its rows, by item. "my
   * subscriptions this year", then "pie", drew Spending, Bills and
   * Subscriptions as three slices, and "how much did i pay in bills last
   * month", then "pie", drew nothing (4 November 2026 sweep).
   */
  readonly group: "" | "Bills" | "Subscriptions";
  /** Kinds the question leaves out: "take out Travel", "without Food" (`leftOut`). */
  readonly without: readonly string[];
  /** It leaves out what happened only once: "and anything that only happened once" (`leftOut`). */
  readonly once: boolean;
}

/** Bills, or Subscriptions, named alone: not both, and not beside the main categories. */
export function groupOf(question: string): "" | "Bills" | "Subscriptions" {
  if (/\b(?:main|top[- ]level|big)\s+categor(?:y|ies)\b|\bspending,?\s+bills\b|\b(?:by|per)\s+categor(?:y|ies)\b/i.test(question)) return "";
  const bills = /\bbills?\b/i.test(question);
  const subs = /\bsubscriptions?\b|\bsubs\b/i.test(question);
  return bills === subs ? "" : bills ? "Bills" : "Subscriptions";
}

const capital = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** The small words after "in", "to" or "from" that are never a place: "from the 1st", "to my". */
const LITTLE_WORDS = new Set(
  "the this that these those my our your his her their its him them you me our one two all any each every some more less same next last first".split(" "),
);

/** Words that are how a question is asked, never what it is about. */
const ASKING_WORDS = new Set(
  (
    "what when where which much many show chart graph draw plot want need please give make tell know spent spend spending " +
    "paid money total from with into this that last month year week days today yesterday since about item items wallet wallets " +
    "category categories budget income revenue expense expenses have does your mine their them they there here just only also " +
    "like some every each over trend trends bars line compare compared versus against between than more less cost costs amount " +
    "figure figures entries entry transactions record records ledger report breakdown split group grouped tell went going goes " +
    "much whole time ever bought sent received earned used using daily weekly monthly yearly pesos peso php could would should " +
    // Words about the asking, never a topic: "at the same time", "all of my transaction", "a proper explanation" (4 October 2026).
    "same transaction kind kinds type types visual visuals summary summarize summarized summarise summarised proper explanation " +
    "explain high highest low lowest latest wanted give charts graphs trend pie bars look good better worse okay please thanks " +
    "thank kindly maybe again also both other others another thing things stuff overall everything anything something " +
    // How sure the answer should be, and what it is for: "so I can do Budgeting. Make sure its accurate" (3 November 2026).
    "based accurate accurately correct correctly sure exact exactly precise budgeting detailed details " +
    // How it was paid, never what: "how much did i pay in bills last month", then "pie", drew the rows that say "pay" (4 November 2026 sweep).
    "pay pays paying"
  ).split(" "),
);

/**
 * The rarest word of the question that the descriptions use, when one is
 * rare enough to pick a few rows out: "abra" in a few rows, not "food" in
 * hundreds. Names of items and wallets are left to their own filters.
 */
function aboutOf(text: string, transactions: readonly Transaction[], taken: readonly string[]): string {
  /*
   * "Break down" is one word for how to show it: "a break down of expenses"
   * picked out the two rows that say "down" and answered PHP 3,526.00 of
   * the whole ledger (owner's phone, 3 November 2026). "Down payment" stays.
   */
  const question = text.replace(/\b(?:break|broken)\s+(?:it\s+|them\s+)?down\b/gi, "breakdown");
  const months = MONTHS.map((m) => m.toLowerCase());
  /*
   * Every word of a name already read, not only the whole name: "Self Care"
   * named as a kind left "self" to be read as a word from the descriptions,
   * and a chart of the owner's wants counted PHP 15.00 (9 November 2026).
   */
  const skip = new Set([...ASKING_WORDS, ...months, ...months.map((m) => m.slice(0, 3)), ...taken.map((t) => t.toLowerCase()), ...taken.flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))]);
  const said = transactions.map((t) => ` ${`${t.description} ${t.notes}`.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `);
  const used = (w: string): number => said.filter((d) => d.includes(` ${w} `) || d.includes(` ${w}s `)).length;
  /*
   * A place said as one ("my trip in abra", "to baguio", "sa vigan") is the
   * topic, ahead of any other word: with nothing mentioning Abra, "trip"
   * picked out a school trip instead. A place nothing mentions is still the
   * topic, so the answer is that nothing mentions it.
   */
  const places = [...question.toLowerCase().matchAll(/\b(?:in|to|at|sa|from|going)\s+(?:the\s+)?([a-z]{3,})\b/g)]
    .map((m) => m[1] ?? "")
    .filter((w) => w && !skip.has(w) && !LITTLE_WORDS.has(w));
  if (places.length > 0) {
    const found = places.filter((w) => used(w) > 0).sort((a, b) => used(a) - used(b))[0];
    return found ?? places[places.length - 1] ?? "";
  }
  // Three letters too ("gym", "bus", "tax"), with the little words and the ones that ask left out: "Gym spending trend" drew all spending (26 October 2026).
  const SHORT_ASKING = new Set("and for the you can how see let its are was not but has had did get got put use say all any too why who now new old way per via day".split(" "));
  /*
   * A long question is a sentence, and the rarest word in it is whatever it
   * happens to be: "or was it just the trip? ... compare August to November
   * fairly" picked a word out of a few descriptions and drew nothing
   * (10 November 2026). Past fourteen words a topic is one said as a topic,
   * after "on", "for" or "about".
   */
  const long = question.trim().split(/\s+/).length > 14;
  const signalled = new Set([...question.toLowerCase().matchAll(/\b(?:on|for|about|regarding)\s+(?:the\s+|my\s+|our\s+|that\s+)?([a-z]{3,})\b/g)].map((m) => m[1] ?? ""));
  const asked = [...new Set(question.toLowerCase().match(/[a-z]{3,}/g) ?? [])].filter((w) => !skip.has(w) && !LITTLE_WORDS.has(w) && !SHORT_ASKING.has(w) && (!long || signalled.has(w)));
  if (asked.length === 0) return "";
  const limit = Math.max(12, Math.floor(transactions.length * 0.02));
  let best = "";
  let fewest = Number.POSITIVE_INFINITY;
  for (const w of asked) {
    const count = used(w);
    if (count >= 1 && count <= limit && count < fewest) {
      best = w;
      fewest = count;
    }
  }
  return best;
}

/** The place or trip a chart question is about when no entry mentions it at all, or "". */
export function chartTopic(question: string, transactions: readonly Transaction[]): string {
  const about = focusOf(question, transactions).about;
  return about && !transactions.some((t) => mentions(t, about)) ? about : "";
}

/**
 * The word from the descriptions a chart question was narrowed to, or "".
 * Said when nothing in the window mentions it: "Nothing was spent in the
 * days asked about" was untrue when four months of spending were there and
 * only the word was missing from them (10 November 2026).
 */
export function chartAbout(question: string, transactions: readonly Transaction[]): string {
  return focusOf(question, transactions).about;
}

/** Whether a row's own words name what the question is about. */
const mentions = (t: Transaction, about: string): boolean => {
  if (!about) return true;
  const d = ` ${`${t.description} ${t.notes}`.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return d.includes(` ${about} `) || d.includes(` ${about}s `);
};

/** The first name in `names` that the question uses, longest first. */
function named(question: string, names: readonly string[]): string {
  const asked = question.toLowerCase();
  const byLength = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );

  for (const name of byLength) {
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![a-z0-9])${escaped}s?(?![a-z0-9])`).test(asked)) return name;
  }
  /*
   * A one-word name typed with a letter too many: "compare my spending on
   * foodo this month and last month" compared everything, not Food (21
   * October 2026). One extra letter at the end, or a letter doubled, and
   * only for a name of four letters or more, so "good" is never "Food".
   */
  const squash = (w: string): string => w.replace(/(.)\1+/g, "$1");
  // Words of their own that look like a name typed long: "grabe" (Tagalog, "wow") is not Grab.
  const words = asked.split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !/^(?:grabe|sanaa?|ganun|foodie)$/.test(w));
  for (const name of byLength) {
    const n = name.toLowerCase();
    if (n.length < 4 || !/^[a-z]+$/.test(n)) continue;
    if (words.some((w) => (w.length === n.length + 1 && w.startsWith(n)) || (w !== n && squash(w) === squash(n) && w.length <= n.length + 2))) return name;
  }
  return "";
}

/**
 * Every name the question says, longest first, each part of the question
 * used once: "food and gas" is Food and Gas, and "self care" is never also
 * "care". `named` keeps the first only, so "pie chart of food and gas this
 * month" drew Food alone, and on the owner's data said there was nothing to
 * draw (heavy test, 9 November 2026).
 */
function namedAll(question: string, names: readonly string[]): string[] {
  let asked = question.toLowerCase();
  const byLength = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (const name of byLength) {
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const at = new RegExp(`(?<![a-z0-9])${escaped}s?(?![a-z0-9])`);
    if (at.test(asked)) {
      found.push(name);
      asked = asked.replace(at, " ");
    }
  }
  return found;
}

/** "only happened once", "one-offs", "one-time", "isang beses lang". */
const ONCE = /\b(?:(?:only\s+)?happened\s+(?:only\s+)?once|only\s+once|one[-\s]?offs?|one[-\s]?time|once[-\s]?off|isang\s+beses(?:\s+lang)?)\b/i;

/** The words that leave something out of a chart, in English and Tagalog. */
const LEAVE_OUT = /\b(?:(?:take|taking|leave|leaving|keep|keeping|cut|cutting)\s+out|without|except(?:\s+for)?|excluding|exclude|minus|not\s+counting|apart\s+from|aside\s+from|other\s+than|ignor(?:e|ing)|remov(?:e|ing)|maliban\s+sa|hindi\s+kasama(?:\s+ang)?|(?:wag|huwag)\s+(?:isama|isali)(?:\s+ang)?)\s+/gi;

/**
 * What the question leaves out, and the question without it.
 *
 * The owner, 10 November 2026: "Was October really my worst month, or was it
 * just the trip? Take out Travel and anything that only happened once,
 * compare August to November fairly". "Take out Travel" was read as Travel
 * alone, and the chart drew nothing. A kind named after "take out",
 * "without", "except" or "huwag isama" is left out instead, and so is what
 * happened only once when the same words say so. A clause that names no
 * kind ("without touching my savings") is left as it was.
 */
export function leftOut(question: string, names: readonly string[]): { readonly rest: string; readonly without: readonly string[]; readonly once: boolean } {
  let rest = question;
  const without: string[] = [];
  let once = false;
  for (const m of question.matchAll(new RegExp(LEAVE_OUT.source, "gi"))) {
    const tail = question.slice((m.index ?? 0) + m[0].length);
    const end = tail.search(/[.;?!()]|,\s*(?:and\s+)?(?:compare|show|draw|chart|plot|graph|then|how|what|which|is|was|by|for|in|from|this|last|since|vs)\b|\s+and\s+(?:show|compare|draw|chart|plot|graph|tell|explain)\b/i);
    const clause = end < 0 ? tail : tail.slice(0, end);
    const found = namedAll(clause, names);
    const onceSaid = ONCE.test(clause);
    if (found.length === 0 && !onceSaid) continue;
    without.push(...found);
    once = once || onceSaid;
    rest = rest.replace(`${m[0]}${clause}`, " ");
  }
  return { rest: rest.replace(/\s+/g, " ").trim(), without: [...new Set(without)], once };
}

function focusOf(asked: string, transactions: readonly Transaction[]): Focus {
  const out = leftOut(asked, transactions.map(itemName));
  const question = out.rest;
  const allItems = namedAll(question, transactions.map((t) => t.item));
  const items = allItems.length >= 2 ? allItems : [];
  const item = items.length > 0 ? "" : named(question, transactions.map((t) => t.item));
  const wallet = named(question, transactions.flatMap((t) => [t.fromWallet, t.toWallet]));
  const group = item || items.length > 0 ? "" : groupOf(question);
  return {
    items,
    // Kinds named together are kinds, not a topic in the descriptions: "food and gas" read Gas as "on Gas" too, and drew Gas alone.
    about: aboutOf(question, transactions, [item, ...items, wallet, ...(group ? ["bill", "bills", "subscription", "subscriptions", "subs"] : [])].filter(Boolean)),
    group,
    item,
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
    wallet,
    without: out.without,
    once: out.once,
  };
}

/** The Monday a day's week starts on, which names the week. */
function weekOf(day: IsoDate): IsoDate {
  const at = new Date(`${day}T00:00:00Z`);
  const back = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - back);
  return at.toISOString().slice(0, 10);
}

/** The calendar day after this one. */
function nextDay(day: IsoDate): IsoDate {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

/** What a row is filed under by item: a write-off with no kind is money given away, Money Send (`kinds.ts`). */
const itemName = (t: Transaction): string => t.item.trim() || (writtenOffAsSpending(t) ? "Money Send" : "(no item)");

export interface ComparedPeriods {
  readonly now: { readonly from: IsoDate; readonly to: IsoDate; readonly name: string };
  readonly before: { readonly from: IsoDate; readonly to: IsoDate; readonly name: string };
}

/**
 * Two periods side by side, said in relative words.
 *
 * 3 October 2026, the owner: "Show me my spending this month compared to
 * last month" drew September alone, by item. A comparison was read only
 * when two months were named ("september vs august"); "this month" and
 * "last month" are neither, and "last month" became the whole window.
 *
 * This month against last, this week against last, this year against last,
 * however it is put ("compared to", "vs", "than", "against", "from last
 * month"). A period still running is compared with the same days of the
 * one before it, as Insights does: three days of October against all of
 * September says nothing about either.
 */
export function comparedPeriods(question: string, asOf: IsoDate): ComparedPeriods | null {
  const q = question.toLowerCase();
  /*
   * Words that put two periods against each other. Not "from last month" or
   * "over last month": "chart my spending from last month" is last month
   * alone, and comparing it with this one draws a different question.
   */
  if (!/\b(compar\w*|versus|vs\.?|against|than|difference|differ\w*|changed|increase[sd]?|decrease[sd]?|stack(?:s|ed)? up|(?:went|gone|go) (?:up|down)|up from|down from)\b|\bhow\b.*\bchange\b/.test(q)) return null;
  /*
   * Two whole periods gone, one after the other: "last week with the week
   * before", "last month vs the month before", "yesterday against the day
   * before". It was read as this week against last week, and the owner's
   * question was answered from Monday and Tuesday of this week
   * (10 November 2026).
   */
  const lastUnit = /\b(?:last|previous|past)\s+(week|month|year)\b/.exec(q)?.[1] ?? (/\byesterday\b/.test(q) ? "day" : null);
  const beforeUnit = /\b(?:the\s+)?(day|week|month|year)\s+before(?:\s+(?:that|it|last))?\b|\b(day|week|month|year)\s+prior\b/.exec(q);
  if (lastUnit && beforeUnit && (beforeUnit[1] ?? beforeUnit[2]) === lastUnit) {
    const iso0 = (d: Date): IsoDate => d.toISOString().slice(0, 10);
    const day0 = new Date(`${asOf}T00:00:00Z`);
    const add = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);
    const short = (d: IsoDate): string => `${MONTHS[Number(d.slice(5, 7)) - 1]?.slice(0, 3) ?? ""} ${Number(d.slice(8, 10))}`;
    if (lastUnit === "day") {
      const y = iso0(add(day0, -1));
      const b = iso0(add(day0, -2));
      return { now: { from: y, to: y, name: `yesterday, ${short(y)}` }, before: { from: b, to: b, name: `the day before, ${short(b)}` } };
    }
    if (lastUnit === "week") {
      const monday = add(day0, -((day0.getUTCDay() + 6) % 7));
      const lastFrom = iso0(add(monday, -7));
      const lastTo = iso0(add(monday, -1));
      const beforeFrom = iso0(add(monday, -14));
      const beforeTo = iso0(add(monday, -8));
      return {
        now: { from: lastFrom, to: lastTo, name: `last week, ${short(lastFrom)} to ${short(lastTo)}` },
        before: { from: beforeFrom, to: beforeTo, name: `the week before, ${short(beforeFrom)} to ${short(beforeTo)}` },
      };
    }
    if (lastUnit === "month") {
      const y0 = Number(asOf.slice(0, 4));
      const m0 = Number(asOf.slice(5, 7));
      const monthAt = (back: number): { from: IsoDate; to: IsoDate; name: string } => {
        const at0 = new Date(Date.UTC(y0, m0 - 1 - back, 1));
        const end = new Date(Date.UTC(at0.getUTCFullYear(), at0.getUTCMonth() + 1, 0));
        return { from: iso0(at0), to: iso0(end), name: `${MONTHS[at0.getUTCMonth()]} ${at0.getUTCFullYear()}` };
      };
      return { now: monthAt(1), before: monthAt(2) };
    }
    const y0 = Number(asOf.slice(0, 4));
    return { now: { from: `${y0 - 1}-01-01`, to: `${y0 - 1}-12-31`, name: String(y0 - 1) }, before: { from: `${y0 - 2}-01-01`, to: `${y0 - 2}-12-31`, name: String(y0 - 2) } };
  }
  const unit = /\b(?:last|previous|past|prior)\s+week\b/.test(q)
    ? "week"
    : /\b(?:last|previous|prior)\s+year\b/.test(q)
      ? "year"
      : /\b(?:last|previous|prior)\s+month\b/.test(q)
        ? "month"
        : null;
  if (!unit) {
    /*
     * Two months named: "compare food in october and september and show me"
     * fell to the month's summary with the model away (owner's chat, 21
     * October 2026: "the ai and system should know if to see a chart or text
     * or combine"). The later is "now", whichever was said first.
     */
    const named = [...q.matchAll(new RegExp(String.raw`\b(${MONTHS.map((m) => m.toLowerCase()).join("|")}|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b(?:\s+(20\d{2}))?`, "g"))].map((x) => `${x[1]}${x[2] ? ` ${x[2]}` : ""}`);
    // "may" is a month only where a month goes: "in may", "and may", "may 2026", never "what I may spend".
    const two = [...new Set(named)].filter((w) => w !== "may" || /\b(?:in|of|and|vs|versus|to|from|with|than)\s+may\b/.test(q));
    if (two.length !== 2) return null;
    // "dec" and "jan" as their months: `windowOf` reads whole names.
    const whole = (w: string): string => w.replace(/^[a-z]+/, (m) => MONTHS.find((x) => x.toLowerCase().startsWith(m.slice(0, 3))) ?? m);
    const [a, b] = two.map((w) => windowOf(whole(w), asOf)) as [ReturnType<typeof windowOf>, ReturnType<typeof windowOf>];
    if (a.from === b.from) return null;
    return fairPair(a.from > b.from ? { now: a, before: b } : { now: b, before: a }, asOf);
  }

  const iso = (d: Date): IsoDate => d.toISOString().slice(0, 10);
  const at = (d: IsoDate): Date => new Date(`${d}T00:00:00Z`);
  const shortDay = (d: IsoDate): string => `${MONTHS[Number(d.slice(5, 7)) - 1]?.slice(0, 3) ?? ""} ${Number(d.slice(8, 10))}`;

  if (unit === "week") {
    const today = at(asOf);
    const start = new Date(today);
    start.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    const days = Math.round((today.getTime() - start.getTime()) / 86_400_000);
    const beforeStart = new Date(start);
    beforeStart.setUTCDate(start.getUTCDate() - 7);
    const beforeEnd = new Date(beforeStart);
    beforeEnd.setUTCDate(beforeStart.getUTCDate() + days);
    return {
      now: { from: iso(start), to: asOf, name: `this week, ${shortDay(iso(start))} to ${shortDay(asOf)}` },
      before: { from: iso(beforeStart), to: iso(beforeEnd), name: `the same days last week, ${shortDay(iso(beforeStart))} to ${shortDay(iso(beforeEnd))}` },
    };
  }

  if (unit === "year") {
    const y = Number(asOf.slice(0, 4));
    const sameDay = `${y - 1}${asOf.slice(4)}`;
    return {
      now: { from: `${y}-01-01`, to: asOf, name: `${y} so far` },
      before: { from: `${y - 1}-01-01`, to: sameDay, name: `${y - 1} to ${shortDay(sameDay)}` },
    };
  }

  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const day = Number(asOf.slice(8, 10));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const lastOfPrev = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const thisName = `${MONTHS[m - 1] ?? ""} ${y}`;
  const prevName = `${MONTHS[pm - 1] ?? ""} ${py}`;
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const prevFrom = `${py}-${String(pm).padStart(2, "0")}-01`;
  const prevTo = `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(day, lastOfPrev)).padStart(2, "0")}`;
  return {
    now: { from, to: asOf, name: day === 1 ? `${thisName}, today` : `${thisName} so far, the 1st to the ${ordinal(day)}` },
    before: { from: prevFrom, to: prevTo, name: `the same days of ${prevName}` },
  };
}

const ordinal = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/**
 * The two periods the assistant read out of a message, in the owner's words,
 * the later first: "this month" and "last month", "september" and "august",
 * "this week" and "the week before".
 *
 * The words for a comparison are many and a list of them is never finished
 * ("how does this month stack up with the one before"), so the model says
 * which two periods are meant and this only works out their dates. "this"
 * against "last" of the same unit is the same days of each, as above.
 */
export function periodsSaid(now: string, before: string, asOf: IsoDate): ComparedPeriods | null {
  const unitOf = (s: string, words: string): string =>
    new RegExp(String.raw`^(?:the\s+)?(?:${words})\s+(week|month|year)(?:\s+so far)?$`, "i").exec(s.trim())?.[1]?.toLowerCase() ?? "";
  const earlier =
    unitOf(before, "last|previous|prior|past|one before") ||
    (/^(?:the\s+)?(week|month|year)\s+before(?:\s+(?:it|that))?$/i.exec(before.trim())?.[1]?.toLowerCase() ?? "");
  const later = unitOf(now, "this|current|the current");
  if (earlier && (later === earlier || /^(?:now|so far|to ?date|today)$/i.test(now.trim()))) {
    return comparedPeriods(`compared to last ${earlier}`, asOf);
  }
  if (!namesWindow(now) || !namesWindow(before)) return null;
  const a = windowOf(now, asOf);
  const b = windowOf(before, asOf);
  if (a.from === b.from && a.to === b.to) return null;
  return fairPair(a.from > b.from ? { now: a, before: b } : { now: b, before: a }, asOf);
}

/**
 * A month still running against a whole month is put against the same days
 * of it. "Vs june" on 9 November set nine days of November against all
 * thirty of June and called it less (owner's screenshot, 9 November 2026). The
 * whole of the earlier month is still said beside it (`comparisonWorked`).
 */
export function fairPair(pair: ComparedPeriods, asOf: IsoDate): ComparedPeriods {
  const ym = asOf.slice(0, 7);
  const lastDay = (from: IsoDate): number => new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).getUTCDate();
  const wholeMonth = (w: ComparedPeriods["before"]): boolean => w.from.slice(8) === "01" && w.from.slice(0, 7) === w.to.slice(0, 7) && Number(w.to.slice(8)) === lastDay(w.from);
  const running = pair.now.from === `${ym}-01` && pair.now.to.slice(0, 7) === ym;
  if (!running || !wholeMonth(pair.before) || pair.before.from.slice(0, 7) === ym) return pair;
  const day = Number(asOf.slice(8, 10));
  if (day >= lastDay(pair.now.from)) return pair;
  const beforeName = `${MONTHS[Number(pair.before.from.slice(5, 7)) - 1] ?? ""} ${pair.before.from.slice(0, 4)}`;
  const nowName = `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ""} ${ym.slice(0, 4)}`;
  const to = `${pair.before.from.slice(0, 8)}${String(Math.min(day, lastDay(pair.before.from))).padStart(2, "0")}`;
  return {
    now: { from: pair.now.from, to: asOf, name: day === 1 ? `${nowName}, today` : `${nowName} so far, the 1st to the ${ordinal(day)}` },
    before: { from: pair.before.from, to, name: `the same days of ${beforeName}` },
  };
}

/**
 * "Vs june", "against last year", said straight after a chart: the chart's
 * own window against the one named. It drew June alone, as if the message
 * had replaced the window (9 November 2026 sweep).
 */
export function versusPair(question: string, shownTitle: string, asOf: IsoDate): ComparedPeriods | null {
  if (!/\b(?:vs\.?|versus|against|compared?\s+(?:to|with)|than)\b/i.test(question) || !namesWindow(question)) return null;
  if (comparedPeriods(question, asOf)) return null;
  const at = shownTitle.lastIndexOf(", ");
  const shownWindow = at >= 0 ? shownTitle.slice(at + 2) : "";
  if (!shownWindow || !namesWindow(shownWindow)) return null;
  const a = windowOf(shownWindow, asOf);
  const b = windowOf(question, asOf);
  if (a.from === b.from && a.to === b.to) return null;
  return fairPair(a.from > b.from ? { now: a, before: b } : { now: b, before: a }, asOf);
}

/** The two periods' rows side by side, by item (or wallet, or category), largest of either first. */
function buildComparison(
  question: string,
  everything: readonly Transaction[],
  pair: ComparedPeriods,
  direction: "spending" | "revenue",
  focus: Focus,
  said: ChartBy = dimensionOf(question),
): Chart | null {
  const valueOf = direction === "revenue" ? revenueOf : spendingOf;
  const word = direction === "revenue" ? "Income" : "Spending";
  const by: ChartBy = (said === "wallet" && !focus.wallet) || said === "category" ? said : "item";
  // One item, or one wallet, named: only its rows, each period's figure for it.
  const sideOf = (t: Transaction): string => (direction === "revenue" ? t.toWallet : t.fromWallet).trim().toLowerCase();
  const transactions = everything.filter(
    (t) =>
      (!focus.item || t.item.trim().toLowerCase() === focus.item.trim().toLowerCase()) &&
      (!focus.wallet || sideOf(t) === focus.wallet.trim().toLowerCase()) &&
      (!focus.group || direction === "revenue" || t.category === focus.group) &&
      !focus.without.some((w) => w.toLowerCase() === itemName(t).toLowerCase()) &&
      mentions(t, focus.about),
  );
  const narrowed = [focus.item, direction !== "revenue" ? focus.group : "", focus.wallet, focus.about ? capital(focus.about) : ""].filter(Boolean).join(", ");
  const key = (t: Transaction): string =>
    by === "wallet"
      ? (direction === "revenue" ? t.toWallet : t.fromWallet).trim() || "(none)"
      : by === "category"
        ? t.category.trim() || "(none)"
        : itemName(t);
  const sum = (from: IsoDate, to: IsoDate): Map<string, { value: number; count: number }> => {
    const out = new Map<string, { value: number; count: number }>();
    for (const t of transactions) {
      if (t.date < from || t.date > to) continue;
      const v = valueOf(t);
      if (v <= 0) continue;
      const k = key(t);
      const found = out.get(k) ?? { value: 0, count: 0 };
      found.value += v;
      found.count += 1;
      out.set(k, found);
    }
    return out;
  };
  const now = sum(pair.now.from, pair.now.to);
  const before = sum(pair.before.from, pair.before.to);
  if (now.size === 0 && before.size === 0) return null;
  const names = [...new Set([...now.keys(), ...before.keys()])];
  const largest = Math.max(1, ...names.map((n) => Math.max(now.get(n)?.value ?? 0, before.get(n)?.value ?? 0)));
  const rows = names
    .map((n) => {
      const a = now.get(n);
      const b = before.get(n);
      return { label: n, value: a?.value ?? 0, share: (a?.value ?? 0) / largest, count: a?.count ?? 0, previous: b?.value ?? 0, previousShare: (b?.value ?? 0) / largest };
    })
    .sort((x, y) => Math.max(y.value, y.previous) - Math.max(x.value, x.previous));
  const kept = rows.slice(0, MOST_ROWS);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return {
    title: `${word}${narrowed ? ` on ${narrowed}` : ""} by ${by}, ${pair.now.name}, against ${pair.before.name}`,
    by,
    kind: "bars",
    rows: kept,
    total,
    othersCount: rows.length - kept.length,
    direction,
    against: { name: pair.before.name, total: rows.reduce((s, r) => s + r.previous, 0), now: pair.now.name, periods: pair },
  };
}

/**
 * Two periods side by side, in words, for a question asked in words: "did I
 * spend more this month than last month?". The same figures the chart draws,
 * money in and money out, so the answer is built on them rather than on a
 * month still running set against a whole one.
 */
export function comparisonWorked(question: string, transactions: readonly Transaction[], pair: ComparedPeriods): string {
  const focus = focusOf(question, transactions);
  const span = (p: ComparedPeriods["now"]): string => (p.from === p.to ? p.from : `${p.from} to ${p.to}`);
  const lines: string[] = [];
  for (const direction of ["spending", "revenue"] as const) {
    const chart = buildComparison(question, transactions, pair, direction, focus, dimensionOf(question, false));
    if (!chart?.against) continue;
    const moved = chart.total - chart.against.total;
    const word = direction === "revenue" ? "Received" : "Spent";
    lines.push(
      `${word}: ${chartLabel(chart.total)} in ${pair.now.name} (${span(pair.now)}), against ${chartLabel(chart.against.total)} in ${pair.before.name} (${span(pair.before)}). ${
        moved === 0 ? "The same." : `${chartLabel(Math.abs(moved))} ${moved > 0 ? "more" : "less"} now.`
      }`,
    );
    const rows = chart.rows.map((r) => `${r.label} ${chartLabel(r.value)} (was ${chartLabel(r.previous ?? 0)})`);
    lines.push(`By ${chart.by}: ${rows.join(", ")}${chart.othersCount > 0 ? `, and ${chart.othersCount} smaller` : ""}.`);
  }
  if (lines.length === 0) return "";
  if (pair.now.name.includes("so far") || pair.before.name.startsWith("the same days")) {
    lines.push("A period still running is set against the same days of the one before, so the two compare fairly.");
  }
  /*
   * And the whole of last month, so "last month" can be said as well:
   * September's food was PHP 3,374.00 in all and PHP 2,010.00 to the 25th,
   * and the model, given only the second, made up a third (21 October 2026).
   */
  const sameDaysOf = /^the same days of (.+)$/.exec(pair.before.name)?.[1];
  if (sameDaysOf) {
    const y = Number(pair.before.from.slice(0, 4));
    const m = Number(pair.before.from.slice(5, 7));
    const end = `${pair.before.from.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    if (end !== pair.before.to) {
      const whole: ComparedPeriods = { now: pair.now, before: { from: pair.before.from, to: end, name: `all of ${sameDaysOf}` } };
      for (const direction of ["spending", "revenue"] as const) {
        const chart = buildComparison(question, transactions, whole, direction, focus, dimensionOf(question, false));
        if (!chart?.against) continue;
        const narrowed = [focus.item, focus.wallet].filter(Boolean).join(", ");
        lines.push(`${direction === "revenue" ? "Received" : "Spent"}${narrowed ? ` on ${narrowed}` : ""} in all of ${sameDaysOf} (${pair.before.from} to ${end}): ${chartLabel(chart.against.total)}.`);
      }
    }
  }
  return lines.join("\n");
}

export function buildChart(
  question: string,
  transactions: readonly Transaction[],
  asOf: IsoDate,
  /** Money in or money out, when the caller has decided (income and spending drawn side by side). */
  only?: "spending" | "revenue",
  /** Two periods to put side by side, when the assistant read them out of the message. */
  said?: ComparedPeriods | null,
  /** How many rows to keep: every one when the chart is written out as text. */
  most: number = MOST_ROWS,
): Chart | null {
  const focus = focusOf(question, transactions);
  const direction = only ?? directionOf(question);
  /*
   * "this month compared to last month": both periods, row by row, as a
   * split (by item, wallet or category). A trend over months already
   * compares them by being drawn, and so do two named months, one bar each.
   */
  const pair = said ?? comparedPeriods(question, asOf);
  const pairedBy = dimensionOf(question, !said);
  if (pair && !overTime(pairedBy)) {
    const compared = buildComparison(question, transactions, pair, direction, focus, pairedBy);
    if (compared) return compared;
  }
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
  /*
   * A trip or a place with no window said is wherever it is in the ledger,
   * not this month: the trip may have been in August.
   */
  const period = focus.about && !namesWindow(question) ? windowOf("all time", asOf) : windowOf(question, asOf);
  /** How many days the window covers. The whole ledger is as long as a window gets. */
  const span =
    period.from < "1000"
      ? Number.POSITIVE_INFINITY
      : Math.round((Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000) + 1;
  /*
   * A trend over a short window is day by day. "this week's trend" grouped
   * by month drew one point, which is not a trend.
   */
  const said0 = dimensionOf(question);
  /*
   * Year by year inside one year is one point, and so is no chart at all.
   * "spending only" after "by year" carried a window of March to today and
   * drew "Spending by year, 2026 PHP 203,045.56" (28 September 2026). Inside
   * one calendar year the years are its months.
   */
  const oneYear = period.from > "1000" && period.from.slice(0, 4) === period.to.slice(0, 4);
  /*
   * Income against spending, with no grouping said, is month against month.
   * "compare income vs spending this year" drew each by item, two lists of
   * different things that cannot be compared (28 September 2026).
   */
  const sideBySide = only !== undefined && said0 === "item" && span > 45 && !/\b(?:by|per)\s+items?\b|\bitems?\b|\bwhat\b/i.test(question);
  const asked0: ChartBy = (said0 === "year" && oneYear) || sideBySide ? "month" : said0;
  const asked = asked0 === "month" && span <= 45 && !comparesMonths(question) ? "day" : asked0;
  const overTimeSaid = /\b(?:by|per)\s+(?:days?|weeks?|months?|years?)\b|\btrends?\b|\bover\s+time\b|\bdaily\b|\bweekly\b|\bmonthly\b/i.test(question);
  const by: ChartBy =
    focus.items.length > 0 && !overTimeSaid
      ? "item"
      : focus.item && asked === "item"
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

  const asWindow = transactions.filter(
    (t) =>
      t.date >= period.from &&
      t.date <= period.to &&
      (!focus.item || t.item.trim().toLowerCase() === focus.item.toLowerCase()) &&
      (focus.items.length === 0 || focus.items.some((i) => i.toLowerCase() === t.item.trim().toLowerCase())) &&
      (!focus.group || direction === "revenue" || t.category === focus.group) &&
      matchesWallet(t) &&
      mentions(t, focus.about),
  );
  /*
   * What the question leaves out (`leftOut`): the kinds it names, and, when
   * it says so, what happened only once. Over two months or more that is a
   * kind with money in one month of the window and no other; inside a
   * month, a kind with a single entry. Never every kind: a chart of nothing
   * answers nothing.
   */
  const named0 = new Set(focus.without.map((w) => w.toLowerCase()));
  const leftAside = new Map<string, number>();
  const spanLast = period.to < asOf ? period.to : asOf;
  const months = period.from > "1000" && monthOf(period.from) !== monthOf(spanLast);
  const seen = new Map<string, { months: Set<string>; count: number }>();
  for (const t of asWindow) {
    if (valueOf(t) <= 0 || named0.has(itemName(t).toLowerCase())) continue;
    const s0 = seen.get(itemName(t)) ?? { months: new Set<string>(), count: 0 };
    s0.months.add(monthOf(t.date));
    s0.count += 1;
    seen.set(itemName(t), s0);
  }
  const onceOut = focus.once ? [...seen.entries()].filter(([, v]) => (months ? v.months.size === 1 : v.count === 1)).map(([k]) => k.toLowerCase()) : [];
  const dropped = new Set([...named0, ...(onceOut.length < seen.size ? onceOut : [])]);
  const inWindow = dropped.size === 0 ? asWindow : asWindow.filter((t) => {
    const name = itemName(t);
    if (!dropped.has(name.toLowerCase())) return true;
    const v = valueOf(t);
    if (v > 0) leftAside.set(name, (leftAside.get(name) ?? 0) + v);
    return false;
  });

  const key = (t: Transaction): string => {
    switch (by) {
      case "month":
        return monthOf(t.date);
      case "day":
        return t.date;
      case "week":
        return weekOf(t.date);
      case "year":
        return t.date.slice(0, 4);
      case "wallet":
        // The side the money moved through, so an income chart grouped by
        // wallet does not put every row under "(none)": a Revenue row has no
        // source, and reading one was how that happened.
        return sideOf(t) || "(none)";
      case "category":
        return t.category.trim() || "(none)";
      case "item":
        return itemName(t);
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

  /*
   * A month with nothing in it is a zero, not a gap. "Treat by month" read
   * May, July, August, and the line ran straight from May to July as if
   * June had been in between them at the same height. Months, weeks and
   * years between the first and the last get a row of their own.
   */
  if (by === "month" || by === "week" || by === "year") {
    const keys = [...groups.keys()].sort();
    const first = keys[0];
    const last = keys[keys.length - 1];
    const after = (k: string): string => {
      if (by === "year") return String(Number(k) + 1);
      if (by === "week") {
        const d = new Date(`${k}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 7);
        return d.toISOString().slice(0, 10);
      }
      const d = new Date(`${k}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d.toISOString().slice(0, 7);
    };
    if (first && last) {
      for (let k = after(first); k < last; k = after(k)) {
        if (!groups.has(k)) groups.set(k, { value: 0, count: 0 });
      }
    }
  }

  const all = [...groups.entries()]
    // Months and days read in order; everything else reads largest first.
    .sort((a, b) => (overTime(by) ? a[0].localeCompare(b[0]) : b[1].value - a[1].value));

  const total = all.reduce((sum, [, g]) => sum + g.value, 0);
  /*
   * A line needs points to be a trend. Through two or three it draws a
   * slope that says less than the bars do: three or fewer periods are bars,
   * unless a line or a trend was asked for by name.
   */
  const kind0 = kindOf(question, by);
  const kind: ChartKind = kind0 === "line" && all.length <= 3 && !/\b(line|trend|over time|curve|movement|progression)\b/i.test(question) ? "bars" : kind0;
  /*
   * A pie has to be parts. "Pie of food" drew October's 31 days, empty ones
   * and an "Other days" slice; Framelink income by item was one slice at
   * 100% (19 October 2026). Days become weeks, and one slice becomes the
   * months or years it came in.
   */
  /*
   * Only one slice with money in it. "Show me revenue", then "pie", drew
   * 2026's income by month: Framelink Media was 99.7% of November, which
   * counted as one slice, and the months it was turned into were the
   * year's, not November's (owner, 3 November 2026: "wrong chart it shows
   * the revenue per month fix it"). Three sources are three slices, however
   * thin; the legend gives each its share.
   */
  const oneSlice = !overTime(by) && total > 0 && all.filter(([, g]) => g.value > 0).length === 1;
  if (kind === "pie" && (by === "day" || oneSlice) && !/\b(?:by|per)\s+(?:weeks?|months?|years?)\b/i.test(question)) {
    const into = by === "day" || span <= 45 ? "week" : span > 400 ? "year" : "month";
    // The same period, always: "by month" alone reads as this year, "by week" alone as the last twelve weeks.
    const again = `${question} by ${into}${namesWindow(question) ? "" : ` in ${period.name}`}`;
    const same = windowOf(again, asOf);
    if (same.from === period.from && same.to === period.to) return buildChart(again, transactions, asOf, only, said, most);
  }
  /*
   * A pie is the whole, so what does not get a slice of its own goes into
   * one "Other" slice rather than being left off. Leaving it off drew a
   * circle that did not close and shares that did not add up to the total
   * printed in its middle (owner, 27 September 2026: "fix pie layout ...
   * dont work that accurate").
   */
  const PIE_SLICES = 7;
  let kept: [string, { value: number; count: number }][] =
    overTime(by) ? all : all.slice(0, most);
  let folded = 0;
  if (kind === "pie" && all.length > PIE_SLICES) {
    /*
     * Over time, the largest periods keep their slices, in date order, and the
     * smallest share one. Taken in date order, January to June had slices
     * and the months since, the ones asked about most, were "Other months"
     * (owner's chat, 3 November 2026).
     */
    const biggest = overTime(by) ? new Set([...all].sort((a, b) => b[1].value - a[1].value).slice(0, PIE_SLICES - 1).map(([k]) => k)) : null;
    const head = biggest ? all.filter(([k]) => biggest.has(k)) : all.slice(0, PIE_SLICES - 1);
    const rest = biggest ? all.filter(([k]) => !biggest.has(k)) : all.slice(PIE_SLICES - 1);
    kept = [
      ...head,
      [
        `Other (${rest.length})`,
        { value: rest.reduce((s, [, g]) => s + g.value, 0), count: rest.reduce((s, [, g]) => s + g.count, 0) },
      ],
    ];
    folded = rest.length;
  }
  // A slice of nothing is no slice.
  if (kind === "pie") kept = kept.filter(([, g]) => g.value > 0);
  const largest = Math.max(...kept.map(([, g]) => g.value), 1);
  /*
   * The last period is still running when today is inside it. October read
   * on 3 October is three days of a month, and a reading that called it the
   * lowest month would be telling the truth about the wrong thing.
   */
  const lastKey = kept[kept.length - 1]?.[0] ?? "";
  const running =
    overTime(by) &&
    lastKey !== "" &&
    lastKey === (by === "month" ? monthOf(asOf) : by === "week" ? weekOf(asOf) : by === "year" ? asOf.slice(0, 4) : asOf);
  /*
   * The first period, when the records begin partway through it: the first
   * entry of all is after the period's first day. Months and years only; a
   * week or a day is too short to matter.
   */
  const firstKey = kept[0]?.[0] ?? "";
  const firstEver = transactions.reduce((m, t) => (t.date && t.date < m ? t.date : m), "9999-12-31");
  const bucketStart = by === "year" && /^\d{4}$/.test(firstKey) ? `${firstKey}-01-01` : by === "month" && /^\d{4}-\d{2}$/.test(firstKey) ? `${firstKey}-01` : "";
  const partialFirst =
    bucketStart && kept.length >= 2 && firstEver > bucketStart && firstEver.startsWith(firstKey)
      ? { label: by === "month" ? monthName(firstKey) : firstKey, from: firstEver }
      : null;
  /*
   * Said under the chart, and handed to the model with its figures: what was
   * left out and how much, and, for months asked about fairly, each month a
   * day, the one still running over the days it has had.
   */
  const scopeParts: string[] = [];
  if (leftAside.size > 0) {
    const asked0 = [...leftAside.entries()].filter(([k]) => named0.has(k.toLowerCase()));
    const once0 = [...leftAside.entries()].filter(([k]) => !named0.has(k.toLowerCase())).sort((a, b) => b[1] - a[1]);
    const said0 = (e: [string, number]): string => `${e[0]} ${chartLabel(e[1])}`;
    const parts0 = [
      asked0.length > 0 ? asked0.map(said0).join(", ") : "",
      once0.length > 0 ? `what happened in ${months ? "one month" : "one entry"} only: ${once0.map(said0).join(", ")}` : "",
    ].filter(Boolean);
    scopeParts.push(`Leaves out ${parts0.join(", and ")}.`);
  } else if (focus.without.length > 0) {
    scopeParts.push(`Nothing was spent on ${focus.without.join(" or ")} in ${period.name}, so nothing was left out.`);
  }
  const FAIR = /\b(?:fair|fairly|so far|isn'?t over|not over|still running|per day|a day|daily|average|hindi pa tapos)\b/i;
  if (by === "month" && kept.length >= 2 && FAIR.test(question)) {
    const daysIn0 = (key: string): number => {
      const start = `${key}-01` > period.from ? `${key}-01` : period.from;
      const endOfMonth = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const stop = [endOfMonth, period.to, asOf].sort()[0] as string;
      return Math.max(1, Math.round((Date.parse(`${stop}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1);
    };
    const each = kept.filter(([k]) => /^\d{4}-\d{2}$/.test(k)).map(([k, g]) => {
      const days = daysIn0(k);
      const isNow = running && k === lastKey;
      return `${monthName(k)}${isNow ? ` so far (${days} ${days === 1 ? "day" : "days"})` : ""} ${chartLabel(Math.round(g.value / days))}`;
    });
    if (each.length >= 2) scopeParts.push(`A day, so months of different lengths and one still running compare fairly: ${each.join(", ")}.`);
  }
  const leftWords = focus.without.length > 0 || (focus.once && leftAside.size > 0)
    ? ` without ${[...focus.without, ...(focus.once && [...leftAside.keys()].some((k) => !named0.has(k.toLowerCase())) ? ["one-offs"] : [])].join(" and ")}`
    : "";

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
    title: `${focus.items.length > 0 ? focus.items.join(" and ") : focus.item || (direction !== "revenue" && focus.group) || word}${leftWords}${focus.about ? ` on ${capital(focus.about)}` : ""}${focus.wallet ? ` from ${focus.wallet}` : ""} by ${by}, ${
      period.name
    }`,
    by,
    kind,
    rows: kept.map(([label, g]) => ({
      // The bucket for what did not fit is a word, not a date: it read " NaN" by day (12 October 2026 audit, A17).
      label: !/^\d{4}-\d{2}/.test(label)
        ? by === "day" && /^other/i.test(label)
          ? "Other days"
          : by === "week" && /^other/i.test(label)
            ? "Other weeks"
            : by === "month" && /^other/i.test(label)
              ? "Other months"
              : label
        : by === "month"
          ? monthName(label)
          : by === "day"
            ? `${MONTHS[Number(label.slice(5, 7)) - 1]?.slice(0, 3) ?? ""} ${Number(label.slice(8, 10))}`
            : by === "week"
              ? `Week of ${MONTHS[Number(label.slice(5, 7)) - 1]?.slice(0, 3) ?? ""} ${Number(label.slice(8, 10))}`
              : label,
      value: g.value,
      share: g.value / largest,
      count: g.count,
    })),
    total,
    // What an "Other" slice holds is in the chart, so nothing is left off.
    othersCount: folded > 0 ? 0 : all.length - kept.length,
    direction,
    ...(running ? { running: true } : {}),
    ...(scopeParts.length > 0 ? { scope: scopeParts.join(" ") } : {}),
    ...(partialFirst ? { partialFirst } : {}),
  };
}

/** Pesos, for a label. Display only, never arithmetic. */
export const chartLabel = (centavos: number): string =>
  // A balance can be below zero; the sign is the minus sign (U+2212), as everywhere money is shown.
  `PHP ${centavos < 0 ? "\u2212" : ""}${Number(toPesos(Math.abs(centavos)).toFixed(2)).toLocaleString("en-PH", {
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
  /*
   * A trend is read in order, so its periods are all said, a year's worth at
   * most; a split says its largest five. Either way every row not said is
   * counted: "show me trend this year" listed January to May and stopped,
   * with nothing to say four more months were drawn (28 September 2026).
   */
  // Spending beside the budget: each month's pair, or how far into the month the spending is.
  if (chart.measure === "budget") {
    const budget = chart.against?.total ?? 0;
    if (chart.by === "day") {
      const last = chart.rows[chart.rows.length - 1];
      if (!last) return "";
      return budget > 0
        ? `Spent ${chartLabel(last.value)} by ${last.label}, against a steady pace of ${chartLabel(last.previous ?? 0)} to the ${chartLabel(budget)} budget.`
        : `Spent ${chartLabel(last.value)} by ${last.label}. No budget is set for the month.`;
    }
    const said = chart.rows.slice(-12).map((r) => `${r.label} ${chartLabel(r.value)} of ${r.previous ? `${chartLabel(r.previous)} budgeted` : "no budget"}`);
    return `${said.join(", ")}. Spent ${chartLabel(chart.total)} against ${chartLabel(budget)} budgeted.`;
  }
  // Spending still to come: each part, and the total.
  if (chart.measure === "upcoming") {
    return `${chart.rows.map((r) => `${r.label} ${chartLabel(r.value)}`).join(", ")}. Still to come ${chartLabel(chart.total)}.`;
  }
  // What the wallets hold, by what it is still for.
  if (chart.measure === "safe") {
    return `${chart.rows.map((r) => `${r.label} ${chartLabel(r.value)}`).join(", ")}. The spending wallets hold ${chartLabel(chart.total)}.`;
  }
  // Each allocation: what it spent of what it holds for the month.
  if (chart.measure === "allocation") {
    const said = chart.rows.map((r) => `${r.label} ${chartLabel(r.value)} spent of ${chartLabel(r.previous ?? 0)}${r.value > (r.previous ?? 0) ? `, ${chartLabel(r.value - (r.previous ?? 0))} over` : `, ${chartLabel((r.previous ?? 0) - r.value)} left`}`);
    return `${said.join("; ")}. Spent ${chartLabel(chart.total)} of ${chartLabel(chart.against?.total ?? 0)} allocated.`;
  }
  // The months ahead as planned: each part, then what a usual month brings in and leaves.
  if (chart.measure === "forecast") {
    const p = chart.plan;
    const parts = chart.rows.map((r) => (chart.by === "item" ? `${r.label} ${chartLabel(r.value)}` : `${r.label} ${chartLabel(r.value)} against ${chartLabel(r.previous ?? 0)} usual income`));
    const tail = p
      ? ` Forecast ${chartLabel(chart.total)}; usual income ${chartLabel(p.income)}${p.debtDue > 0 ? `; debt payments due ${chartLabel(p.debtDue)}` : ""}; ${p.left >= 0 ? `left about ${chartLabel(p.left)}` : `short ${chartLabel(-p.left)}`}. From your usual month over ${p.readFrom}, one-offs left out.`
      : ` Forecast ${chartLabel(chart.total)}.`;
    return `${parts.join(", ")}.${tail}`;
  }
  // A level, not a flow: what each account holds, or what was held or owed at each period's end.
  if (chart.measure === "balance" || chart.measure === "owed") {
    if (chart.by === "wallet") {
      return `${chart.rows.map((r) => `${r.label} ${chartLabel(r.value)}`).join(", ")}. Together ${chartLabel(chart.total)}.`;
    }
    const said = chart.rows.slice(-12);
    const left = chart.rows.length - said.length;
    return `${said.map((r) => `${r.label} ${chartLabel(r.value)}`).join(", ")}${left > 0 ? `, after ${left} earlier` : ""}. Now ${chartLabel(chart.total)}.`;
  }
  // A comparison says each row's earlier figure beside it, and both totals.
  if (chart.against) {
    const said = chart.rows.slice(0, 6);
    const top = said.map((r) => `${r.label} ${chartLabel(r.value)} (was ${chartLabel(r.previous ?? 0)})`).join(", ");
    const left = chart.rows.length - said.length + chart.othersCount;
    return `${top}${left > 0 ? `, and ${left} more` : ""}. Total ${chartLabel(chart.total)}, against ${chartLabel(chart.against.total)} for ${chart.against.name}.`;
  }
  // A month, week or year with nothing in it is part of a trend and is said; an empty day is not, or a month reads as thirty zeros.
  const shown = chart.rows.filter((r) => r.value > 0 || (overTime(chart.by) && chart.by !== "day"));
  const said = shown.slice(0, overTime(chart.by) ? 12 : 5);
  const top = said.map((r) => `${r.label} ${chartLabel(r.value)}`).join(", ");
  const left = shown.length - said.length + chart.othersCount;
  const rest = left > 0 ? `, and ${left} more` : "";
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

/*
 * A summary is words on screen, never a file: "Summary my spending last
 * month" was told it could not have a file and then given November (owner,
 * 21 October 2026, "//it show wrong chart"). Only a report of the whole
 * position, or a file named outright, points at Statements.
 */
export const wantsStatement = (question: string): boolean =>
  WANTS_A_FILE.test(question) || (/\breport\b/i.test(question) && /\b(financial status|position|monthly report)\b/i.test(question));

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

/**
 * A chart written out in full, one line a row: "Not a chart, I want it in
 * text here in chat" (13 October 2026) was read as a search for "Chat".
 */
export function chartAsText(chart: Chart): string {
  if (chart.measure) return chartInWords(chart);
  const lines = chart.rows.map((r) => {
    const share = chart.total > 0 ? `, ${percentOf(r.value, chart.total)}` : "";
    const count = r.count > 0 ? `, ${r.count} ${r.count === 1 ? "entry" : "entries"}` : "";
    const was = r.previous !== undefined ? `, was ${chartLabel(r.previous)}` : "";
    return `- ${r.label}: ${chartLabel(r.value)}${share}${count}${was}`;
  });
  // The rows left off, as a sum, so nothing in the total is unaccounted for (13 October 2026 audit).
  const shown = chart.rows.reduce((sum, r) => sum + r.value, 0);
  const rest = chart.total - shown;
  return [
    `${chart.title}: ${chartLabel(chart.total)} in all.`,
    ...lines,
    chart.othersCount > 0 ? `- ${chart.othersCount} smaller ones: ${chartLabel(rest)}${chart.total > 0 ? `, ${percentOf(rest, chart.total)}` : ""}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
