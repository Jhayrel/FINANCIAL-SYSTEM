/**
 * A long message, read sentence by sentence for its charts.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026: "Compare my spending last week with the week
 * before, item by item, and show it as a chart. What caused the jump? ...
 * List every bill and plan still coming between now and the end of
 * December. ... Show December as a chart too." One chart was drawn, from
 * the whole message read as one question: "Bills by month, last week", a
 * single bar, because "bill" from the fourth sentence became
 * its filter, and "by month" over one week left one month to show.
 *
 * So each sentence that asks for a chart is drawn from that sentence alone;
 * a month to come that the message asks to be short or enough is drawn as
 * its forecast; and a chart with one bar is never drawn, since it says
 * nothing a sentence does not ("know when to use trend, chart, graph, pie",
 * the owner, the same day).
 */
import { asksForecast } from "./chartAsk";
import { namesWindow, wantsChart, type Chart } from "./charts";
import type { IsoDate } from "./types";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The sentences of a message, each with its own end. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A sentence that asks for a picture: "show it as a chart", "Show December as a chart too", "pie of it". */
export function asksChartIn(sentence: string): boolean {
  return wantsChart(sentence) || /\b(?:as|in|into|on)\s+(?:a\s+)?(?:chart|graph|pie|trend|bars?|line)\b/i.test(sentence);
}

/**
 * A month to come, asked as a chart beside a question about whether it is
 * enough: "Based on my usual month, will December be short? Show December as
 * a chart too." Drawn as December's forecast, not last December's spending.
 */
export function forecastMeant(sentence: string, all: readonly string[], asOf: IsoDate): string | null {
  const found = new RegExp(`\\b(${MONTHS.join("|")})\\b(?:\\s+(20\\d{2}))?`, "i").exec(sentence);
  if (!found?.[1]) return null;
  const month = MONTHS.indexOf(found[1].toLowerCase()) + 1;
  const now = Number(asOf.slice(5, 7));
  const y0 = Number(asOf.slice(0, 4));
  const year = found[2] ? Number(found[2]) : month > now ? y0 : month < now ? y0 + 1 : y0;
  if (year * 12 + month <= y0 * 12 + now) return null;
  const name = found[1].toLowerCase();
  const ahead =
    asksForecast(sentence) ||
    /\b(?:will|would|short|enough|cover|afford|expect\w*|forecast\w*|coming|next)\b/i.test(sentence) ||
    all.some((s) => s !== sentence && new RegExp(`\\b${name}\\b`, "i").test(s) && (asksForecast(s) || /\b(?:will|short|enough|afford|cover)\b/i.test(s)));
  if (!ahead) return null;
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return `forecast for ${cap} ${year}`;
}

/** One bar or one slice with money in it: nothing a sentence does not say better. */
export function oneBar(chart: Chart): boolean {
  if (chart.measure || chart.against) return false;
  return chart.rows.filter((r) => r.value > 0).length <= 1;
}

/**
 * A word or two after a chart, naming only what to measure: "Earning",
 * "income", "spending pls". It keeps the chart's window and grouping:
 * "Earning" after "Yearly spending in graph" drew November's income by item
 * (10 November 2026), when it meant the same years, earned.
 */
export function bareMeasure(text: string): boolean {
  const t = text.trim();
  return (
    t.split(/\s+/).length <= 3 &&
    /\b(?:income|incomes|revenue|earn(?:ed|ing|ings|s)?|received|kita|sweldo|spend(?:ing|s)?|spent|expenses?|gastos)\b/i.test(t) &&
    !namesWindow(t) &&
    !/\b(?:by|per)\s+\w+|\b(?:monthly|daily|weekly|yearly|pie|donut|bars?|trend|line)\b/i.test(t)
  );
}
