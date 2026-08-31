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
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

export type ChartBy = "item" | "month" | "wallet" | "category";

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
}

/** Asking to see something rather than be told it. */
const WANTS_CHART =
  /\b(chart|graph|pie|bar|bars|breakdown|break down|visuali[sz]e|plot|show me|diagram)\b/i;

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
    return by === "month" ? "bars" : "pie";
  }
  if (/\b(line|trend|over time|curve|movement|progression)\b/i.test(question)) {
    return by === "month" ? "line" : "bars";
  }
  // A question about months is a series whether or not it says so.
  return by === "month" ? "line" : "bars";
}

/** Which grouping the question asked for. Item is the useful default. */
function dimensionOf(question: string): ChartBy {
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
  if (/\b(wallet|wallets|account|accounts|gcash|maya|cash)\b/i.test(question)) return "wallet";
  if (/\b(category|categories|bills|subscriptions)\b/i.test(question)) return "category";
  return "item";
}

/** The window the question asked about, and what to call it. */
function windowOf(
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
    );
  if (!namesPeriod) return false;

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
function focusOf(question: string, transactions: readonly Transaction[]): string {
  const items = [...new Set(transactions.map((t) => t.item.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const asked = question.toLowerCase();

  for (const item of items) {
    const escaped = item.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}s?\\b`).test(asked)) return item;
  }
  return "";
}

export function buildChart(
  question: string,
  transactions: readonly Transaction[],
  asOf: IsoDate,
): Chart | null {
  const focus = focusOf(question, transactions);
  /**
   * One item over time, because one item by item is a single bar.
   *
   * Asking about Treat and being shown one bar labelled Treat says nothing
   * you did not already type. Across months it says whether it is growing,
   * which is the only question worth drawing about a single item.
   */
  const by = focus && dimensionOf(question) === "item" ? "month" : dimensionOf(question);
  const period = windowOf(question, asOf);

  const inWindow = transactions.filter(
    (t) =>
      t.date >= period.from &&
      t.date <= period.to &&
      (!focus || t.item.trim().toLowerCase() === focus.toLowerCase()),
  );

  const key = (t: Transaction): string => {
    switch (by) {
      case "month":
        return monthOf(t.date);
      case "wallet":
        return t.fromWallet.trim() || "(none)";
      case "category":
        return t.category.trim() || "(none)";
      case "item":
        return t.item.trim() || "(no item)";
    }
  };

  const groups = new Map<string, { value: number; count: number }>();
  for (const row of inWindow) {
    const spent = spendingOf(row);
    if (spent <= 0) continue;
    const name = key(row);
    const found = groups.get(name) ?? { value: 0, count: 0 };
    found.value += spent;
    found.count += 1;
    groups.set(name, found);
  }

  if (groups.size === 0) return null;

  const all = [...groups.entries()]
    // Months read in order; everything else reads largest first.
    .sort((a, b) => (by === "month" ? a[0].localeCompare(b[0]) : b[1].value - a[1].value));

  const total = all.reduce((sum, [, g]) => sum + g.value, 0);
  const kept = by === "month" ? all : all.slice(0, MOST_ROWS);
  const largest = Math.max(...kept.map(([, g]) => g.value), 1);

  return {
    /**
     * The title says what was filtered, or the chart is a lie by omission.
     *
     * A chart of Treat alone, headed "Spending by month", reads as the whole
     * month's spending and is wrong by everything it left out.
     */
    title: focus
      ? `${focus} by ${by}, ${period.name}`
      : by === "month"
        ? `Spending by month, ${period.name}`
        : `Spending by ${by}, ${period.name}`,
    by,
    kind: kindOf(question, by),
    rows: kept.map(([label, g]) => ({
      label: by === "month" ? monthName(label) : label,
      value: g.value,
      share: g.value / largest,
      count: g.count,
    })),
    total,
    othersCount: all.length - kept.length,
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
    .slice(0, 5)
    .map((r) => `${r.label} ${chartLabel(r.value)}`)
    .join(", ");
  const rest = chart.othersCount > 0 ? `, and ${chart.othersCount} more` : "";
  return `${top}${rest}. Total ${chartLabel(chart.total)}.`;
}
