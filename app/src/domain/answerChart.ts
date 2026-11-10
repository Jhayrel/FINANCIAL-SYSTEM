/**
 * A chart of the figures an answer gave, when the figures are the answer's
 * own: made up on request, a what-if worked out, a plan laid out.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 10 November 2026: "I also ask it to come up with random data
 * then said 'chart that' ... I want the ai to come up with charts ... any
 * type of chart, vs, trend, pie ... but make sure its accurate". "Chart that"
 * drew the ledger, because every chart here was drawn from the ledger.
 *
 * So an answer's figures are read back out of it, line by line and from a
 * table, exactly as written, and drawn: a trend when the labels are periods
 * in order, a pie when they are parts of one whole, two bars a row when each
 * line has two figures ("vs", a table with two columns), bars otherwise. The
 * device adds them up, never the model, and when the answer states a total
 * that its own parts do not make, the chart says so. The chart says where
 * its figures came from, so nobody takes made-up money for their own.
 */
import { chartLabel, type Chart, type ChartKind, type ChartRow } from "./charts";

/** Asking for figures that are not the ledger's: made up, imagined, projected. */
export const MADE_UP =
  /\b(?:random|sample|samples|example|examples|made[\s-]?up|make\s+up|fake|dummy|mock|hypothetical\w*|imagine|imaginary|suppose|supposing|what\s+if|simulat\w*|scenarios?|projection|project(?:ed)?|forecast\s+for\s+me|estimate|pretend|generate|invent|create\s+(?:a|some)\s+(?:data|figures|numbers|budget|plan))\b/i;

/** Asking for figures invented outright: never traced to the ledger, since they are not from it. */
export const INVENTED = /\b(?:random|sample|example|made[\s-]?up|make\s+up|fake|dummy|mock|pretend|invent\w*|imaginary|generate\w*)\b/i;

/** What the model is told when it is asked to make figures up, so they can be drawn exactly as written. */
export const INVENTED_RULE =
  "They asked you to make figures up. Make them realistic for their life (pesos, the kinds of spending they have), say in the first line that they are made up, and put each figure on its own line as 'Label: PHP amount'. For two figures for each label, write 'Label: PHP a vs PHP b' and name both in the first line as 'A vs B'. A total line only if it is the exact sum, worked out with {{calc: ...}}.";

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Money as written: "PHP 1,200.00", "₱1,200", "1200", "1.2k". In centavos, or null. */
function money(raw: string): number | null {
  const m = /^(?:php|₱|p)?\s*(-|−)?\s*(?:php|₱)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k)?$/i.exec(raw.trim());
  if (!m?.[2]) return null;
  const whole = Number(m[2].replace(/,/g, ""));
  const cents = Number((m[3] ?? "").padEnd(2, "0") || 0);
  const value = m[4] ? Math.round((whole + cents / 100) * 1000) * 100 : whole * 100 + cents;
  return m[1] ? -value : value;
}

/** The en and em dash an answer may put between a label and its figure, built from their codes: the source keeps no dash of its own (rule W1). */
const DASHES = `${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}`;
const AMOUNT = String.raw`(?:php|₱)?\s*[-−]?\s*(?:php|₱)?\s*\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|(?:php|₱)?\s*[-−]?\s*\d+(?:\.\d{1,2})?\s*k?`;

/** A line of an answer without its markdown: bullets, numbers, bold, backticks. */
const plain = (line: string): string =>
  line
    .replace(/[*_`]/g, "")
    .replace(/^\s*(?:[-•·]|\d{1,2}[.)])\s+/, "")
    .trim();

export interface AnswerRow {
  readonly label: string;
  readonly value: number;
  readonly second?: number;
}

export interface AnswerFigures {
  readonly rows: readonly AnswerRow[];
  /** The names of the two figures on each line, when there are two. */
  readonly series?: readonly [string, string];
  /** A total the answer states for itself. */
  readonly statedTotal?: number;
  /** Written as shares: percentages, or "of the total". */
  readonly percent: boolean;
}

const TOTAL = /^(?:total|in all|overall|sum|altogether|grand total|kabuuan)\b/i;

/** The labelled figures in an answer, as written. Null when there are fewer than two. */
export function answerFigures(answer: string): AnswerFigures | null {
  const rows: AnswerRow[] = [];
  let statedTotal: number | undefined;
  let series: [string, string] | undefined;
  let percent = false;
  const lines = answer.split(/\n+/);

  // A markdown table: the first row names the columns.
  const table = lines.filter((l) => /^\s*\|.*\|\s*$/.test(l));
  if (table.length >= 3) {
    const cells = table.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => plain(c)));
    const head = cells[0] ?? [];
    for (const r of cells.slice(1)) {
      if (r.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      const label = r[0] ?? "";
      const nums = r.slice(1).map((c) => money(c.replace(/%$/, ""))).filter((v): v is number => v !== null);
      if (!label || nums.length === 0) continue;
      if (TOTAL.test(label)) {
        statedTotal = nums[0];
        continue;
      }
      rows.push(nums.length >= 2 ? { label, value: nums[0] as number, second: nums[1] as number } : { label, value: nums[0] as number });
      if (r.slice(1).some((c) => /%$/.test(c))) percent = true;
    }
    if (rows.some((r) => r.second !== undefined) && head.length >= 3) series = [head[1] ?? "First", head[2] ?? "Second"];
  } else {
    for (const raw of lines) {
      const line = plain(raw);
      if (!line || line.length > 160) continue;
      // "Label: PHP 1,200 vs PHP 900", "Label - 1,200 (was 900)", "Label: 25%".
      const m = new RegExp(String.raw`^([A-Za-z][^:=\-${DASHES}|]{0,40}?)\s*(?::|=|-|[${DASHES}])\s*(${AMOUNT})\s*(%)?(?:\s*(?:vs\.?|versus|against|→|->|\(was|was|,\s*(?:was|before|last))\s*(${AMOUNT})\)?\s*(%)?)?(?=\s|$|[.,;)])`, "i").exec(line);
      if (!m?.[1] || !m[2]) continue;
      const label = m[1].trim().replace(/[,(]+$/, "").trim();
      const value = money(m[2]);
      if (value === null || /^\d+$/.test(label)) continue;
      if (TOTAL.test(label)) {
        statedTotal = value;
        continue;
      }
      const second = m[4] ? money(m[4]) : null;
      if (m[3] || m[5]) percent = true;
      rows.push(second !== null ? { label, value, second } : { label, value });
    }
    const named = /\b([A-Z][\w ]{1,24}?)\s+(?:vs\.?|versus|against)\s+([A-Z][\w ]{1,24})\b/.exec(answer.split("\n")[0] ?? "");
    if (rows.some((r) => r.second !== undefined)) series = named?.[1] && named[2] ? [named[1].trim(), named[2].trim()] : ["First figure", "Second figure"];
  }
  // One label once: a repeated label is a second list, not more of this one.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = r.label.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length < 2) return null;
  return { rows: unique, ...(series ? { series } : {}), ...(statedTotal !== undefined ? { statedTotal } : {}), percent };
}

/** Periods in order: months, weekdays, "Week 1", "Month 3", years, days. */
function periodIndex(label: string): number | null {
  const l = label.toLowerCase().trim();
  const mo = MONTH_NAMES.findIndex((m) => l.startsWith(m)) >= 0 ? MONTH_NAMES.findIndex((m) => l.startsWith(m)) : SHORT_MONTHS.findIndex((m) => new RegExp(`^${m}\\b`).test(l));
  if (mo >= 0) {
    const y = /\b(20\d{2})\b/.exec(l)?.[1];
    return (y ? Number(y) * 12 : 0) + mo;
  }
  const wd = WEEKDAYS.findIndex((d) => l.startsWith(d.slice(0, 3)));
  if (wd >= 0) return wd;
  const n = /^(?:week|month|day|year|quarter|q)\s*(\d{1,3})\b/.exec(l)?.[1] ?? /^(20\d{2})$/.exec(l)?.[1];
  return n ? Number(n) : null;
}

/**
 * The chart of an answer's figures, in the shape they ask for, or null.
 * `asked` is what the owner said, for the shape and the direction.
 */
export function answerChart(answer: string, asked: string): Chart | null {
  const found = answerFigures(answer);
  if (!found) return null;
  const { rows: raw, series, statedTotal, percent } = found;
  // Shares alone have no pesos to draw them in: a chart of them would print "PHP 25.00" for 25%.
  if (percent || raw.some((r) => r.value < 0 || (r.second ?? 0) < 0)) return null;
  const indexes = raw.map((r) => periodIndex(r.label));
  const overTime = indexes.every((i) => i !== null);
  // Periods in their order; anything else largest first, as every chart here reads ("A is the largest" was said of the smaller).
  const ordered = overTime ? raw.map((r, i) => ({ r, i: indexes[i] as number })).sort((a, b) => a.i - b.i).map((x) => x.r) : [...raw].sort((a, b) => Math.max(b.value, b.second ?? 0) - Math.max(a.value, a.second ?? 0));
  const two = series !== undefined && ordered.every((r) => r.second !== undefined);
  const said = asked.toLowerCase();
  const kind: ChartKind = /\b(?:pie|donut|doughnut|share|shares|breakdown|split)\b/.test(said) && !two
    ? "pie"
    : /\b(?:bars?|columns?)\b/.test(said)
      ? "bars"
      : /\b(?:trend|line|over time)\b/.test(said) && overTime
        ? "line"
        : two
          ? "bars"
          : overTime && ordered.length >= 4
            ? "line"
            : "bars";
  const largest = Math.max(1, ...ordered.map((r) => Math.max(r.value, r.second ?? 0)));
  const rows: ChartRow[] = ordered.map((r) => ({
    label: r.label,
    value: r.value,
    share: r.value / largest,
    count: 0,
    ...(two ? { previous: r.second as number, previousShare: (r.second as number) / largest } : {}),
  }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  const income = /\b(?:income|earn\w*|revenue|salary|sahod|kita|savings?|ipon|saved)\b/i.test(`${asked} ${answer.slice(0, 200)}`) && !/\b(?:spend\w*|spent|expenses?|gastos|budget)\b/i.test(asked);
  const notes = [
    "Drawn from the figures in the answer above, exactly as written: they are the answer's own, not entries in your ledger.",
    statedTotal !== undefined && statedTotal !== total ? `The answer gives a total of ${chartLabel(statedTotal)}; its own parts add up to ${chartLabel(total)}.` : "",
  ].filter(Boolean);
  const subject = (/^([^\n.:]{4,60})[:.]/.exec(plain(answer.split("\n")[0] ?? ""))?.[1] ?? "The answer's figures").trim();
  return {
    title: `${subject}${two && series && !(subject.toLowerCase().includes(series[0].toLowerCase()) && subject.toLowerCase().includes(series[1].toLowerCase())) ? `, ${series[0]} against ${series[1]}` : ""}`,
    by: overTime ? "month" : "item",
    kind,
    rows,
    total,
    othersCount: 0,
    direction: income ? "revenue" : "spending",
    ...(two && series ? { against: { name: series[1], total: rows.reduce((s, r) => s + (r.previous ?? 0), 0), now: series[0] } } : {}),
    scope: notes.join(" "),
    fromAnswer: true,
    asked,
  };
}
